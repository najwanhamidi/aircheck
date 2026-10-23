// AirCheck configuration.
// Optional: paste your free aqicn / WAQI token here so every device that opens
// the site gets live station data without entering it in Settings.
// Get a token at https://aqicn.org/data-platform/token/
// (A token typed into the app's Settings screen overrides this value.)
window.AQ_CONFIG = {
  WAQI_TOKEN: "",

  // Files written every hour by the GitHub Action (.github/workflows/update-data.yml).
  DOE_CACHE_URL: "data/doe.json",
  HISTORY_URL: "data/history.json"
};
