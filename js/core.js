/* AirCheck core: data sources, AQI maths, running guidance, favourites.
   No UI code in here — both the mobile and desktop layouts use it. */
(function () {
  'use strict';

  const CFG = Object.assign(
    { WAQI_TOKEN: '', DOE_CACHE_URL: 'data/doe.json', HISTORY_URL: 'data/history.json' },
    window.AQ_CONFIG || {}
  );
  const HOUR = 3600e3;

  /* ---------- storage (wrapped: private mode / blocked storage must not break the app) ---------- */
  const store = {
    get(k, d) { try { const v = localStorage.getItem('aq.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('aq.' + k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
    del(k) { try { localStorage.removeItem('aq.' + k); } catch (e) { /* ignore */ } }
  };

  const settings = {
    token() { return (store.get('token', '') || CFG.WAQI_TOKEN || '').trim(); },
    setToken(t) { store.set('token', (t || '').trim()); },
    sensitive() { return !!store.get('sensitive', false); },
    setSensitive(v) { store.set('sensitive', !!v); }
  };

  /* ---------- locations ---------- */
  const DEFAULTS = [
    { id: 'perai', name: 'Perai', region: 'Pulau Pinang', lat: 5.3294, lon: 100.4435, waqi: '@2600',
      aqicnUrl: 'https://aqicn.org/city/malaysia/pulau-pinang/perai/', fixed: true },
    { id: 'kl', name: 'Kuala Lumpur', region: 'W.P. Kuala Lumpur', lat: 3.1390, lon: 101.6869, waqi: '@5780',
      aqicnUrl: 'https://aqicn.org/city/kuala-lumpur/', fixed: true },
    { id: 'alor-setar', name: 'Alor Setar', region: 'Kedah', lat: 6.1371, lon: 100.3469, waqi: '@2581',
      aqicnUrl: 'https://aqicn.org/city/malaysia/kedah/alor-setar/', fixed: true }
  ];
  const favourites = {
    list() { const f4 = store.get('fav4', null); return f4 ? DEFAULTS.concat([Object.assign({}, f4, { fav4: true })]) : DEFAULTS.slice(); },
    fav4() { return store.get('fav4', null); },
    setFav4(loc) {
      const clean = { id: 'fav4', name: loc.name, region: loc.region || '', lat: +loc.lat, lon: +loc.lon, waqi: loc.waqi || null, aqicnUrl: loc.aqicnUrl || null };
      store.set('fav4', clean); return clean;
    },
    clearFav4() { store.del('fav4'); },
    lastId() { return store.get('lastLoc', 'perai'); },
    setLastId(id) { store.set('lastLoc', id); }
  };

  /* ---------- fetch helper ---------- */
  async function getJSON(url, timeout = 15000) {
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const tid = ctl ? setTimeout(() => ctl.abort(), timeout) : null;
    try {
      const r = await fetch(url, { signal: ctl && ctl.signal, cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('timed out');
      throw e;
    } finally { if (tid) clearTimeout(tid); }
  }

  /* ---------- AQI maths ---------- */
  // US EPA breakpoints as used by aqicn.org (pre‑2024 PM2.5 table: 12 / 35.4 / 55.4 / 150.4 …),
  // so numbers computed here line up with the aqicn pages.
  const BP = {
    pm25: [[0, 12, 0, 50], [12.1, 35.4, 51, 100], [35.5, 55.4, 101, 150], [55.5, 150.4, 151, 200], [150.5, 250.4, 201, 300], [250.5, 350.4, 301, 400], [350.5, 500.4, 401, 500]],
    pm10: [[0, 54, 0, 50], [55, 154, 51, 100], [155, 254, 101, 150], [255, 354, 151, 200], [355, 424, 201, 300], [425, 504, 301, 400], [505, 604, 401, 500]],
    o3:   [[0, 54, 0, 50], [55, 70, 51, 100], [71, 85, 101, 150], [86, 105, 151, 200], [106, 200, 201, 300]],          // ppb
    no2:  [[0, 53, 0, 50], [54, 100, 51, 100], [101, 360, 101, 150], [361, 649, 151, 200], [650, 1249, 201, 300], [1250, 1649, 301, 400], [1650, 2049, 401, 500]] // ppb
  };
  function toAqi(p, c) {
    if (c == null || !isFinite(c) || c < 0) return null;
    const t = BP[p];
    c = p === 'pm25' ? Math.floor(c * 10) / 10 : Math.floor(c);
    for (const [cl, ch, il, ih] of t) {
      if (c <= ch) return Math.round(((ih - il) / (ch - cl)) * (Math.max(c, cl) - cl) + il);
    }
    return t === BP.o3 ? 300 : 500;
  }
  function fromAqi(p, a) {
    if (a == null || !isFinite(a)) return null;
    for (const [cl, ch, il, ih] of BP[p]) {
      if (a <= ih) return cl + ((Math.max(a, il) - il) * (ch - cl)) / (ih - il);
    }
    return null;
  }
  const UG_PER_PPB = { o3: 1.962, no2: 1.882 };

  const US_CATS = [
    { max: 50, key: 'good', label: 'Good', color: '#00b050', ink: '#06210f' },
    { max: 100, key: 'moderate', label: 'Moderate', color: '#f2c200', ink: '#2b2200' },
    { max: 150, key: 'usg', label: 'Unhealthy for sensitive groups', short: 'Unhealthy (sensitive)', color: '#ff7e00', ink: '#2a1300' },
    { max: 200, key: 'unhealthy', label: 'Unhealthy', color: '#e8222e', ink: '#ffffff' },
    { max: 300, key: 'very', label: 'Very unhealthy', color: '#8f3f97', ink: '#ffffff' },
    { max: Infinity, key: 'hazardous', label: 'Hazardous', color: '#7e0023', ink: '#ffffff' }
  ];
  // Malaysian Air Pollutant Index (DOE) categories and official colours.
  const MY_CATS = [
    { max: 50, key: 'good', label: 'Good', color: '#1e6ff0', ink: '#ffffff' },
    { max: 100, key: 'moderate', label: 'Moderate', color: '#13a538', ink: '#ffffff' },
    { max: 200, key: 'unhealthy', label: 'Unhealthy', color: '#f2c200', ink: '#2b2200' },
    { max: 300, key: 'very', label: 'Very unhealthy', color: '#ff7e00', ink: '#2a1300' },
    { max: Infinity, key: 'hazardous', label: 'Hazardous', color: '#e8222e', ink: '#ffffff' }
  ];
  function cat(v, scale) {
    if (v == null || !isFinite(v)) return { key: 'na', label: 'No data', color: '#8a94a6', ink: '#ffffff' };
    const list = scale === 'MY' ? MY_CATS : US_CATS;
    return list.find(c => v <= c.max);
  }
  const DOE_SYMBOLS = { '**': 'PM2.5', '*': 'PM10', a: 'SO₂', b: 'NO₂', c: 'O₃', d: 'CO', '&': '2+ pollutants' };

  /* ---------- geo ---------- */
  function distKm(a, b, c, d) {
    const R = 6371, toR = x => (x * Math.PI) / 180;
    const dLat = toR(c - a), dLon = toR(d - b);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a)) * Math.cos(toR(c)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  /* ---------- heat ---------- */
  function heatIndexC(tC, rh) {
    if (tC == null || rh == null) return null;
    const T = (tC * 9) / 5 + 32;
    let HI = 0.5 * (T + 61 + (T - 68) * 1.2 + rh * 0.094);
    if ((HI + T) / 2 >= 80) {
      HI = -42.379 + 2.04901523 * T + 10.14333127 * rh - 0.22475541 * T * rh - 0.00683783 * T * T -
        0.05481717 * rh * rh + 0.00122874 * T * T * rh + 0.00085282 * T * rh * rh - 0.00000199 * T * T * rh * rh;
      if (rh < 13 && T >= 80 && T <= 112) HI -= ((13 - rh) / 4) * Math.sqrt((17 - Math.abs(T - 95)) / 17);
      else if (rh > 85 && T >= 80 && T <= 87) HI += ((rh - 85) / 10) * ((87 - T) / 5);
    }
    return ((HI - 32) * 5) / 9;
  }
  const HEAT_CATS = [
    { max: 27, key: 'none', label: 'Comfortable', mult: { easy: 1, moderate: 1, hard: 1 } },
    { max: 32, key: 'caution', label: 'Caution', mult: { easy: 1, moderate: 1, hard: 0.9 } },
    { max: 41, key: 'xcaution', label: 'Extreme caution', mult: { easy: 0.9, moderate: 0.75, hard: 0.5 } },
    { max: 54, key: 'danger', label: 'Danger', mult: { easy: 0.5, moderate: 0.33, hard: 0 } },
    { max: Infinity, key: 'xdanger', label: 'Extreme danger', mult: { easy: 0, moderate: 0, hard: 0 } }
  ];
  function heatCat(hi) { return hi == null ? null : HEAT_CATS.find(c => hi < c.max); }

  /* ---------- source: aqicn / WAQI station ---------- */
  async function fetchWaqi(loc) {
    const tk = settings.token();
    if (!tk) { const e = new Error('Add your free aqicn token in Settings to get live station readings.'); e.code = 'no-token'; throw e; }
    const key = loc.waqi || `geo:${loc.lat};${loc.lon}`;
    const j = await getJSON(`https://api.waqi.info/feed/${key}/?token=${encodeURIComponent(tk)}`);
    if (j.status !== 'ok') {
      const msg = typeof j.data === 'string' ? j.data : 'aqicn error';
      const e = new Error(msg === 'Invalid key' ? 'aqicn rejected the token — check it in Settings.' : 'aqicn: ' + msg);
      e.code = msg === 'Invalid key' ? 'bad-token' : 'waqi'; throw e;
    }
    const d = j.data;
    const iv = k => (d.iaqi && d.iaqi[k] && isFinite(d.iaqi[k].v) ? +d.iaqi[k].v : null);
    let t = d.time && d.time.iso ? Date.parse(d.time.iso) : NaN;
    if (!isFinite(t) && d.time && d.time.s) t = Date.parse(d.time.s.replace(' ', 'T') + (d.time.tz || '+08:00'));
    const geo = d.city && d.city.geo ? d.city.geo.map(Number) : null;
    const st = {
      idx: d.idx, name: d.city ? d.city.name : 'Station', url: d.city ? d.city.url : null, geo,
      aqi: isFinite(+d.aqi) ? +d.aqi : null, dominant: d.dominentpol || null, time: isFinite(t) ? t : null,
      iaqi: { pm25: iv('pm25'), pm10: iv('pm10'), o3: iv('o3'), no2: iv('no2'), so2: iv('so2'), co: iv('co') },
      wx: { t: iv('t'), h: iv('h'), p: iv('p'), w: iv('w'), dew: iv('dew') },
      forecast: (d.forecast && d.forecast.daily) || {},
      attributions: d.attributions || []
    };
    st.dist = geo ? distKm(loc.lat, loc.lon, geo[0], geo[1]) : null;
    st.demo = tk === 'demo';
    st.pm25Conc = fromAqi('pm25', st.iaqi.pm25);
    st.pm10Conc = fromAqi('pm10', st.iaqi.pm10);
    const pols = ['pm25', 'pm10', 'o3', 'no2', 'so2', 'co'].map(k => st.iaqi[k]).filter(v => v != null);
    st.usMax = pols.length ? Math.max(...pols) : null; // US‑EPA AQI from the hourly sub‑indices
    return st;
  }

  /* ---------- source: Malaysian DOE (APIMS), cached hourly by the GitHub Action ---------- */
  let doeCache = null, doeAt = 0;
  async function loadDoe(force) {
    if (doeCache && !force && Date.now() - doeAt < 10 * 60e3) return doeCache;
    try {
      const j = await getJSON(CFG.DOE_CACHE_URL + '?_=' + Date.now(), 10000);
      doeCache = j; doeAt = Date.now();
    } catch (e) { doeCache = { error: e.message, stations: [] }; doeAt = Date.now(); }
    return doeCache;
  }
  function nearestDoe(cache, lat, lon, maxKm = 40) {
    if (!cache || !cache.stations) return [];
    return cache.stations
      .map(s => Object.assign({}, s, { dist: distKm(lat, lon, s.lat, s.lon) }))
      .filter(s => s.dist <= maxKm)
      .sort((a, b) => a.dist - b.dist);
  }

  /* ---------- station history (GitHub Action log + readings recorded on this device) ---------- */
  let histCache = null, histAt = 0;
  async function loadHistoryFile(force) {
    if (histCache && !force && Date.now() - histAt < 10 * 60e3) return histCache;
    try { histCache = await getJSON(CFG.HISTORY_URL + '?_=' + Date.now(), 10000); }
    catch (e) { histCache = { stations: {} }; }
    histAt = Date.now();
    return histCache;
  }
  function recordLocal(st) {
    if (!st || st.idx == null || st.time == null || st.demo) return;
    const all = store.get('hist', {});
    const arr = all[st.idx] || [];
    if (!arr.some(r => r[0] === st.time)) arr.push([st.time, st.aqi, st.iaqi.pm25, st.iaqi.pm10]);
    const cutoff = Date.now() - 72 * HOUR;
    all[st.idx] = arr.filter(r => r[0] >= cutoff).sort((a, b) => a[0] - b[0]);
    store.set('hist', all);
  }
  function stationHistory(idx, file) {
    const map = new Map();
    const fromFile = (file && file.stations && file.stations[idx]) || [];
    fromFile.forEach(r => map.set(r[0] * 1000, { t: r[0] * 1000, aqi: r[1], pm25: r[2], pm10: r[3] }));
    (store.get('hist', {})[idx] || []).forEach(r => map.set(r[0], { t: r[0], aqi: r[1], pm25: r[2], pm10: r[3] }));
    return [...map.values()].sort((a, b) => a.t - b.t);
  }

  /* ---------- source: Open‑Meteo air‑quality model (CAMS) ---------- */
  async function fetchModel(loc) {
    const vars = 'pm2_5,pm10,ozone,nitrogen_dioxide,sulphur_dioxide,carbon_monoxide,dust,uv_index';
    const j = await getJSON(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${loc.lat}&longitude=${loc.lon}` +
      `&hourly=${vars}&past_days=3&forecast_days=5&timezone=auto&timeformat=unixtime`);
    if (j.error) throw new Error(j.reason || 'model error');
    const h = j.hourly;
    const rows = [];
    for (let i = 0; i < h.time.length; i++) {
      if (h.pm2_5[i] == null) continue;
      const r = {
        t: h.time[i] * 1000, pm25: h.pm2_5[i], pm10: h.pm10[i], o3: h.ozone[i], no2: h.nitrogen_dioxide[i],
        so2: h.sulphur_dioxide[i], co: h.carbon_monoxide[i], dust: h.dust[i], uv: h.uv_index[i]
      };
      r.aqiPm25 = toAqi('pm25', r.pm25);
      r.aqiPm10 = toAqi('pm10', r.pm10);
      r.aqiO3 = toAqi('o3', r.o3 != null ? r.o3 / UG_PER_PPB.o3 : null);
      r.aqiNo2 = toAqi('no2', r.no2 != null ? r.no2 / UG_PER_PPB.no2 : null);
      r.aqi = Math.max(...[r.aqiPm25, r.aqiPm10, r.aqiO3, r.aqiNo2].filter(v => v != null));
      rows.push(r);
    }
    return { tz: j.timezone || 'Asia/Kuala_Lumpur', rows };
  }

  /* ---------- source: Open‑Meteo weather ---------- */
  async function fetchWeather(loc) {
    const cur = 'temperature_2m,relative_humidity_2m,apparent_temperature,dew_point_2m,wind_speed_10m,precipitation,weather_code,uv_index,is_day';
    const hr = 'temperature_2m,relative_humidity_2m,apparent_temperature,precipitation_probability,precipitation,weather_code,uv_index,wind_speed_10m,is_day';
    const j = await getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}` +
      `&current=${cur}&hourly=${hr}&forecast_days=3&timezone=auto&timeformat=unixtime&wind_speed_unit=kmh`);
    if (j.error) throw new Error(j.reason || 'weather error');
    const c = j.current, h = j.hourly;
    const current = {
      t: c.time * 1000, temp: c.temperature_2m, rh: c.relative_humidity_2m, feels: c.apparent_temperature, dew: c.dew_point_2m,
      wind: c.wind_speed_10m, rain: c.precipitation, code: c.weather_code, uv: c.uv_index, isDay: !!c.is_day
    };
    current.hi = heatIndexC(current.temp, current.rh);
    const hourly = h.time.map((t, i) => ({
      t: t * 1000, temp: h.temperature_2m[i], rh: h.relative_humidity_2m[i], feels: h.apparent_temperature[i],
      pop: h.precipitation_probability[i], rain: h.precipitation[i], code: h.weather_code[i], uv: h.uv_index[i],
      wind: h.wind_speed_10m[i], isDay: !!h.is_day[i], hi: heatIndexC(h.temperature_2m[i], h.relative_humidity_2m[i])
    }));
    return { tz: j.timezone, current, hourly };
  }

  /* ---------- running guidance ---------- */
  const RUN_BANDS = [
    { max: 50, tone: 'good', verdict: 'Great for running', note: 'Air is clean. Any intensity, any duration.', easy: Infinity, moderate: Infinity, hard: Infinity },
    { max: 75, tone: 'good', verdict: 'Good for running', note: 'Fine for everyone. Very long, hard sessions add a little extra dose.', easy: Infinity, moderate: 120, hard: 75 },
    { max: 100, tone: 'ok', verdict: 'OK — keep hard efforts shorter', note: 'Acceptable air. Easy running is fine; trim long hard sessions.', easy: 120, moderate: 75, hard: 45 },
    { max: 125, tone: 'caution', verdict: 'Caution — shorten your run', note: 'Heavy breathing pulls in much more PM2.5. Keep it easy and shorter.', easy: 75, moderate: 45, hard: 25 },
    { max: 150, tone: 'caution', verdict: 'Limit outdoor running', note: 'Sensitive groups should move indoors. Others: short and easy.', easy: 45, moderate: 30, hard: 15 },
    { max: 200, tone: 'bad', verdict: 'Better to run indoors', note: 'Unhealthy for everyone during exertion. Hard efforts outdoors not advised.', easy: 30, moderate: 15, hard: 0 },
    { max: 300, tone: 'bad', verdict: 'Run indoors', note: 'Very unhealthy. Only brief, easy activity outside if unavoidable.', easy: 10, moderate: 0, hard: 0 },
    { max: Infinity, tone: 'bad', verdict: 'Do not run outside', note: 'Hazardous air. Stay indoors with windows closed.', easy: 0, moderate: 0, hard: 0 }
  ];
  const INTENSITIES = [
    { key: 'easy', label: 'Low intensity', sub: 'Easy / recovery · conversational pace · Zone 1–2 (<70% HRmax)' },
    { key: 'moderate', label: 'Moderate intensity', sub: 'Steady / long run · can speak in short sentences · Zone 3 (70–80% HRmax)' },
    { key: 'hard', label: 'High intensity', sub: 'Tempo, intervals, races · few words only · Zone 4–5 (>80% HRmax)' }
  ];
  function bandIndex(aqi) { return RUN_BANDS.findIndex(b => aqi <= b.max); }

  function runAdvice(input) {
    const { aqi, aqiSource, sensitive, wx, trend } = input;
    if (aqi == null) return null;
    let idx = bandIndex(aqi);
    if (sensitive) idx = Math.min(idx + 2, RUN_BANDS.length - 1);
    const band = RUN_BANDS[idx];
    const hi = wx ? (wx.hi != null ? wx.hi : wx.feels) : null;
    const hc = heatCat(hi);
    const thunder = wx && wx.code >= 95;
    const rows = INTENSITIES.map(it => {
      let air = band[it.key];
      let mins = air;
      let limiter = air === Infinity ? null : 'air';
      if (hc && hc.mult[it.key] < 1) {
        const base = air === Infinity ? 150 : air;
        const heatMins = Math.round((base * hc.mult[it.key]) / 5) * 5;
        if (heatMins < (air === Infinity ? Infinity : air)) { mins = heatMins; limiter = 'heat'; }
      }
      return Object.assign({}, it, { mins, airMins: air, limiter });
    });
    let tone = band.tone;
    let verdict = band.verdict;
    const airOk = band.tone === 'good' || band.tone === 'ok';
    if (hc && hc.key === 'xdanger') { tone = 'bad'; verdict = 'Too hot to run outside'; }
    else if (hc && hc.key === 'danger') { tone = 'bad'; verdict = airOk ? 'Air is fine, but it is dangerously hot' : band.verdict + ' — and very hot'; }
    else if (hc && hc.key === 'xcaution' && airOk) { tone = tone === 'good' ? 'ok' : tone; verdict = band.max <= 50 ? 'Clean air — but hot & humid, go easier' : 'Air OK — heat is the main limit'; }
    const tips = [];
    if (sensitive) tips.push('Sensitive mode is on: limits are set two levels stricter than for healthy adults.');
    if (hc && hc.key !== 'none') {
      const t = { caution: 'Warm and humid — drink before and during, and slow your pace a little.',
        xcaution: 'Heat stress is high — run early morning or after sunset, carry water, cut hard sessions short.',
        danger: 'Dangerous heat — avoid hard running outdoors; if you go, keep it short, easy and shaded.',
        xdanger: 'Extreme heat — do not run outside.' }[hc.key];
      tips.push(t);
    }
    if (thunder) { tips.push('Thunderstorm in the area — wait until it has passed (30 min after the last thunder).'); tone = 'bad'; }
    if (wx && wx.uv != null && wx.uv >= 8) tips.push(`UV index ${Math.round(wx.uv)} — cap, sunglasses and sunscreen.`);
    if (trend && trend.delta >= 20) tips.push(`Air quality is forecast to worsen over the next ${trend.hours} h (≈${trend.to}). Go sooner rather than later.`);
    if (trend && trend.delta <= -20) tips.push(`Air is forecast to improve over the next ${trend.hours} h (≈${trend.to}). Waiting may help.`);
    if (aqi > 150) tips.push('If you must be outside, a well‑fitted N95/KN95 helps at rest or walking — not during hard running.');
    if (aqi > 100) tips.push('Choose routes away from main roads and traffic, and favour parks/green areas.');
    return {
      aqi, aqiSource, sensitive, band, verdict: thunder ? 'Wait — thunderstorm nearby' : verdict, note: band.note,
      tone, rows, heat: hc ? Object.assign({ hi }, hc) : null, tips
    };
  }
  function fmtMins(m) {
    if (m === Infinity) return 'No limit';
    if (!m) return 'Avoid';
    if (m < 60) return `Up to ${m} min`;
    const h = Math.floor(m / 60), r = m % 60;
    return `Up to ${h} h${r ? ' ' + r + ' min' : ''}`;
  }

  /* ---------- best time to run (next 24 h) ---------- */
  function bestWindows(fc, weather, tz, sensitive) {
    if (!fc || !fc.length || !weather) return [];
    const now = Date.now();
    const hourFmt = new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: tz });
    const cands = [];
    for (const w of weather.hourly) {
      if (w.t < now - 30 * 60e3 || w.t > now + 24 * HOUR) continue;
      const hr = +hourFmt.format(new Date(w.t));
      if (hr < 5 || hr > 21) continue; // daylight-ish running hours 05:00–21:59
      const a = fc.reduce((best, r) => (Math.abs(r.t - w.t) < Math.abs(best.t - w.t) ? r : best), fc[0]);
      if (Math.abs(a.t - w.t) > 2 * HOUR) continue;
      const aqi = a.aqiAdj != null ? a.aqiAdj : a.aqi;
      const adv = runAdvice({ aqi, sensitive, wx: w });
      const modMins = Math.min(150, adv.rows[1].mins);
      const score = modMins - (w.pop || 0) * 1.2 - (w.code >= 95 ? 120 : 0) - aqi * 0.3 - Math.max(0, (w.hi || 0) - 27) * 3;
      cands.push({ t: w.t, aqi, hi: w.hi, temp: w.temp, pop: w.pop, code: w.code, uv: w.uv, adv, score });
    }
    cands.sort((a, b) => b.score - a.score);
    const picks = [];
    for (const c of cands) {
      if (picks.every(p => Math.abs(p.t - c.t) >= 3 * HOUR)) picks.push(c);
      if (picks.length === 3) break;
    }
    return picks.sort((a, b) => a.t - b.t);
  }

  /* ---------- assemble everything for one location ---------- */
  async function load(loc, opts = {}) {
    const force = !!opts.force;
    const [stR, modelR, wxR, doeR, histR] = await Promise.allSettled([
      fetchWaqi(loc), fetchModel(loc), fetchWeather(loc), loadDoe(force), loadHistoryFile(force)
    ]);
    const S = { loc, fetchedAt: Date.now(), warnings: [] };
    S.station = stR.status === 'fulfilled' ? stR.value : null;
    S.stationError = stR.status === 'rejected' ? stR.reason : null;
    S.model = modelR.status === 'fulfilled' ? modelR.value : null;
    S.modelError = modelR.status === 'rejected' ? modelR.reason.message : null;
    S.weather = wxR.status === 'fulfilled' ? wxR.value : null;
    S.weatherError = wxR.status === 'rejected' ? wxR.reason.message : null;
    const doeFile = doeR.status === 'fulfilled' ? doeR.value : null;
    const histFile = histR.status === 'fulfilled' ? histR.value : null;
    S.tz = (S.model && S.model.tz) || (S.weather && S.weather.tz) || 'Asia/Kuala_Lumpur';

    const st = S.station;
    if (st) {
      if (st.demo) S.warnings.push('You are using the "demo" token — aqicn returns Shanghai for every request. Add your own free token in Settings.');
      if (st.dist != null && st.dist > 30) { st.far = true; S.warnings.push(`Nearest aqicn station (${st.name}) is ${Math.round(st.dist)} km away — readings may not reflect this location.`); }
      if (st.time && Date.now() - st.time > 3 * HOUR) { st.stale = true; S.warnings.push(`The station's latest reading is ${Math.round((Date.now() - st.time) / HOUR)} h old.`); }
      recordLocal(st);
    }

    /* DOE */
    S.doe = null; S.doeError = null;
    if (doeFile && !doeFile.error && doeFile.stations && doeFile.stations.length) {
      const near = nearestDoe(doeFile, loc.lat, loc.lon);
      const age = doeFile.updated ? Date.now() - Date.parse(doeFile.updated) : Infinity;
      if (near.length) {
        S.doe = { updated: doeFile.updated, stale: age > 3 * HOUR, nearest: near, primary: near[0] };
        const p = near[0];
        p.timeMs = Date.parse(p.time);
        p.hist = (p.hist || []).map(r => ({ t: r[0] * 1000, api: r[1], sym: r[2] }));
        if (S.doe.stale) S.warnings.push('The cached DOE data is more than 3 h old — the hourly GitHub job may be paused.');
      }
    } else if (doeFile && doeFile.error) {
      S.doeError = 'DOE cache not available (' + doeFile.error + ')';
    }

    /* Scale of aqicn's headline AQI: for many Malaysian stations it is the DOE's Malaysian API (24‑h based). */
    if (st && st.aqi != null) {
      st.scale = 'US';
      const doeNear = S.doe && S.doe.primary && S.doe.primary.dist < 15 ? S.doe.primary : null;
      if (doeNear && Math.abs(doeNear.api - st.aqi) <= 1 && st.aqi !== st.usMax) st.scale = 'MY';
      else if (st.usMax != null && st.aqi !== st.usMax && /malaysia|jabatan|doe/i.test(JSON.stringify(st.attributions))) st.scale = 'MY';
    }

    /* Station history */
    S.stationHist = st ? stationHistory(st.idx, histFile) : [];

    /* Model + station adjustment */
    if (S.model) {
      const rows = S.model.rows;
      const now = Date.now();
      const nearestRow = t => rows.reduce((b, r) => (Math.abs(r.t - t) < Math.abs(b.t - t) ? r : b), rows[0]);
      S.model.now = nearestRow(now);
      let ratio = null, ref = null;
      if (st && !st.far && !st.demo && st.pm25Conc != null && st.time) {
        ref = nearestRow(st.time);
        if (ref && ref.pm25 > 0.5) ratio = Math.min(4, Math.max(0.25, st.pm25Conc / ref.pm25));
      }
      let t0 = st && st.time ? st.time : now;
      S.model.ratioSrc = ratio != null ? 'station' : null;
      // No usable aqicn station? Calibrate against the official DOE reading instead.
      // DOE's API is scaled so that 100 = the 24‑h PM2.5 standard (35 µg/m³, MAAQS 2020); below that it is
      // linear, so API ≈ PM2.5(24‑h mean) / 0.35. Only used when PM2.5 is the dominant pollutant and API ≤ 100.
      const dp = S.doe && S.doe.primary;
      if (ratio == null && dp && dp.dist <= 25 && !S.doe.stale && dp.sym === '**' && dp.api > 0 && dp.api <= 100 && isFinite(dp.timeMs)) {
        const win = rows.filter(r => r.t > dp.timeMs - 24 * HOUR && r.t <= dp.timeMs);
        if (win.length >= 18) {
          const m24 = win.reduce((s, r) => s + r.pm25, 0) / win.length;
          if (m24 > 0.5) { ratio = Math.min(4, Math.max(0.25, (dp.api * 0.35) / m24)); S.model.ratioSrc = 'DOE'; t0 = dp.timeMs; }
        }
      }
      S.model.ratio = ratio;
      rows.forEach(r => {
        if (ratio != null && r.t >= t0 - HOUR) {
          const k = 1 + (ratio - 1) * Math.exp(-Math.max(0, r.t - t0) / (24 * HOUR));
          r.pm25Adj = r.pm25 * k;
          r.aqiPm25Adj = toAqi('pm25', r.pm25Adj);
          r.aqiAdj = Math.max(...[r.aqiPm25Adj, r.aqiPm10, r.aqiO3, r.aqiNo2].filter(v => v != null));
        } else { r.pm25Adj = null; r.aqiPm25Adj = null; r.aqiAdj = null; }
      });
      S.forecast = rows.filter(r => r.t >= now - HOUR);
    } else S.forecast = [];

    /* Headline numbers */
    const H = {};
    if (st && !st.demo) {
      H.aqi = st.aqi; H.aqiScale = st.scale; H.aqiSrc = 'aqicn station';
      H.pm25Aqi = st.iaqi.pm25; H.pm25Src = 'aqicn station';
      H.pm25Conc = st.pm25Conc; H.pm25ConcSrc = 'derived from station PM2.5 AQI';
      H.time = st.time;
    }
    if (H.aqi == null && S.doe) { H.aqi = S.doe.primary.api; H.aqiScale = 'MY'; H.aqiSrc = 'DOE ' + S.doe.primary.name; H.time = S.doe.primary.timeMs; }
    if (S.model && S.model.now) {
      const m = S.model.now, cal = m.aqiPm25Adj != null;
      const lbl = cal ? 'estimate: model calibrated to DOE station' : 'model (CAMS)';
      if (H.aqi == null) { H.aqi = cal ? m.aqiAdj : m.aqi; H.aqiScale = 'US'; H.aqiSrc = lbl; H.time = m.t; }
      if (H.pm25Aqi == null) { H.pm25Aqi = cal ? m.aqiPm25Adj : m.aqiPm25; H.pm25Src = lbl; }
      if (H.pm25Conc == null) { H.pm25Conc = cal ? m.pm25Adj : m.pm25; H.pm25ConcSrc = lbl; }
    }
    S.head = H;

    /* AQI used for running guidance: US AQI "now" (hourly), most local source first */
    let runAqi = null, runSrc = null;
    if (st && !st.demo && !st.far && st.usMax != null && !st.stale) { runAqi = st.usMax; runSrc = 'station (hourly, US AQI)'; }
    else if (S.model && S.model.now && S.model.now.aqiAdj != null) { runAqi = S.model.now.aqiAdj; runSrc = S.model.ratioSrc === 'DOE' ? 'model calibrated to DOE station (estimate)' : 'station‑adjusted model'; }
    else if (S.doe && S.doe.primary.dist <= 25 && !S.doe.stale) { runAqi = S.doe.primary.api; runSrc = 'DOE API (24‑h average)'; }
    else if (S.model && S.model.now) { runAqi = S.model.now.aqi; runSrc = 'model only (CAMS) — less reliable'; }
    let trend = null;
    if (S.forecast.length && runAqi != null) {
      const t3 = S.forecast.find(r => r.t >= Date.now() + 3 * HOUR);
      if (t3) { const v = t3.aqiAdj != null ? t3.aqiAdj : t3.aqi; trend = { hours: 3, to: v, delta: v - (S.model.now.aqiAdj != null ? S.model.now.aqiAdj : S.model.now.aqi) }; }
    }
    S.run = runAdvice({ aqi: runAqi, aqiSource: runSrc, sensitive: settings.sensitive(), wx: S.weather && S.weather.current, trend });
    S.best = bestWindows(S.forecast, S.weather, S.tz, settings.sensitive());
    return S;
  }

  /* quick summary for favourite chips / side list */
  async function quick(loc) {
    try {
      const st = await fetchWaqi(loc);
      recordLocal(st);
      const scale = st.usMax != null && st.aqi !== st.usMax && /malaysia|jabatan|doe/i.test(JSON.stringify(st.attributions)) ? 'MY' : 'US';
      return { aqi: st.aqi, scale, pm25: st.iaqi.pm25, time: st.time, src: 'station' };
    } catch (e) {
      try {
        const m = await getJSON(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${loc.lat}&longitude=${loc.lon}&current=pm2_5`);
        const a = toAqi('pm25', m.current.pm2_5);
        return { aqi: a, pm25: a, src: 'model' };
      } catch (e2) { return null; }
    }
  }

  /* ---------- directory of all monitoring stations in Malaysia ---------- */
  const NOT_MY = /singapore|indonesia|thailand|brunei|riau|batam|pekanbaru|dumai|medan|aceh|songkhla|hat yai|narathiwat|yala|satun|pattani|pontianak|kalimantan|bandar seri begawan|tutong|belait/i;
  const titleCase = s => s.toLowerCase().replace(/(^|[\s(\/-])(\w)/g, (m, a, b) => a + b.toUpperCase());
  let dirCache = null, dirAt = 0;
  async function stationDirectory(force) {
    if (dirCache && !force && Date.now() - dirAt < 10 * 60e3) return dirCache;
    const doeFile = await loadDoe(force);
    const live = new Map(((doeFile && doeFile.stations) || []).map(s => [s.id, s]));
    const fresh = doeFile && doeFile.updated && Date.now() - Date.parse(doeFile.updated) < 3 * HOUR;
    const doe = (window.AQ_DOE_STATIONS || []).map(([id, name, state, lat, lon]) => ({ id, name, state, lat, lon }));
    live.forEach((s, id) => { if (!doe.some(d => d.id === id)) doe.push({ id, name: s.name, state: s.state, lat: s.lat, lon: s.lon }); });
    doe.forEach(d => {
      const l = live.get(d.id);
      d.api = l && fresh ? l.api : null; d.sym = l ? l.sym : null; d.time = l ? Date.parse(l.time) : null;
      if (/^[A-Z\s]+$/.test(d.name)) d.name = titleCase(d.name);
    });
    let waqi = null, waqiError = null;
    const tk = settings.token();
    if (!tk || tk === 'demo') waqiError = 'no-token';
    else {
      try {
        const j = await getJSON(`https://api.waqi.info/map/bounds/?latlng=0.85,99.6,7.45,119.3&networks=all&token=${encodeURIComponent(tk)}`, 20000);
        if (j.status !== 'ok') throw new Error(typeof j.data === 'string' ? j.data : 'aqicn error');
        waqi = (j.data || []).map(s => {
          const name = (s.station && s.station.name) || ('Station ' + s.uid);
          const lat = +s.lat, lon = +s.lon;
          let near = null;
          doe.forEach(d => { const km = distKm(lat, lon, d.lat, d.lon); if (!near || km < near.km) near = { d, km }; });
          return { uid: s.uid, name, lat, lon, aqi: isFinite(+s.aqi) ? +s.aqi : null, time: s.station && s.station.time ? Date.parse(s.station.time) : null, near };
        }).filter(s => /malaysia/i.test(s.name) || (!NOT_MY.test(s.name) && s.near && s.near.km <= 45))
          .map(s => ({
            uid: s.uid, lat: s.lat, lon: s.lon, aqi: s.aqi, time: s.time,
            name: s.name.replace(/,\s*Malaysia\s*$/i, '').replace(/\s*\(.*?\)\s*$/, ''),
            state: s.near && s.near.km <= 80 ? s.near.d.state : 'Other',
            doeMatch: s.near && s.near.km <= 1.5 ? s.near.d.id : null
          }));
      } catch (e) { waqiError = e.message; }
    }
    // link each DOE station to its aqicn mirror (same site) so selecting it uses the exact station feed
    if (waqi) doe.forEach(d => {
      const m = waqi.filter(w => w.doeMatch === d.id).sort((a, b) => distKm(a.lat, a.lon, d.lat, d.lon) - distKm(b.lat, b.lon, d.lat, d.lon))[0];
      if (m) { d.waqi = '@' + m.uid; d.waqiAqi = m.aqi; }
    });
    dirCache = { doe, waqi, waqiError, doeLive: !!fresh, doeUpdated: doeFile && doeFile.updated, states: window.AQ_STATE_ORDER || [] };
    dirAt = Date.now();
    return dirCache;
  }

  /* ---------- search ---------- */
  async function search(q) {
    q = (q || '').trim();
    const out = { places: [], stations: [], errors: [] };
    if (q.length < 2) return out;
    const [name, ...rest] = q.split(',').map(s => s.trim());
    const hint = rest.join(' ').toLowerCase();
    const tasks = [
      getJSON(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=10&language=en&format=json`)
        .then(j => {
          let res = (j.results || []).map(r => ({
            id: 'geo:' + r.id, name: r.name, region: [r.admin2 && r.admin2 !== r.name ? r.admin2 : null, r.admin1, r.country].filter(Boolean).join(', '),
            lat: r.latitude, lon: r.longitude, waqi: null, country: r.country_code
          }));
          if (hint) res.sort((a, b) => (b.region.toLowerCase().includes(hint) ? 1 : 0) - (a.region.toLowerCase().includes(hint) ? 1 : 0));
          out.places = res;
        }).catch(e => out.errors.push('places: ' + e.message))
    ];
    const tk = settings.token();
    if (tk && tk !== 'demo') {
      tasks.push(getJSON(`https://api.waqi.info/search/?keyword=${encodeURIComponent(q)}&token=${encodeURIComponent(tk)}`)
        .then(j => {
          if (j.status === 'ok') out.stations = j.data.slice(0, 12).map(s => ({
            id: 'waqi:' + s.uid, name: s.station.name, region: 'aqicn monitoring station', lat: +s.station.geo[0], lon: +s.station.geo[1],
            waqi: '@' + s.uid, aqi: isFinite(+s.aqi) ? +s.aqi : null, aqicnUrl: s.station.url ? 'https://aqicn.org/city/' + s.station.url + '/' : null
          }));
        }).catch(e => out.errors.push('stations: ' + e.message)));
    }
    await Promise.all(tasks);
    return out;
  }

  window.AQ = {
    CFG, HOUR, settings, favourites, DEFAULTS, load, quick, search, stationDirectory, toAqi, fromAqi, cat, heatCat, heatIndexC,
    US_CATS, MY_CATS, DOE_SYMBOLS, RUN_BANDS, INTENSITIES, fmtMins, distKm, store
  };
})();
