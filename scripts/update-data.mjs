// Runs in GitHub Actions (Node 20). Writes data/doe.json and data/history.json.
import fs from 'node:fs/promises';

const DOE = 'https://eqms.doe.gov.my/api3/publicportalapims';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (AirCheck hourly cache; +https://github.com)',
  'Accept': 'application/json, text/plain, */*',
  'Referer': 'https://eqms.doe.gov.my/APIMS/main',
  'Origin': 'https://eqms.doe.gov.my'
};
// aqicn stations recorded for history (Perai, Kuala Lumpur, Alor Setar). Add more uids if you like.
const WAQI_STATIONS = [2600, 5780, 2581];
const KEEP_HOURS = 72;

async function getJSON(url, headers = {}, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 20000);
      const r = await fetch(url, { headers, signal: ctl.signal }); clearTimeout(t);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) {
      if (i >= tries) throw new Error(`${url}: ${e.message}`);
      await new Promise(r => setTimeout(r, 2000 * i));
    }
  }
}
const toEpoch = s => Math.round(Date.parse(s + '+08:00') / 1000);   // DOE times are Malaysia time
const fmtMY = ms => new Date(ms + 8 * 3600e3).toISOString().slice(0, 13) + ':00:00';
const titleCase = s => s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase()).replace(/\bW\.p\./, 'W.P.');

async function updateDoe() {
  const map = await getJSON(`${DOE}/mapcaqm?_ts=${Date.now()}`, HEADERS);
  const rows = map.data || [];
  if (!rows.length) throw new Error('DOE map returned no stations');
  const latest = rows.map(r => Date.parse(r.RECORD_DT + '+08:00')).filter(Number.isFinite).sort().pop();
  const stations = new Map();
  for (const r of rows) {
    const [place, state] = r.STATION_LOCATION.split(',').map(s => s.trim());
    stations.set(r.STATION_ID, {
      id: r.STATION_ID, name: place, state: r.STATE_NAME || titleCase(state || ''), stateId: r.STATE_ID,
      lat: +r.LATITUDE, lon: +r.LONGITUDE, api: r.API, sym: r.PARAM_SYMBOL, cls: r.CLASS,
      time: r.RECORD_DT + '+08:00', hist: new Map()
    });
  }
  const stateIds = [...new Set(rows.map(r => r.STATE_ID))];
  // 49 hours of hourly API values per station (two 24‑h windows per state)
  for (const sid of stateIds) {
    for (const back of [0, 24]) {
      const dt = fmtMY(latest - back * 3600e3);
      try {
        const j = await getJSON(`${DOE}/apitablehourly?stateid=${sid}&datetime=${dt}&`, HEADERS);
        for (const h of j.api_table_hourly || []) {
          const s = stations.get(h.STATION_ID);
          if (s && h.API != null && h.API >= 0) s.hist.set(toEpoch(h.DATETIME), [toEpoch(h.DATETIME), h.API, h.PARAM_SYMBOL]);
        }
      } catch (e) { console.warn('state', sid, back, e.message); }
    }
  }
  const out = {
    updated: new Date().toISOString(),
    source: 'Department of Environment Malaysia — APIMS (eqms.doe.gov.my). Air Pollutant Index, 24-h running average.',
    stations: [...stations.values()].map(s => ({ ...s, hist: [...s.hist.values()].sort((a, b) => a[0] - b[0]) }))
  };
  await fs.writeFile('data/doe.json', JSON.stringify(out));
  console.log(`DOE: ${out.stations.length} stations, latest ${fmtMY(latest)}`);
}

async function updateHistory() {
  const token = process.env.WAQI_TOKEN;
  if (!token) { console.log('WAQI_TOKEN secret not set — skipping station history.'); return; }
  let hist = { stations: {} };
  try { hist = JSON.parse(await fs.readFile('data/history.json', 'utf8')); } catch { /* first run */ }
  const cutoff = Date.now() / 1000 - KEEP_HOURS * 3600;
  for (const uid of WAQI_STATIONS) {
    try {
      const j = await getJSON(`https://api.waqi.info/feed/@${uid}/?token=${encodeURIComponent(token)}`);
      if (j.status !== 'ok') throw new Error(String(j.data));
      const d = j.data, iv = k => (d.iaqi && d.iaqi[k] ? d.iaqi[k].v : null);
      const t = Math.round(Date.parse(d.time.iso) / 1000);
      const arr = (hist.stations[uid] || []).filter(r => r[0] >= cutoff && r[0] !== t);
      arr.push([t, Number.isFinite(+d.aqi) ? +d.aqi : null, iv('pm25'), iv('pm10')]);
      hist.stations[uid] = arr.sort((a, b) => a[0] - b[0]);
    } catch (e) { console.warn('waqi', uid, e.message); }
  }
  hist.updated = new Date().toISOString();
  hist.format = '[epochSeconds, aqi, pm25 sub-index (US AQI), pm10 sub-index]';
  await fs.writeFile('data/history.json', JSON.stringify(hist));
  console.log('History updated for', Object.keys(hist.stations).join(', '));
}

await fs.mkdir('data', { recursive: true });
let failed = 0;
try { await updateDoe(); } catch (e) { failed++; console.error('DOE update failed:', e.message); }
try { await updateHistory(); } catch (e) { failed++; console.error('History update failed:', e.message); }
if (failed === 2) process.exit(1);
