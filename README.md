# AirCheck — air quality for runners

Live AQI, PM2.5 AQI and PM2.5 concentration for **Perai (Penang)**, **Kuala Lumpur** and **Alor Setar (Kedah)**, plus any place you search (save one as a 4th favourite). It has past-hours trend charts (6/12/24/48 h), a forecast chart, other pollutants and weather, and a **"Running outside"** section with safe durations for low, moderate and high intensity.

- `index.html` — mobile version (installable as an app on your phone)
- `desktop.html` — desktop dashboard (installable from Chrome/Edge as a desktop app)

## Data sources

| Source | What it gives | Notes |
|---|---|---|
| **aqicn.org / WAQI** (stations @2600 Perai, @5780 KL, @2581 Alor Setar, plus all Malaysian stations in the station list) | Headline AQI, PM2.5/PM10/O₃/NO₂/SO₂/CO sub-indices, station weather, daily PM2.5 forecast | The same numbers as the aqicn pages. Needs a **free token**. |
| **Malaysia DOE — APIMS** (eqms.doe.gov.my) | Official Air Pollutant Index (API) per station, 49 h hourly history | DOE blocks other websites from reading it directly, so a GitHub Action fetches it hourly into `data/doe.json`. |
| **Copernicus CAMS model** via Open-Meteo | Hourly PM2.5, PM10, O₃, NO₂, SO₂, CO, dust, UV: 3 days back, ~4.5 days ahead | Coarse model. The app scales it to the live station reading (or the DOE reading if there's no token) before using it for forecasts. |
| **Open-Meteo weather** | Temperature, humidity, heat index, wind, UV, rain chance | Used for heat-adjusted running limits and "best time to run". |

**About the scales:** aqicn's pollutant values use the US EPA AQI (with the same breakpoints as aqicn.org, so PM2.5 AQI 67 ≈ 19.7 µg/m³). For Perai and Alor Setar, aqicn's *headline* AQI is the DOE's official **Malaysian API**, a 24-hour running average. The app labels which scale each number uses.

---

## Put it on GitHub Pages (about 10 minutes, all in the browser)

1. **Create a repository.** On github.com click **New repository**, name it e.g. `aircheck`, choose **Public** (needed for free GitHub Pages), then click **Create**.
2. **Upload the files.** On the new repo page click **uploading an existing file**. Drag in *everything inside* this `AirCheck` folder, including the `.github` folder. (If your file browser hides it, use the zip: unzip it and drag in its contents.) Then click **Commit changes**.
   - Check that `.github/workflows/update-data.yml` appears in the repo. If the `.github` folder didn't upload, click **Add file → Create new file**, type `.github/workflows/update-data.yml` as the name, and paste in the file's contents.
3. **Turn on Pages.** Go to **Settings → Pages**. Under *Build and deployment* choose **Deploy from a branch**, branch **main**, folder **/ (root)**, then **Save**. After 1–2 minutes your app is at
   `https://<your-username>.github.io/aircheck/` (mobile) and `…/aircheck/desktop.html` (desktop).
4. **Let the hourly job write data.** Go to **Settings → Actions → General → Workflow permissions**, select **Read and write permissions**, then **Save**.
5. **Add your aqicn token as a secret** (this records station history for the charts): **Settings → Secrets and variables → Actions → New repository secret**. Name it `WAQI_TOKEN` and paste your token as the value.
6. **Run the job once now.** Open the **Actions** tab, enable workflows if asked, pick **Update air-quality data**, then **Run workflow**. After that it runs on its own every hour.

### Your aqicn token
Get one free at <https://aqicn.org/data-platform/token/>. Then either:
- open the app → ⚙ **Settings** → paste → **Test** → **Save** (stored on that device only), or
- put it in `config.js` (`WAQI_TOKEN: "..."`) so every device works straight away. aqicn tokens are designed for use in web pages, but they will be visible in your public repo.

### Install as an app
- **Phone:** open the GitHub Pages link. On Android/Chrome use ⋮ → **Add to Home screen**; on iPhone/Safari use Share → **Add to Home Screen**.
- **Desktop:** open `…/desktop.html` in Chrome or Edge and click the **Install** icon in the address bar.

## Using it
- Tap a favourite chip (mobile) or a sidebar entry (desktop). The ↻ button refreshes all readings, and the app also refreshes itself if it has been in the background for more than 10 minutes.
- 🔍 Search by town, city or aqicn station name, or use **Use my location**. Then tap **☆ Save as 4th favourite**. Saving again replaces the old 4th favourite, after a confirmation.
- 📍 **All stations in Malaysia** (the pin button on mobile, or the sidebar on desktop) lists every monitoring station grouped by state, with the 3 nearest at the top and a filter box.
  - **Official DOE** shows all 68 Department of Environment stations with their current API. The list is built into the app, and live values come from the hourly job.
  - **aqicn** shows every aqicn station in Malaysia, including extra sensors. It needs your token.
  - Picking a DOE station automatically uses its matching aqicn feed. Any station can be saved as the 4th favourite.
- **Sensitive mode** (asthma, heart or lung condition) makes the running limits two levels stricter.
- Under each history chart there's an **Hourly data table** with the exact numbers.

## How the running limits work
Limits follow the US EPA's activity guidance for each AQI level, turned into minutes for easy, moderate and hard running. Harder running means more air (and PM2.5) inhaled per minute, so harder efforts get shorter limits. Heat and humidity (the NOAA heat index) then shorten the limits further. The app also picks the best times to run in the next 24 hours using the forecast. This is general guidance, not medical advice.

## Good to know
- **Station history** builds up over time: the hourly job logs the three default stations (needs the `WAQI_TOKEN` secret), and the app logs whatever you view. The official DOE line (49 h) and the model line show up immediately.
- GitHub pauses scheduled jobs in repos with no activity for 60 days. If the DOE line goes stale, open **Actions** and re-enable or run the workflow.
- GitHub may delay hourly jobs by 5–30 minutes when it's busy.
- If DOE ever blocks GitHub's servers, the app keeps working with aqicn and model data, and the "Sources" panel will say DOE isn't available.
