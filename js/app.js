/* AirCheck UI — shared by index.html (mobile) and desktop.html (desktop).
   Each page provides the same element IDs; CSS decides the layout. */
(function () {
  'use strict';
  const { HOUR } = AQ;
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const LAYOUT = document.body.dataset.layout || 'mobile';

  const ui = {
    current: null, state: null, loading: false, quickCache: {},
    histRange: +AQ.store.get('histRange', 24), fcRange: +AQ.store.get('fcRange', 48),
    pmUnit: AQ.store.get('pmUnit', 'aqi'), charts: {}, pendingReplace: false
  };

  /* ---------- formatting ---------- */
  const fmt = {
    time(t, tz) { return t == null ? '—' : new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz }).format(t); },
    dayTime(t, tz) { return t == null ? '—' : new Intl.DateTimeFormat('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz }).format(t); },
    hourLabel(t, tz, withDay) {
      const o = { hour: '2-digit', hour12: false, timeZone: tz };
      if (withDay) o.weekday = 'short';
      return new Intl.DateTimeFormat('en-GB', o).format(t).replace(',', '');
    },
    ago(t) {
      if (t == null) return '';
      const m = Math.round((Date.now() - t) / 60000);
      if (m < 1) return 'just now'; if (m < 60) return m + ' min ago';
      const h = Math.round(m / 60); return h + ' h ago';
    },
    n(v, d = 0) { return v == null || !isFinite(v) ? '—' : (+v).toFixed(d); }
  };
  const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  function hexA(hex, a) {
    const h = hex.replace('#', ''); const n = parseInt(h.length === 3 ? h.split('').map(x => x + x).join('') : h, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }
  function badge(v, scale, extra = '') {
    const c = AQ.cat(v, scale);
    return `<span class="badge ${extra}" style="--b:${c.color};--bi:${c.ink}">${v == null ? '—' : Math.round(v)}</span>`;
  }
  const scaleName = s => (s === 'MY' ? 'Malaysian API (DOE)' : 'US AQI');

  /* ---------- favourites ---------- */
  function renderFavs() {
    const favs = AQ.favourites.list();
    const html = favs.map(f => {
      const q = ui.quickCache[f.id];
      const active = ui.current && ui.current.id === f.id;
      return `<button class="fav ${active ? 'active' : ''}" data-id="${esc(f.id)}" aria-pressed="${active}">
        <span class="fav-name">${esc(f.name)}${f.fav4 ? ' <span class="star" aria-label="4th favourite">★</span>' : ''}</span>
        <span class="fav-sub">${esc(f.region || '')}</span>
        ${q ? badge(q.aqi, q.scale || 'US', 'sm') : '<span class="badge sm ghost">…</span>'}
      </button>`;
    }).join('') + (AQ.favourites.fav4() ? '' : `<button class="fav add" data-act="add-fav"><span class="fav-name">＋ 4th favourite</span><span class="fav-sub">Search a place</span></button>`);
    $('#favs').innerHTML = html;
    if (ui.current && ui.current.id === 'custom') {
      const cust = `<button class="fav active custom" aria-pressed="true"><span class="fav-name">${esc(ui.current.name)}</span><span class="fav-sub">Searched</span></button>`;
      $('#favs').insertAdjacentHTML('beforeend', cust);
    }
  }
  async function refreshQuick() {
    // headline AQI per favourite for the chips / sidebar (same feed as the main view)
    const favs = AQ.favourites.list();
    await Promise.all(favs.map(async f => {
      if (ui.state && ui.state.loc.id === f.id && ui.state.head.aqi != null) {
        ui.quickCache[f.id] = { aqi: ui.state.head.aqi, scale: ui.state.head.aqiScale, src: 'station' }; return;
      }
      const q = await AQ.quick(f); if (q) ui.quickCache[f.id] = q;
    }));
    renderFavs();
  }

  /* ---------- header / save-fav ---------- */
  function renderHeader(S) {
    const loc = ui.current;
    $('#loc-title').textContent = loc.name;
    $('#loc-sub').textContent = [loc.region, S && S.station && !S.station.demo ? 'Station: ' + S.station.name : null].filter(Boolean).join(' · ');
    $('#updated').textContent = S ? 'Updated ' + fmt.time(S.fetchedAt, S.tz) : 'Loading…';
    const sv = $('#fav-action');
    if (loc.id === 'custom') {
      const f4 = AQ.favourites.fav4();
      sv.hidden = false;
      sv.innerHTML = ui.pendingReplace && f4
        ? `<button class="btn primary" data-act="save-fav">Replace “${esc(f4.name)}”?</button><button class="btn ghost" data-act="cancel-save">Cancel</button>`
        : `<button class="btn primary" data-act="save-fav">☆ Save as 4th favourite</button>`;
    } else if (loc.fav4) {
      sv.hidden = false;
      sv.innerHTML = `<span class="muted small">★ Your 4th favourite</span> <button class="btn ghost small" data-act="remove-fav">Remove</button>`;
    } else { sv.hidden = true; sv.innerHTML = ''; }
  }

  /* ---------- warnings ---------- */
  function renderWarnings(S) {
    const w = S.warnings.slice();
    if (S.stationError) {
      w.unshift(S.stationError.code === 'no-token'
        ? 'Live station readings are off: add your free aqicn token in <button class="link" data-act="settings">Settings</button>. Showing DOE + model data meanwhile.'
        : esc(S.stationError.message || S.stationError) + ' — showing DOE + model data.');
    }
    if (S.modelError) w.push('Model data unavailable: ' + esc(S.modelError));
    if (S.weatherError) w.push('Weather unavailable: ' + esc(S.weatherError));
    $('#warnings').innerHTML = w.map(x => `<div class="warn" role="status"><span aria-hidden="true">⚠</span><div>${x}</div></div>`).join('');
  }

  /* ---------- hero ---------- */
  function ring(v, scale) {
    const c = AQ.cat(v, scale);
    const max = scale === 'MY' ? 300 : 300;
    const frac = v == null ? 0 : Math.min(1, v / max);
    const R = 52, L = 2 * Math.PI * R * 0.75;
    return `<svg viewBox="0 0 128 128" class="ring" aria-hidden="true">
      <circle cx="64" cy="64" r="${R}" class="ring-track" stroke-dasharray="${L} 999" transform="rotate(135 64 64)"/>
      <circle cx="64" cy="64" r="${R}" stroke="${c.color}" class="ring-val" stroke-dasharray="${L * frac} 999" transform="rotate(135 64 64)"/>
    </svg>`;
  }
  function renderHero(S) {
    const H = S.head, tz = S.tz;
    const c = AQ.cat(H.aqi, H.aqiScale);
    const pc = AQ.cat(H.pm25Aqi, 'US');
    const who = H.pm25Conc != null ? H.pm25Conc / 15 : null;
    const doe = S.doe && S.doe.primary;
    $('#hero').innerHTML = `
      <div class="hero-main">
        <div class="ring-wrap">${ring(H.aqi, H.aqiScale)}
          <div class="ring-text"><div class="big">${fmt.n(H.aqi)}</div><div class="ring-lbl">Overall AQI</div></div>
        </div>
        <div class="hero-info">
          <div class="cat-pill" style="--b:${c.color};--bi:${c.ink}">${esc(c.label)}</div>
          <div class="scale">${esc(scaleName(H.aqiScale))} · ${esc(H.aqiSrc || '')}</div>
          <div class="obs">Reading for ${fmt.dayTime(H.time, tz)} <span class="muted">(${fmt.ago(H.time)})</span></div>
          ${doe ? `<div class="doe-line">DOE official: ${badge(doe.api, 'MY', 'sm')} <span>${esc(doe.name)} · ${fmt.n(doe.dist)} km</span></div>` : ''}
        </div>
      </div>
      <div class="hero-tiles">
        <div class="tile">
          <div class="t-lbl">PM2.5 AQI</div>
          <div class="t-val">${badge(H.pm25Aqi, 'US')}</div>
          <div class="t-sub">${esc(pc.label)} · US AQI</div>
          <div class="t-src">${esc(H.pm25Src || '')}</div>
        </div>
        <div class="tile">
          <div class="t-lbl">PM2.5 concentration</div>
          <div class="t-val"><span class="num">${fmt.n(H.pm25Conc, 1)}</span><span class="unit">µg/m³</span></div>
          <div class="t-sub">${who != null ? (who <= 1 ? 'Within' : fmt.n(who, 1) + '× ') + ' WHO 24‑h guideline (15)' : ''}</div>
          <div class="t-src">${esc(H.pm25ConcSrc || '')}${H.pm25ConcSrc && H.pm25ConcSrc.startsWith('derived') ? ' (±0.3)' : ''}</div>
        </div>
      </div>`;
  }

  /* ---------- running ---------- */
  function renderRun(S) {
    const R = S.run, el = $('#run');
    if (!R) { el.innerHTML = '<h2>Running outside</h2><p class="muted">No air-quality data yet.</p>'; return; }
    const wx = S.weather && S.weather.current;
    const heat = R.heat;
    const rows = R.rows.map(r => `
      <div class="int-row ${r.mins === 0 ? 'no' : r.mins === Infinity ? 'yes' : 'lim'}">
        <div class="int-name"><strong>${esc(r.label)}</strong><span>${esc(r.sub)}</span></div>
        <div class="int-dur"><strong>${AQ.fmtMins(r.mins)}</strong>${r.limiter ? `<span class="lim-tag">${r.limiter === 'heat' ? 'heat‑limited' : 'air‑limited'}</span>` : ''}</div>
      </div>`).join('');
    const best = (S.best || []).map(b => {
      const c = AQ.cat(b.aqi, 'US');
      return `<li><span class="bt-time">${fmt.dayTime(b.t, S.tz)}</span>
        <span class="bt-aqi" style="--b:${c.color};--bi:${c.ink}">AQI ${Math.round(b.aqi)}</span>
        <span class="bt-wx">${fmt.n(b.temp)}°C · heat idx ${fmt.n(b.hi)}°C${b.pop != null ? ' · rain ' + b.pop + '%' : ''}</span></li>`;
    }).join('');
    el.innerHTML = `
      <div class="sec-head"><h2>Running outside</h2>
        <label class="switch"><input type="checkbox" id="sens" ${R.sensitive ? 'checked' : ''}><span>Sensitive (asthma, heart/lung)</span></label></div>
      <div class="verdict tone-${R.tone}">
        <div class="v-icon" aria-hidden="true">${R.tone === 'good' || R.tone === 'ok' ? '✓' : R.tone === 'caution' ? '!' : '✕'}</div>
        <div><div class="v-title">${esc(R.verdict)}</div><div class="v-note">${esc(R.note)}</div>
        <div class="v-basis">Based on AQI ${Math.round(R.aqi)} (${esc(R.aqiSource)})${heat ? ` · heat index ${fmt.n(heat.hi)}°C (${esc(heat.label)})` : ''}</div></div>
      </div>
      <div class="int-list">${rows}</div>
      ${R.tips.length ? `<ul class="tips">${R.tips.map(t => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
      ${best ? `<div class="best"><h3>Best times in the next 24 h</h3><ul>${best}</ul>
        <p class="muted small">Ranked by forecast air quality (station‑adjusted), heat index and rain chance, 05:00–22:00.</p></div>` : ''}
      <details class="why"><summary>How these limits are worked out</summary>
        <p>Limits follow the US EPA activity guidance for each AQI level, made concrete as minutes. Harder running means faster, deeper breathing — at threshold pace you inhale roughly 3–5× more air per minute than at an easy jog, so the dose of PM2.5 rises quickly with intensity. "No limit" means air quality isn't the limiting factor. Heat and humidity (NOAA heat index) shorten the limits further, which matters in Malaysia's afternoons.</p>
        <p>This is general guidance for healthy adults, not medical advice. If you have asthma or a heart or lung condition, turn on Sensitive mode and follow your doctor's advice. Stop if you get chest tightness, wheezing or unusual breathlessness.</p>
      </details>`;
    $('#sens').addEventListener('change', e => { AQ.settings.setSensitive(e.target.checked); reload(false); });
  }

  /* ---------- other readings ---------- */
  function renderReadings(S) {
    const st = S.station && !S.station.demo ? S.station : null;
    const m = S.model && S.model.now;
    const wx = S.weather && S.weather.current;
    const nextH = S.weather ? S.weather.hourly.find(h => h.t >= Date.now()) : null;
    const tiles = [];
    const pol = (key, label, modelVal, unit) => {
      const a = st ? st.iaqi[key] : null;
      const mv = m && modelVal != null ? `${fmt.n(modelVal, unit === 'mg' ? 2 : 0)} ${unit === 'mg' ? 'mg/m³' : 'µg/m³'} (model)` : '';
      if (a == null && !mv) return;
      tiles.push(`<div class="rd"><div class="rd-lbl">${label}</div><div class="rd-val">${a != null ? badge(a, 'US', 'sm') + '<span class="rd-unit">AQI</span>' : '<span class="muted">—</span>'}</div><div class="rd-sub">${mv}</div></div>`);
    };
    if (st && st.iaqi.pm10 != null) {
      tiles.push(`<div class="rd"><div class="rd-lbl">PM10</div><div class="rd-val">${badge(st.iaqi.pm10, 'US', 'sm')}<span class="rd-unit">AQI</span></div><div class="rd-sub">≈${fmt.n(st.pm10Conc)} µg/m³ (station)</div></div>`);
    } else pol('pm10', 'PM10', m && m.pm10, 'ug');
    pol('o3', 'Ozone O₃', m && m.o3, 'ug');
    pol('no2', 'Nitrogen dioxide NO₂', m && m.no2, 'ug');
    pol('so2', 'Sulphur dioxide SO₂', m && m.so2, 'ug');
    pol('co', 'Carbon monoxide CO', m && m.co != null ? m.co / 1000 : null, 'mg');
    const w = (label, val, sub) => tiles.push(`<div class="rd"><div class="rd-lbl">${label}</div><div class="rd-val"><span class="num">${val}</span></div><div class="rd-sub">${sub || ''}</div></div>`);
    const temp = wx ? wx.temp : st && st.wx.t;
    if (temp != null) w('Temperature', fmt.n(temp, 1) + '°C', st && st.wx.t != null ? `station ${fmt.n(st.wx.t)}°C` : '');
    if (wx) {
      const hc = AQ.heatCat(wx.hi);
      w('Heat index', fmt.n(wx.hi, 1) + '°C', hc ? hc.label : '');
      w('Feels like', fmt.n(wx.feels, 1) + '°C', 'apparent temperature');
      w('Humidity', fmt.n(wx.rh) + '%', `dew point ${fmt.n(wx.dew, 1)}°C`);
      w('Wind', fmt.n(wx.wind) + ' km/h', '');
      w('UV index', fmt.n(wx.uv, 1), wx.uv >= 11 ? 'Extreme' : wx.uv >= 8 ? 'Very high' : wx.uv >= 6 ? 'High' : wx.uv >= 3 ? 'Moderate' : 'Low');
    }
    if (nextH && nextH.pop != null) w('Rain chance', nextH.pop + '%', 'next hour' + (nextH.code >= 95 ? ' · thunderstorm' : ''));
    if (st && st.wx.p != null) w('Pressure', fmt.n(st.wx.p) + ' hPa', 'station');
    if (m && m.dust != null) w('Dust', fmt.n(m.dust) + ' µg/m³', 'model');
    $('#readings').innerHTML = `<h2>Other readings</h2><div class="rd-grid">${tiles.join('')}</div>
      <p class="muted small">Pollutant badges are aqicn station sub‑indices (US AQI scale). Concentrations marked “model” are CAMS estimates for the area. Weather from Open‑Meteo.</p>`;
  }

  /* ---------- sources / comparison ---------- */
  function renderSources(S) {
    const st = S.station && !S.station.demo ? S.station : null;
    const m = S.model && S.model.now;
    const tz = S.tz;
    const parts = [];
    if (st) {
      parts.push(`<div class="src">
        <div class="src-h"><strong>aqicn.org station</strong><span class="muted">${esc(st.name)}${st.dist != null ? ' · ' + fmt.n(st.dist, 1) + ' km' : ''}</span></div>
        <div class="src-v">AQI ${badge(st.aqi, st.scale, 'sm')} <span class="muted">${esc(scaleName(st.scale))}</span></div>
        <div class="src-v">PM2.5 ${badge(st.iaqi.pm25, 'US', 'sm')} <span class="muted">US AQI ≈ ${fmt.n(st.pm25Conc, 1)} µg/m³</span></div>
        <div class="muted small">Reading ${fmt.dayTime(st.time, tz)} · data: ${esc((st.attributions[0] || {}).name || 'aqicn')}</div>
        ${st.url ? `<a href="${esc(ui.current.aqicnUrl || st.url)}" target="_blank" rel="noopener">Open on aqicn ↗</a>` : ''}
      </div>`);
    } else {
      parts.push(`<div class="src"><div class="src-h"><strong>aqicn.org station</strong></div><div class="muted small">${S.stationError && S.stationError.code === 'no-token' ? 'Needs your free token (Settings).' : 'Unavailable right now.'}</div></div>`);
    }
    if (S.doe) {
      const p = S.doe.primary;
      const others = S.doe.nearest.slice(1, 5).map(o => `<li>${esc(o.name)} · ${fmt.n(o.dist)} km ${badge(o.api, 'MY', 'sm')}</li>`).join('');
      parts.push(`<div class="src">
        <div class="src-h"><strong>Malaysia DOE (APIMS) — official</strong><span class="muted">${esc(p.name)} · ${fmt.n(p.dist, 1)} km</span></div>
        <div class="src-v">API ${badge(p.api, 'MY', 'sm')} <span class="muted">${esc(AQ.cat(p.api, 'MY').label)} · dominant ${esc(AQ.DOE_SYMBOLS[p.sym] || p.sym || '—')}</span></div>
        <div class="muted small">Reading ${fmt.dayTime(p.timeMs, tz)} · 24‑h running average of the dominant pollutant${S.doe.stale ? ' · <strong>cache is stale</strong>' : ''}</div>
        ${others ? `<ul class="others">${others}</ul>` : ''}
        <a href="https://eqms.doe.gov.my/APIMS/main" target="_blank" rel="noopener">Open APIMS ↗</a>
      </div>`);
    } else {
      parts.push(`<div class="src"><div class="src-h"><strong>Malaysia DOE (APIMS) — official</strong></div><div class="muted small">${S.doeError ? 'Not available yet — it appears once the hourly GitHub job has run (see README).' : 'No DOE station within 40 km.'}</div></div>`);
    }
    if (m) {
      const ratio = S.model.ratio;
      parts.push(`<div class="src">
        <div class="src-h"><strong>CAMS model (Copernicus via Open‑Meteo)</strong><span class="muted">area estimate</span></div>
        <div class="src-v">PM2.5 ${badge(m.aqiPm25, 'US', 'sm')} <span class="muted">${fmt.n(m.pm25, 1)} µg/m³ · overall ${Math.round(m.aqi)}</span></div>
        <div class="muted small">${ratio == null ? 'Used for trends and forecast; coarse (~40 km grid), so it can differ a lot from street‑level stations.'
          : S.model.ratioSrc === 'station' ? `Station PM2.5 is ${fmt.n(ratio, 2)}× the model right now, so forecasts are adjusted toward the station (adjustment fades over ~24 h).`
          : `No aqicn reading, so the model is calibrated to the DOE station: its 24‑h PM2.5 implied by API ${S.doe.primary.api} (≈${fmt.n(S.doe.primary.api * 0.35, 1)} µg/m³) is ${fmt.n(ratio, 2)}× the model. Treat calibrated values as estimates.`}</div>
      </div>`);
    }
    $('#sources').innerHTML = `<h2>Sources &amp; cross‑check</h2><div class="src-grid">${parts.join('')}</div>
      <p class="muted small">Scales: US AQI (aqicn sub‑indices, hourly) and Malaysia's API (DOE, 24‑h average) both run 0–500 but are not identical — DOE "Moderate" is 51–100, "Unhealthy" 101–200. aqicn's headline AQI for most Malaysian stations is the DOE API.</p>`;
  }

  /* ---------- charts ---------- */
  function seriesColors() {
    return { s1: cssVar('--series-1'), s2: cssVar('--series-2'), s3: cssVar('--series-3'), grid: cssVar('--grid'), text: cssVar('--text-2'), axis: cssVar('--text-3'), surface: cssVar('--surface') };
  }
  const bandsPlugin = {
    id: 'aqiBands',
    beforeDatasetsDraw(c, args, opt) {
      if (!opt || !opt.cuts) return;
      const { ctx, chartArea: a, scales: { y } } = c;
      let lo = y.min;
      ctx.save();
      for (const k of opt.cuts) {
        if (lo >= y.max) break;
        const hi = Math.min(k.max, y.max);
        const yTop = y.getPixelForValue(hi), yBot = y.getPixelForValue(lo);
        ctx.fillStyle = hexA(k.color, opt.alpha);
        ctx.fillRect(a.left, yTop, a.right - a.left, yBot - yTop);
        lo = hi;
      }
      ctx.restore();
    }
  };
  const linesPlugin = {
    id: 'aqiLines',
    afterDatasetsDraw(c, args, opt) {
      const { ctx, chartArea: a, scales: { x } } = c;
      ctx.save();
      if (opt && opt.now) {
        const px = x.getPixelForValue(Date.now());
        if (px >= a.left && px <= a.right) {
          ctx.strokeStyle = opt.color; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
          ctx.beginPath(); ctx.moveTo(px, a.top); ctx.lineTo(px, a.bottom); ctx.stroke();
          ctx.setLineDash([]); ctx.fillStyle = opt.color; ctx.font = '11px ' + cssVar('--font');
          ctx.fillText('now', px + 4, a.top + 11);
        }
      }
      const act = c.tooltip && c.tooltip.getActiveElements && c.tooltip.getActiveElements();
      if (act && act.length) {
        const px = act[0].element.x;
        ctx.strokeStyle = opt.color; ctx.lineWidth = 1; ctx.setLineDash([]);
        ctx.beginPath(); ctx.moveTo(px, a.top); ctx.lineTo(px, a.bottom); ctx.stroke();
      }
      ctx.restore();
    }
  };
  function tzOffsetMs(tz, t) {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      .formatToParts(t).reduce((o, x) => (o[x.type] = x.value, o), {});
    const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute);
    return asUTC - Math.floor(t / 60000) * 60000;
  }
  function localTicks(min, max, stepH, tz) {
    const off = tzOffsetMs(tz, min), out = [];
    for (let t = Math.ceil(min / HOUR) * HOUR; t <= max; t += HOUR) {
      if ((((t + off) / HOUR) % stepH + stepH) % stepH === 0) out.push({ value: t });
    }
    return out;
  }
  function hourGrid(from, to) { const out = []; for (let t = Math.ceil(from / HOUR) * HOUR; t <= to; t += HOUR) out.push(t); return out; }
  function onGrid(grid, points) {
    const m = new Map(points.filter(p => p.y != null && isFinite(p.y)).map(p => [Math.round(p.t / HOUR) * HOUR, p.y]));
    return grid.map(t => ({ x: t, y: m.has(t) ? m.get(t) : null }));
  }
  function drawChart(id, { grid, datasets, tz, yTitle, cuts, now, range }) {
    const C = seriesColors();
    if (ui.charts[id]) ui.charts[id].destroy();
    const canvas = document.getElementById(id);
    if (!canvas || !window.Chart) return;
    const spanH = (range[1] - range[0]) / HOUR;
    const step = spanH <= 6 ? 1 : spanH <= 12 ? 2 : spanH <= 24 ? 3 : spanH <= 48 ? 6 : 12;
    const ds = datasets.filter(d => d.data.some(p => p.y != null)).map(d => ({
      label: d.label, data: onGrid(grid, d.data), borderColor: C[d.color], backgroundColor: C[d.color],
      borderWidth: 2, borderDash: d.dashed ? [6, 4] : [], tension: 0.25, spanGaps: d.span || 3 * HOUR,
      pointRadius: ctx => (d.points ? 3 : 0), pointHoverRadius: 5, pointBorderColor: C.surface, pointBorderWidth: 1.5,
      parsing: false
    }));
    const maxY = Math.max(60, ...ds.flatMap(d => d.data.map(p => p.y || 0)));
    ui.charts[id] = new Chart(canvas, {
      type: 'line',
      data: { datasets: ds },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: { type: 'linear', min: range[0], max: range[1], grid: { color: C.grid, drawTicks: false }, border: { display: false },
            afterBuildTicks: axis => { axis.ticks = localTicks(range[0], range[1], step, tz); },
            ticks: { color: C.axis, autoSkip: true, maxRotation: 0, padding: 6, font: { size: 11 },
              callback: v => { const h = +fmt.hourLabel(v, tz); return spanH > 24 && h === 0 ? fmt.hourLabel(v, tz, true).replace(/\s?\d+$/, '') : fmt.hourLabel(v, tz) + ':00'; } } },
          y: { min: 0, suggestedMax: Math.ceil(maxY * 1.1 / 10) * 10, grid: { color: C.grid, drawTicks: false }, border: { display: false },
            title: { display: !!yTitle, text: yTitle, color: C.axis, font: { size: 11 } }, ticks: { color: C.axis, padding: 6, font: { size: 11 } } }
        },
        plugins: {
          legend: { display: ds.length > 1, position: 'bottom', labels: { color: C.text, boxWidth: 14, boxHeight: 2, usePointStyle: false, font: { size: 12 } } },
          tooltip: {
            filter: it => it.parsed.y != null, backgroundColor: cssVar('--tooltip-bg'), titleColor: cssVar('--text-1'), bodyColor: cssVar('--text-2'),
            borderColor: C.grid, borderWidth: 1, padding: 10, boxPadding: 4,
            callbacks: { title: it => (it.length ? fmt.dayTime(it[0].parsed.x, tz) : ''), label: it => ` ${it.dataset.label}: ${fmt.n(it.parsed.y, yTitle && yTitle.includes('µg') ? 1 : 0)}` }
          },
          aqiBands: { cuts, alpha: document.documentElement.dataset.mode === 'dark' ? 0.10 : 0.08 },
          aqiLines: { now, color: C.axis }
        }
      },
      plugins: [bandsPlugin, linesPlugin]
    });
  }
  const PM_CUTS = [12, 35.4, 55.4, 150.4, 250.4, Infinity].map((max, i) => ({ max, color: AQ.US_CATS[i].color }));
  const US_CUTS = AQ.US_CATS.map(c => ({ max: c.max, color: c.color }));

  function renderHistory(S) {
    const now = Date.now(), from = now - ui.histRange * HOUR;
    const grid = hourGrid(from - HOUR, now);
    const st = S.station && !S.station.demo ? S.station : null;
    const sh = S.stationHist.filter(r => r.t >= from - HOUR);
    const mRows = S.model ? S.model.rows.filter(r => r.t >= from - HOUR && r.t <= now) : [];
    const doeH = S.doe ? S.doe.primary.hist.filter(r => r.t >= from - HOUR) : [];
    const stScale = st ? scaleName(st.scale) : '';
    drawChart('chart-overall', {
      grid, tz: S.tz, range: [from, now], cuts: US_CUTS, yTitle: 'AQI',
      datasets: [
        { label: `Station (aqicn${stScale ? ', ' + stScale : ''})`, color: 's1', points: true, data: sh.map(r => ({ t: r.t, y: r.aqi })) },
        { label: `DOE official API${S.doe ? ' · ' + S.doe.primary.name : ''}`, color: 's2', data: doeH.map(r => ({ t: r.t, y: r.api })) },
        { label: 'Model (CAMS, US AQI)', color: 's3', dashed: true, data: mRows.map(r => ({ t: r.t, y: r.aqi })) }
      ]
    });
    const conc = ui.pmUnit === 'ug';
    drawChart('chart-pm25', {
      grid, tz: S.tz, range: [from, now], cuts: conc ? PM_CUTS : US_CUTS, yTitle: conc ? 'PM2.5 µg/m³' : 'PM2.5 AQI',
      datasets: [
        { label: 'Station (aqicn)', color: 's1', points: true, data: sh.map(r => ({ t: r.t, y: conc ? AQ.fromAqi('pm25', r.pm25) : r.pm25 })) },
        { label: 'Model (CAMS)', color: 's3', dashed: true, data: mRows.map(r => ({ t: r.t, y: conc ? r.pm25 : r.aqiPm25 })) }
      ]
    });
    const nSt = sh.length;
    $('#hist-note').innerHTML = `${st ? `Station points: ${nSt} in this range. aqicn's free API only gives the latest reading, so station history is built hourly by the GitHub job and whenever this app is open.` : 'Add your aqicn token to start recording station history.'}
      ${S.doe ? ' DOE line = official hourly API (49 h).' : ''} Model = CAMS hourly estimate for the area.`;
    // data table (accessibility / exact values)
    const rows = grid.slice().reverse().map(t => {
      const sr = sh.find(r => Math.round(r.t / HOUR) * HOUR === t);
      const dr = doeH.find(r => Math.round(r.t / HOUR) * HOUR === t);
      const mr = mRows.find(r => r.t === t);
      if (!sr && !dr && !mr) return '';
      return `<tr><td>${fmt.dayTime(t, S.tz)}</td><td>${sr ? fmt.n(sr.aqi) : '—'}</td><td>${sr ? fmt.n(sr.pm25) : '—'}</td><td>${sr ? fmt.n(AQ.fromAqi('pm25', sr.pm25), 1) : '—'}</td><td>${dr ? dr.api : '—'}</td><td>${mr ? mr.aqi : '—'}</td><td>${mr ? fmt.n(mr.pm25, 1) : '—'}</td></tr>`;
    }).join('');
    $('#hist-table').innerHTML = `<table><thead><tr><th>Hour</th><th>Station AQI</th><th>Station PM2.5 AQI</th><th>PM2.5 µg/m³</th><th>DOE API</th><th>Model AQI</th><th>Model PM2.5 µg/m³</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  function renderForecast(S) {
    const now = Date.now(), to = now + ui.fcRange * HOUR, from = now - 2 * HOUR;
    const grid = hourGrid(from, to);
    const fc = S.forecast.filter(r => r.t <= to);
    const adj = S.model && S.model.ratio != null;
    const how = S.model && S.model.ratioSrc === 'DOE' ? 'DOE‑calibrated' : 'station‑adjusted';
    drawChart('chart-fc', {
      grid, tz: S.tz, range: [from, to], cuts: US_CUTS, yTitle: 'AQI (US)', now: true,
      datasets: adj ? [
        { label: `PM2.5 AQI (${how})`, color: 's1', data: fc.map(r => ({ t: r.t, y: r.aqiPm25Adj })) },
        { label: `Overall AQI (${how})`, color: 's2', data: fc.map(r => ({ t: r.t, y: r.aqiAdj })) },
        { label: 'PM2.5 AQI (raw model)', color: 's3', dashed: true, data: fc.map(r => ({ t: r.t, y: r.aqiPm25 })) }
      ] : [
        { label: 'PM2.5 AQI (model)', color: 's1', data: fc.map(r => ({ t: r.t, y: r.aqiPm25 })) },
        { label: 'Overall AQI (model)', color: 's2', data: fc.map(r => ({ t: r.t, y: r.aqi })) }
      ]
    });
    const st = S.station && !S.station.demo ? S.station : null;
    const days = st && st.forecast.pm25 ? st.forecast.pm25 : [];
    const todayKey = new Intl.DateTimeFormat('en-CA', { timeZone: S.tz }).format(now);
    const cards = days.filter(d => d.day >= todayKey).slice(0, 6).map(d => {
      const c = AQ.cat(d.avg, 'US');
      const lbl = d.day === todayKey ? 'Today' : new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', timeZone: 'UTC' }).format(Date.parse(d.day));
      return `<div class="day"><div class="d-name">${lbl}</div>${badge(d.avg, 'US')}<div class="d-rng">${d.min}–${d.max}</div><div class="d-cat">${esc(c.short || c.label)}</div></div>`;
    }).join('');
    $('#fc-days').innerHTML = cards ? `<h3>aqicn daily PM2.5 forecast <span class="muted small">(US AQI · avg, min–max)</span></h3><div class="days">${cards}</div>` : '';
    $('#fc-note').textContent = adj
      ? `Hourly forecast from the CAMS model, scaled to match the ${S.model.ratioSrc === 'DOE' ? 'official DOE station reading' : 'current station reading'} (the correction fades over ~24 h). Forecasts become less certain beyond 48 h.`
      : 'Hourly forecast from the CAMS model (no station available to calibrate against). Forecasts become less certain beyond 48 h.';
  }

  /* ---------- main load ---------- */
  function setLoading(on) {
    ui.loading = on;
    document.body.classList.toggle('is-loading', on);
    const b = $('#btn-refresh'); if (b) { b.disabled = on; b.setAttribute('aria-busy', on); }
  }
  async function reload(force) {
    if (!ui.current) return;
    setLoading(true);
    renderHeader(null);
    try {
      const S = await AQ.load(ui.current, { force });
      if (S.loc !== ui.current) return; // user switched meanwhile
      ui.state = S;
      renderAll();
    } catch (e) {
      $('#warnings').innerHTML = `<div class="warn">Could not load data: ${esc(e.message)}</div>`;
      console.error(e);
    } finally { setLoading(false); }
    refreshQuick();
  }
  function renderAll() {
    const S = ui.state; if (!S) return;
    renderHeader(S); renderWarnings(S); renderHero(S); renderRun(S); renderReadings(S); renderSources(S);
    renderHistory(S); renderForecast(S); renderFavs();
    document.querySelectorAll('[data-skel]').forEach(n => n.removeAttribute('data-skel'));
  }
  function select(loc) {
    ui.current = loc; ui.pendingReplace = false;
    if (loc.id !== 'custom') AQ.favourites.setLastId(loc.id);
    renderFavs();
    reload(false);
    if (LAYOUT === 'mobile') window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ---------- search dialog ---------- */
  let searchTimer = null;
  function openSearch(tab = 'search') {
    const d = $('#dlg-search'); if (!d.open) d.showModal();
    $('#q').value = ''; $('#results').innerHTML = searchHint();
    switchTab(tab);
  }
  function switchTab(tab) {
    document.querySelectorAll('#dlg-search [data-tab]').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === tab));
    document.querySelectorAll('#dlg-search [data-panel]').forEach(p => { p.hidden = p.dataset.panel !== tab; });
    if (tab === 'search') setTimeout(() => $('#q').focus(), 50);
    else { $('#st-filter').value = ui.stFilter || ''; renderStations(); }
  }

  /* ---------- all stations in Malaysia ---------- */
  ui.stSrc = AQ.store.get('stSrc', 'doe'); ui.stFilter = ''; ui.stExpand = false;
  async function renderStations(force) {
    const box = $('#st-list'), note = $('#st-note');
    document.querySelectorAll('#st-src [data-src]').forEach(b => b.setAttribute('aria-pressed', b.dataset.src === ui.stSrc));
    if (!ui.dir || force) { box.innerHTML = '<p class="muted small">Loading stations…</p>'; ui.dir = await AQ.stationDirectory(force); }
    const D = ui.dir;
    const wq = $('#st-src [data-src="waqi"]'), dq = $('#st-src [data-src="doe"]');
    dq.textContent = `Official DOE (${D.doe.length})`;
    wq.textContent = D.waqi ? `aqicn (${D.waqi.length})` : 'aqicn';
    let src = ui.stSrc;
    const notes = [];
    if (src === 'waqi' && !D.waqi) {
      box.innerHTML = D.waqiError === 'no-token'
        ? '<p class="small">The aqicn list (DOE mirrors plus extra sensors) needs your free aqicn token. <button class="link" data-act="settings">Open Settings</button></p>'
        : `<p class="small">Couldn't load the aqicn station list: ${esc(D.waqiError)}</p>`;
      note.textContent = ''; return;
    }
    if (src === 'doe') {
      notes.push('Badges show the official Malaysian API (24‑h running average)' + (D.doeLive ? ` · updated ${fmt.time(Date.parse(D.doeUpdated), 'Asia/Kuala_Lumpur')}` : ''));
      if (!D.doeLive) notes.push('Live API values appear once the hourly GitHub job has run — you can still pick any station.');
    } else notes.push('Badges show the AQI as listed on aqicn.org (for DOE‑fed stations this is the Malaysian API).');
    note.textContent = notes.join(' ');
    const q = (ui.stFilter || '').trim().toLowerCase();
    const items = (src === 'doe' ? D.doe : D.waqi).filter(s => !q || (s.name + ' ' + s.state + ' ' + (s.id || '')).toLowerCase().includes(q));
    const cur = ui.current;
    const withDist = items.map(s => Object.assign({}, s, { km: cur ? AQ.distKm(cur.lat, cur.lon, s.lat, s.lon) : null }));
    const curState = cur ? (D.doe.slice().sort((a, b) => AQ.distKm(cur.lat, cur.lon, a.lat, a.lon) - AQ.distKm(cur.lat, cur.lon, b.lat, b.lon))[0] || {}).state : null;
    const row = s => {
      const loc = src === 'doe'
        ? { name: s.name, region: `${s.state} · DOE station ${s.id}`, lat: s.lat, lon: s.lon, waqi: s.waqi || null }
        : { name: s.name, region: `${s.state} · aqicn station`, lat: s.lat, lon: s.lon, waqi: '@' + s.uid };
      const b = src === 'doe' ? (s.api != null ? badge(s.api, 'MY', 'sm') : '<span class="badge sm ghost">—</span>')
        : badge(s.aqi, s.doeMatch ? 'MY' : 'US', 'sm');
      const sub = src === 'doe'
        ? `${s.id}${s.api != null ? ' · ' + esc(AQ.cat(s.api, 'MY').label) + (AQ.DOE_SYMBOLS[s.sym] ? ' · ' + AQ.DOE_SYMBOLS[s.sym] : '') : ''}`
        : (s.doeMatch ? `DOE station ${s.doeMatch}` : 'other sensor');
      return `<li><button class="res" data-loc='${esc(JSON.stringify(loc))}'>
        <span><strong>${esc(s.name)}</strong><span class="muted small">${sub}${s.km != null ? ' · ' + (s.km < 10 ? s.km.toFixed(1) : Math.round(s.km)) + ' km away' : ''}</span></span>${b}</button></li>`;
    };
    let html = '';
    if (!q && cur) {
      const near = withDist.filter(s => s.km <= 50).sort((a, b) => a.km - b.km).slice(0, 3);
      if (near.length) html += `<div class="st-near"><h4>Nearest to ${esc(cur.name)}</h4><ul class="res-list">${near.map(row).join('')}</ul></div>`;
    }
    const states = D.states.slice();
    withDist.forEach(s => { if (!states.includes(s.state)) states.push(s.state); });
    html += states.map(st => {
      const list = withDist.filter(s => s.state === st).sort((a, b) => a.name.localeCompare(b.name));
      if (!list.length) return '';
      const open = !!q || ui.stExpand || st === curState;
      return `<details class="st-grp" ${open ? 'open' : ''}><summary><span>${esc(st)}</span><span class="muted small">${list.length} station${list.length > 1 ? 's' : ''}</span></summary><ul class="res-list">${list.map(row).join('')}</ul></details>`;
    }).join('');
    box.innerHTML = html || '<p class="muted small">No stations match that filter.</p>';
  }
  const searchHint = () => `<p class="muted small">Type a town, city or station name — e.g. “Ipoh”, “Seremban”, “Kuching”, “Singapore”.${AQ.settings.token() ? '' : ' Add your aqicn token in Settings to also search monitoring stations.'}</p>`;
  async function doSearch(q) {
    const box = $('#results');
    if (q.trim().length < 2) { box.innerHTML = searchHint(); return; }
    box.innerHTML = '<p class="muted small">Searching…</p>';
    const r = await AQ.search(q);
    if ($('#q').value !== q) return;
    const item = (x, kind) => `<li><button class="res" data-kind="${kind}" data-loc='${esc(JSON.stringify(x))}'>
        <span><strong>${esc(x.name)}</strong><span class="muted small">${esc(x.region)}</span></span>
        ${x.aqi != null ? badge(x.aqi, 'US', 'sm') : ''}</button></li>`;
    box.innerHTML =
      (r.places.length ? `<h4>Places</h4><ul class="res-list">${r.places.map(p => item(p, 'place')).join('')}</ul>` : '') +
      (r.stations.length ? `<h4>aqicn monitoring stations</h4><ul class="res-list">${r.stations.map(p => item(p, 'station')).join('')}</ul>` : '') +
      (!r.places.length && !r.stations.length ? '<p class="muted small">No matches. Try a different spelling or a nearby larger town.</p>' : '') +
      (r.errors.length ? `<p class="muted small">Some sources failed: ${esc(r.errors.join('; '))}</p>` : '');
  }
  function pickResult(x) {
    $('#dlg-search').close();
    const fav = AQ.favourites.list().find(f => f.waqi && x.waqi && f.waqi === x.waqi);
    if (fav) return select(fav);
    select(Object.assign({}, x, { id: 'custom' }));
  }
  function useMyLocation() {
    if (!navigator.geolocation) { $('#results').innerHTML = '<p class="muted small">Location is not available in this browser.</p>'; return; }
    $('#results').innerHTML = '<p class="muted small">Getting your location…</p>';
    navigator.geolocation.getCurrentPosition(p => {
      pickResult({ name: 'My location', region: `${p.coords.latitude.toFixed(3)}, ${p.coords.longitude.toFixed(3)}`, lat: +p.coords.latitude.toFixed(4), lon: +p.coords.longitude.toFixed(4), waqi: null });
    }, e => { $('#results').innerHTML = `<p class="muted small">Couldn't get location: ${esc(e.message)}</p>`; }, { timeout: 10000, maximumAge: 600000 });
  }

  /* ---------- settings dialog ---------- */
  function openSettings() {
    const d = $('#dlg-settings');
    $('#tok').value = AQ.store.get('token', '') || '';
    $('#tok-cfg').hidden = !AQ.CFG.WAQI_TOKEN;
    $('#tok-status').textContent = '';
    $('#set-sens').checked = AQ.settings.sensitive();
    const f4 = AQ.favourites.fav4();
    $('#set-fav4').innerHTML = f4 ? `4th favourite: <strong>${esc(f4.name)}</strong> <button class="btn ghost small" data-act="remove-fav">Remove</button>` : 'No 4th favourite saved yet — search a place and tap “Save as 4th favourite”.';
    d.showModal();
  }
  async function testToken() {
    const t = $('#tok').value.trim(); const s = $('#tok-status');
    if (!t) { s.textContent = 'Enter a token first.'; return; }
    s.textContent = 'Testing…';
    try {
      const r = await fetch(`https://api.waqi.info/feed/@2600/?token=${encodeURIComponent(t)}`).then(r => r.json());
      if (r.status === 'ok' && r.data.idx === 2600) s.textContent = `✓ Works — Perai AQI ${r.data.aqi}.`;
      else if (r.status === 'ok') s.textContent = '⚠ This looks like the demo token (returns Shanghai). Use your own token.';
      else s.textContent = '✕ ' + (r.data || 'Token rejected');
    } catch (e) { s.textContent = '✕ Could not reach aqicn: ' + e.message; }
  }

  /* ---------- events ---------- */
  document.addEventListener('click', e => {
    const fav = e.target.closest('.fav[data-id]');
    if (fav) { const f = AQ.favourites.list().find(x => x.id === fav.dataset.id); if (f) select(f); return; }
    const res = e.target.closest('.res'); if (res) { pickResult(JSON.parse(res.dataset.loc)); return; }
    const seg = e.target.closest('[data-range]');
    if (seg) {
      const grp = seg.parentElement; grp.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b === seg));
      if (grp.id === 'hist-range') { ui.histRange = +seg.dataset.range; AQ.store.set('histRange', ui.histRange); ui.state && renderHistory(ui.state); }
      if (grp.id === 'fc-range') { ui.fcRange = +seg.dataset.range; AQ.store.set('fcRange', ui.fcRange); ui.state && renderForecast(ui.state); }
      if (grp.id === 'pm25-unit') { ui.pmUnit = seg.dataset.range; AQ.store.set('pmUnit', ui.pmUnit); ui.state && renderHistory(ui.state); }
      return;
    }
    const tabBtn = e.target.closest('#dlg-search [data-tab]'); if (tabBtn) { switchTab(tabBtn.dataset.tab); return; }
    const srcBtn = e.target.closest('#st-src [data-src]');
    if (srcBtn) { ui.stSrc = srcBtn.dataset.src; AQ.store.set('stSrc', ui.stSrc); renderStations(); return; }
    const act = e.target.closest('[data-act]'); if (!act) return;
    switch (act.dataset.act) {
      case 'refresh': ui.dir = null; reload(true); break;
      case 'search': case 'add-fav': openSearch(); break;
      case 'stations': openSearch('stations'); break;
      case 'st-expand': ui.stExpand = !ui.stExpand; act.textContent = ui.stExpand ? 'Collapse all' : 'Expand all'; renderStations(); break;
      case 'settings': openSettings(); break;
      case 'close': act.closest('dialog').close(); break;
      case 'locate': useMyLocation(); break;
      case 'test-token': testToken(); break;
      case 'save-token': {
        AQ.settings.setToken($('#tok').value); $('#tok-status').textContent = 'Saved.';
        ui.quickCache = {}; ui.dir = null; $('#dlg-settings').close(); reload(true); break;
      }
      case 'save-fav': {
        if (AQ.favourites.fav4() && !ui.pendingReplace) { ui.pendingReplace = true; renderHeader(ui.state); break; }
        const saved = AQ.favourites.setFav4(Object.assign({}, ui.current, { waqi: ui.current.waqi || null }));
        ui.current = Object.assign({}, saved, { fav4: true }); ui.pendingReplace = false;
        AQ.favourites.setLastId('fav4');
        if (ui.state) ui.state.loc = ui.current;
        delete ui.quickCache.fav4; renderHeader(ui.state); renderFavs(); refreshQuick(); break;
      }
      case 'cancel-save': ui.pendingReplace = false; renderHeader(ui.state); break;
      case 'remove-fav': {
        AQ.favourites.clearFav4(); delete ui.quickCache.fav4;
        if ($('#dlg-settings').open) $('#dlg-settings').close();
        if (ui.current && ui.current.fav4) select(AQ.DEFAULTS[0]); else { renderHeader(ui.state); renderFavs(); }
        break;
      }
    }
  });
  document.addEventListener('input', e => {
    if (e.target.id === 'q') { clearTimeout(searchTimer); const q = e.target.value; searchTimer = setTimeout(() => doSearch(q), 350); }
    if (e.target.id === 'st-filter') { ui.stFilter = e.target.value; renderStations(); }
  });
  document.addEventListener('change', e => { if (e.target.id === 'set-sens') { AQ.settings.setSensitive(e.target.checked); reload(false); } });
  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.id === 'q') { clearTimeout(searchTimer); doSearch(e.target.value); }
    if (e.key === '/' && document.activeElement === document.body && LAYOUT === 'desktop') { e.preventDefault(); openSearch(); }
    if ((e.key === 'r' || e.key === 'R') && document.activeElement === document.body && !e.ctrlKey && !e.metaKey) reload(true);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && ui.state && Date.now() - ui.state.fetchedAt > 10 * 60e3) reload(false);
  });
  // theme follows OS; charts re-read colours on change
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const setMode = () => { document.documentElement.dataset.mode = mq.matches ? 'dark' : 'light'; if (ui.state) { renderHistory(ui.state); renderForecast(ui.state); } };
  mq.addEventListener ? mq.addEventListener('change', setMode) : mq.addListener(setMode);
  let rsz; window.addEventListener('resize', () => { clearTimeout(rsz); rsz = setTimeout(() => Object.values(ui.charts).forEach(c => c.resize()), 150); });

  /* ---------- boot ---------- */
  setMode();
  document.querySelectorAll('#hist-range [data-range]').forEach(b => b.setAttribute('aria-pressed', +b.dataset.range === ui.histRange));
  document.querySelectorAll('#fc-range [data-range]').forEach(b => b.setAttribute('aria-pressed', +b.dataset.range === ui.fcRange));
  document.querySelectorAll('#pm25-unit [data-range]').forEach(b => b.setAttribute('aria-pressed', b.dataset.range === ui.pmUnit));
  if (window.Chart) { Chart.defaults.font.family = cssVar('--font') || 'system-ui'; }
  const params = new URLSearchParams(location.search);
  const want = params.get('loc') || AQ.favourites.lastId();
  ui.current = AQ.favourites.list().find(f => f.id === want) || AQ.DEFAULTS[0];
  renderFavs();
  reload(false);
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  window.AirCheckUI = ui;
})();
