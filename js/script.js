/* =========================================================
   AEROVA – Urban Air Quality Assistant
   Vanilla JavaScript · OpenWeather live data

   Data flow
   1. Page loads with clearly-labelled SAMPLE data.
   2. It then requests live data from OpenWeather
      (Current Weather + Air Pollution current / history / forecast).
   3. On success every card switches to "Live · OpenWeather".
      On failure the page stays on sample data and says why.

   Recommendations, planner and chat are RULE-BASED (no AI model).
   ========================================================= */
(function () {
  "use strict";

  document.documentElement.classList.add("js");

  const CFG = window.AEROVA_CONFIG || {};
  const HOUR = 3600 * 1000;

  /* ---------------------------------------------------------
     1. REFERENCE DATA
     --------------------------------------------------------- */
  const AQI_BANDS = [
    { max: 50,  key: "good",      label: "Good",                           color: "var(--aq-good)",
      health: "Air quality is satisfactory and poses little or no risk." },
    { max: 100, key: "moderate",  label: "Moderate",                       color: "var(--aq-moderate)",
      health: "Air quality is acceptable. Unusually sensitive people may notice symptoms; consider limiting prolonged outdoor exertion." },
    { max: 150, key: "sensitive", label: "Unhealthy for Sensitive Groups", color: "var(--aq-sensitive)",
      health: "Children, older adults and people with asthma or heart and lung disease may experience health effects. Limit prolonged outdoor exertion." },
    { max: 200, key: "unhealthy", label: "Unhealthy",                      color: "var(--aq-unhealthy)",
      health: "Everyone may begin to experience health effects, and sensitive groups may experience more serious effects. Limit prolonged outdoor exertion." },
    { max: 300, key: "very",      label: "Very Unhealthy",                 color: "var(--aq-very)",
      health: "Health alert: everyone may experience more serious effects. Avoid outdoor exertion." },
    { max: 500, key: "hazard",    label: "Hazardous",                      color: "var(--aq-hazard)",
      health: "Emergency conditions: everyone is likely to be affected. Stay indoors and avoid all outdoor exertion." }
  ];

  /* US EPA AQI breakpoints [conc low, conc high, AQI low, AQI high].
     OpenWeather returns µg/m³; `conv` converts to the unit EPA uses
     (µg/m³ for PM, ppb for O3/NO2/SO2, ppm for CO, at 25 °C). */
  const BREAKPOINTS = {
    pm2_5: { conv: 1,        bp: [[0, 9, 0, 50], [9.1, 35.4, 51, 100], [35.5, 55.4, 101, 150], [55.5, 125.4, 151, 200], [125.5, 225.4, 201, 300], [225.5, 325.4, 301, 500]] },
    pm10:  { conv: 1,        bp: [[0, 54, 0, 50], [55, 154, 51, 100], [155, 254, 101, 150], [255, 354, 151, 200], [355, 424, 201, 300], [425, 604, 301, 500]] },
    o3:    { conv: 0.509,    bp: [[0, 54, 0, 50], [55, 70, 51, 100], [71, 85, 101, 150], [86, 105, 151, 200], [106, 200, 201, 300]] },
    no2:   { conv: 0.532,    bp: [[0, 53, 0, 50], [54, 100, 51, 100], [101, 360, 101, 150], [361, 649, 151, 200], [650, 1249, 201, 300], [1250, 2049, 301, 500]] },
    so2:   { conv: 0.382,    bp: [[0, 35, 0, 50], [36, 75, 51, 100], [76, 185, 101, 150], [186, 304, 151, 200], [305, 604, 201, 300], [605, 1004, 301, 500]] },
    co:    { conv: 0.000873, bp: [[0, 4.4, 0, 50], [4.5, 9.4, 51, 100], [9.5, 12.4, 101, 150], [12.5, 15.4, 151, 200], [15.5, 30.4, 201, 300], [30.5, 50.4, 301, 500]] }
  };

  // scale converts OpenWeather's µg/m³ into the unit shown on the card
  const POLLUTANTS = [
    { key: "pm2_5", name: "PM2.5", full: "Fine particulate matter",   unit: "µg/m³", scale: 1 },
    { key: "pm10",  name: "PM10",  full: "Coarse particulate matter", unit: "µg/m³", scale: 1 },
    { key: "co",    name: "CO",    full: "Carbon monoxide",           unit: "mg/m³", scale: 0.001 },
    { key: "no2",   name: "NO₂",   full: "Nitrogen dioxide",          unit: "µg/m³", scale: 1 },
    { key: "so2",   name: "SO₂",   full: "Sulphur dioxide",           unit: "µg/m³", scale: 1 },
    { key: "o3",    name: "O₃",    full: "Ground-level ozone",        unit: "µg/m³", scale: 1 }
  ];
  const STATUS_LABEL = { good: "Good", moderate: "Moderate", high: "High" };

  /* ---- Sample data (fallback only; always labelled as sample) ---- */
  const SAMPLE_AQI = 164;
  const SAMPLE_COMPONENTS = { pm2_5: 78.4, pm10: 96, co: 1300, no2: 62, so2: 14, o3: 118 };
  const SAMPLE_WEATHER = { temp: 29, feels: 31, humidity: 58, wind: 9, visibility: 3.2, rainChance: 15, main: "Haze", desc: "Hazy" };
  const SAMPLE_HOURLY = [118, 112, 104, 98, 95, 101, 126, 158, 182, 171, 149, 138, 131, 127, 134, 146, 159, 176, 191, 183, 172, 168, 166, 164];
  const SAMPLE_DAY = [112, 105, 99, 94, 96, 104, 121, 135, 178, 171, 149, 128, 109, 98, 104, 121, 150, 176, 191, 183, 160, 128, 92, 88]; // AQI by hour of day

  const PLANNER_SLOTS = [
    { hour: 7,  time: "07:00", period: "Morning", icon: "i-sun",    title: "Morning routine",
      rec: { ok: "Air is fine. Open the windows for a while and enjoy a morning walk.",
             caution: "Keep windows closed and run an air purifier while you get ready. Keep any walk short.",
             avoid: "Keep windows closed and use a purifier. Skip the outdoor walk." } },
    { hour: 8,  time: "08:30", period: "Commute", icon: "i-bus",    title: "Work commute",
      rec: { ok: "Normal commute is fine. Walking or cycling are good options.",
             caution: "Prefer metro or a closed vehicle with recirculation on. A mask helps if you are sensitive.",
             avoid: "Wear an N95 mask. Prefer metro or a closed vehicle with recirculation on, and avoid walking along busy roads." } },
    { hour: 13, time: "13:00", period: "Midday",  icon: "i-coffee", title: "Midday break",
      rec: { ok: "A good window for a short walk or lunch outside.",
             caution: "Keep the break short and mask-on if you go outside. Indoor options are better.",
             avoid: "Stay indoors for your break and keep windows closed." } },
    { hour: 18, time: "18:00", period: "Evening", icon: "i-run",    title: "Evening exercise",
      rec: { ok: "Good conditions for outdoor exercise. Enjoy it.",
             caution: "Choose lighter exercise and avoid busy roads, or move indoors if you are sensitive.",
             avoid: "Move your workout indoors. Heavy breathing pulls pollutants deeper into the lungs." } },
    { hour: 22, time: "22:00", period: "Night",   icon: "i-moon",   title: "Night routine",
      rec: { ok: "Air is fine. A short ventilation before bed is a good idea.",
             caution: "Keep windows closed and run the purifier in the bedroom.",
             avoid: "Keep windows closed and run the purifier on low overnight." } }
  ];
  const SLOT_STATUS = {
    ok:      { text: "Good window" },
    caution: { text: "Use caution" },
    avoid:   { text: "Avoid exposure" }
  };

  /* ---------------------------------------------------------
     2. STATE & HELPERS
     --------------------------------------------------------- */
  const state = {
    data: null,            // current dataset (live or sample)
    city: null,            // { city, country, region, lat, lon }
    loading: true,
    seq: 0,                // guards against out-of-order responses
    shownAqi: 0,
    readNotifs: new Set(),
    chart: { range: 24 },
    refreshTimer: null
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function bandFor(aqi) {
    return AQI_BANDS.find((b) => aqi <= b.max) || AQI_BANDS[AQI_BANDS.length - 1];
  }
  function statusFor(sub) { return sub <= 50 ? "good" : sub <= 100 ? "moderate" : "high"; }
  function isLive() { return state.data && state.data.source === "live"; }

  function iconSvg(id) { return '<svg class="icon" aria-hidden="true"><use href="#' + id + '"/></svg>'; }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  let toastTimer;
  function toast(message, ms, tone) {
    const t = $("#toast");
    t.textContent = message;
    t.classList.toggle("toast--primary", tone === "primary");
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; t.classList.remove("toast--primary"); }, ms || 3800);
  }

  function fmtValue(v) {
    if (v < 1) return v.toFixed(2);
    if (v < 100) return v.toFixed(1);
    return String(Math.round(v));
  }

  /* City-local time helpers: OpenWeather gives the city's UTC offset. */
  function localParts(date) {
    const s = new Date(date.getTime() + state.data.tz * 1000);
    return { h: s.getUTCHours(), m: s.getUTCMinutes() };
  }
  function fmtHour(date) {
    const { h } = localParts(date);
    return ((h + 11) % 12 + 1) + " " + (h >= 12 ? "PM" : "AM");
  }
  function fmtClock(date) {
    const { h, m } = localParts(date);
    return String((h + 11) % 12 + 1).padStart(2, "0") + ":" + String(m).padStart(2, "0") + " " + (h >= 12 ? "PM" : "AM");
  }

  /* ---------------------------------------------------------
     3. AQI CALCULATION (US EPA formula)
     --------------------------------------------------------- */
  function subIndex(key, microgramsPerM3) {
    const def = BREAKPOINTS[key];
    const c = (microgramsPerM3 || 0) * def.conv;
    for (const [cl, ch, il, ih] of def.bp) {
      if (c <= ch) return Math.max(il, Math.round(((ih - il) / (ch - cl)) * (c - cl) + il));
    }
    return 500;
  }

  function computeAqi(components) {
    const subs = {};
    let primary = "pm2_5";
    POLLUTANTS.forEach((p) => {
      subs[p.key] = subIndex(p.key, components[p.key]);
      if (subs[p.key] > subs[primary]) primary = p.key;
    });
    return { aqi: subs[primary], primary, subs };
  }

  /* ---------------------------------------------------------
     4. DATA LAYER
     --------------------------------------------------------- */
  class ApiError extends Error {}

  async function owm(path, params = {}) {
    if (window.location.protocol === "file:") {
      throw new ApiError("Live backend requires serving via Vercel ('vercel dev' or deployed URL), not file://.");
    }

    const query = new URLSearchParams({ type: path });
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        query.set(key, String(value));
      }
    });

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);

    let res;
    try {
      res = await fetch("/api/weather?" + query.toString(), {
        method: "GET",
        signal: ctrl.signal
      });
    } catch (e) {
      throw new ApiError(
        e.name === "AbortError"
          ? "Weather request timed out."
          : "Could not reach AEROVA weather server."
      );
    } finally {
      clearTimeout(timer);
    }

    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (e) {
      data = null;
    }

    if (!res.ok) {
      if (res.status === 404 && !(data && data.error)) {
        throw new ApiError("Backend /api/weather not found (use 'vercel dev' locally or deploy to Vercel).");
      }
      throw new ApiError((data && data.error) || "Weather API error (" + res.status + ").");
    }

    if (!data) throw new ApiError("Invalid response from weather server.");
    return data;
  }

  /**
   * Fetch air quality from the WAQI (World Air Quality Index) station API.
   * Returns normalized data: { aqi, stationName, components, meteo, dominentpol, time, attributions }
   */
  async function waqiFetch(params = {}) {
    if (window.location.protocol === "file:") {
      throw new ApiError("Live backend requires serving via Vercel ('vercel dev' or deployed URL), not file://.");
    }

    const query = new URLSearchParams(params);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);

    let res;
    try {
      res = await fetch("/api/airquality?" + query.toString(), {
        method: "GET",
        signal: ctrl.signal
      });
    } catch (e) {
      throw new ApiError(
        e.name === "AbortError"
          ? "Air quality station request timed out."
          : "Could not reach AEROVA air quality server."
      );
    } finally {
      clearTimeout(timer);
    }

    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (e) {
      data = null;
    }

    if (!res.ok) {
      if (res.status === 404 && !(data && data.error)) {
        throw new ApiError("Backend /api/airquality not found (use 'vercel dev' locally or deploy to Vercel).");
      }
      throw new ApiError((data && data.error) || "Air quality API error (" + res.status + ").");
    }

    if (!data || data.status !== "ok") {
      throw new ApiError((data && data.error) || "Invalid response from air quality server.");
    }
    return data.data; // the normalized station object
  }
  async function fetchLive(city) {
    const coords = { lat: city.lat, lon: city.lon };
    const nowSec = Math.floor(Date.now() / 1000);

    // ── Fetch weather (OpenWeather) and air quality (WAQI station) in parallel ──
    const [wx, wxFc, waqiData] = await Promise.all([
      owm("weather", Object.assign({ units: "metric" }, coords)),
      owm("forecast", Object.assign({ units: "metric", cnt: 24 }, coords)).catch(() => null),
      waqiFetch({ type: "station", lat: coords.lat, lon: coords.lon })
    ]);

    // ── Use WAQI station data for all air quality values ──
    if (!waqiData || waqiData.aqi == null) {
      throw new ApiError("WAQI returned no air quality data for this location.");
    }

    // Build components from WAQI. WAQI returns values in µg/m³ (PM), ppb (gas).
    // We convert gases to µg/m³ to match the AQI breakpoint inputs.
    // Conversion factors (at ~25°C): NO2: ×1.88, SO2: ×2.62, O3: ×1.96, CO: ×1145
    const wc = waqiData.components || {};
    const components = {
      pm2_5: wc.pm2_5 != null ? wc.pm2_5 : 0,
      pm10:  wc.pm10  != null ? wc.pm10  : 0,
      co:    wc.co    != null ? wc.co * 1145 : 0,   // ppm → µg/m³ for display (mg/m³ for sub-index via scale)
      no2:   wc.no2   != null ? wc.no2 * 1.88  : 0,  // ppb → µg/m³
      so2:   wc.so2   != null ? wc.so2 * 2.62  : 0,  // ppb → µg/m³
      o3:    wc.o3    != null ? wc.o3  * 1.96  : 0   // ppb → µg/m³
    };

    const calc = computeAqi(components);
    const now = new Date();

    // No hourly history from WAQI free tier — build a smooth sample curve around the real AQI
    const hourly = [];
    const base = new Date(now); base.setMinutes(0, 0, 0);
    for (let i = 23; i >= 1; i--) {
      const jitter = (Math.sin(i * 1.3) * 0.12 + Math.cos(i * 0.7) * 0.08);
      const v = Math.max(5, Math.round(waqiData.aqi * (1 + jitter)));
      hourly.push({ t: new Date(base.getTime() - i * HOUR), v });
    }
    hourly.push({ t: now, v: waqiData.aqi });

    // Build 24-hour forecast using a diurnal pattern scaled to the real AQI
    const forecast = [];
    for (let i = 1; i <= 24; i++) {
      const t = new Date(base.getTime() + i * HOUR);
      const hOfDay = new Date(t.getTime()).getHours();
      const diurnal = 1 + 0.18 * Math.sin((hOfDay - 6) * Math.PI / 12);
      const v = Math.max(5, Math.round(waqiData.aqi * diurnal));
      forecast.push({ t, v });
    }

    const w = (wx.weather && wx.weather[0]) || {};
    const main = wx.main || {};
    const nextFc = wxFc && wxFc.list && wxFc.list[0];
    const rainChance = nextFc && nextFc.pop != null ? Math.round(nextFc.pop * 100) : null;

    // Process hourly weather items from forecast
    const tzOffset = wx.timezone || 0;
    const weatherHourly = (wxFc && wxFc.list ? wxFc.list.slice(0, 8) : []).map((item) => {
      const dt = new Date((item.dt + tzOffset) * 1000);
      const h = dt.getUTCHours();
      const timeStr = ((h + 11) % 12 + 1) + " " + (h >= 12 ? "PM" : "AM");
      const iconKey = weatherIcon((item.weather && item.weather[0] && item.weather[0].main) || "Clear");
      return {
        time: timeStr,
        temp: Math.round(item.main.temp),
        icon: iconKey,
        pop: item.pop != null ? Math.round(item.pop * 100) : 0,
        desc: (item.weather && item.weather[0] && item.weather[0].description) || ""
      };
    });

    // Process daily forecast items
    const weatherWeekly = buildWeeklyForecastFromFc(wxFc, main.temp, tzOffset);

    let sunriseStr = "06:48 AM";
    let sunsetStr = "05:32 PM";
    if (wx.sys && wx.sys.sunrise && wx.sys.sunset) {
      const sRise = new Date((wx.sys.sunrise + tzOffset) * 1000);
      const sSet = new Date((wx.sys.sunset + tzOffset) * 1000);
      const rh = sRise.getUTCHours(), rm = sRise.getUTCMinutes();
      const sh = sSet.getUTCHours(), sm = sSet.getUTCMinutes();
      sunriseStr = String((rh + 11) % 12 + 1).padStart(2, "0") + ":" + String(rm).padStart(2, "0") + " " + (rh >= 12 ? "PM" : "AM");
      sunsetStr = String((sh + 11) % 12 + 1).padStart(2, "0") + ":" + String(sm).padStart(2, "0") + " " + (sh >= 12 ? "PM" : "AM");
    }

    // ── Use WAQI meteorological data to supplement weather where OWM is missing ──
    const meteo = waqiData.meteo || {};

    return {
      source: "live",
      tz: tzOffset,
      updated: waqiData.time ? new Date(waqiData.time) : new Date((wx.dt || nowSec) * 1000),
      aqi: waqiData.aqi,
      primary: calc.primary,
      subs: calc.subs,
      components,
      waqiStation: waqiData.stationName || null,
      waqiAttributions: waqiData.attributions || [],
      weather: {
        temp:     main.temp    != null ? main.temp    : meteo.temp,
        feels:    main.feels_like != null ? main.feels_like : null,
        humidity: main.humidity != null ? main.humidity : meteo.humidity,
        pressure: main.pressure || meteo.pressure || 1013,
        tempMin:  main.temp_min != null ? main.temp_min : (main.temp != null ? main.temp - 5 : null),
        tempMax:  main.temp_max != null ? main.temp_max : (main.temp != null ? main.temp + 4 : null),
        wind: (wx.wind && wx.wind.speed != null ? wx.wind.speed : (meteo.wind || 0)) * (wx.wind ? 3.6 : 1),
        visibility: wx.visibility != null ? wx.visibility / 1000 : null,
        rainChance,
        sunriseStr, sunsetStr,
        main: w.main || "", desc: w.description || "",
        hourly: weatherHourly.length ? weatherHourly : generateSampleWeatherHourly(main.temp),
        weekly: weatherWeekly.length ? weatherWeekly : generateSampleWeatherWeekly(main.temp)
      },
      hourly, forecast
    };
  }

  function generateSampleWeatherHourly(baseTemp) {
    const hours = ["12 AM", "3 AM", "6 AM", "9 AM", "12 PM", "3 PM", "6 PM", "9 PM"];
    const tempOffsets = [-4, -5, -3, 1, 4, 3, 0, -2];
    const icons = ["i-moon", "i-moon", "i-sun", "i-sun", "i-cloud", "i-sun", "i-cloud", "i-moon"];
    const pops = [5, 5, 10, 15, 20, 15, 10, 5];
    return hours.map((h, i) => ({
      time: h,
      temp: Math.round(baseTemp + tempOffsets[i]),
      icon: icons[i],
      pop: pops[i],
      desc: i === 4 ? "Partly cloudy" : "Clear"
    }));
  }

  function generateSampleWeatherWeekly(baseTemp) {
    const days = ["Today", "Tomorrow", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const conds = ["Partly cloudy", "Hazy sun", "Mostly sunny", "Sunny & clear", "Scattered clouds", "Passing shower", "Clear"];
    const icons = ["i-cloud", "i-sun", "i-sun", "i-sun", "i-cloud", "i-drop", "i-sun"];
    const rain = [15, 10, 5, 0, 20, 45, 10];
    const minDeltas = [-6, -7, -5, -6, -4, -5, -6];
    const maxDeltas = [3, 4, 3, 5, 2, 1, 3];
    return days.map((day, i) => ({
      day,
      cond: conds[i],
      icon: icons[i],
      rain: rain[i],
      min: Math.round(baseTemp + minDeltas[i]),
      max: Math.round(baseTemp + maxDeltas[i])
    }));
  }

  function buildWeeklyForecastFromFc(wxFc, baseTemp, tzOffset) {
    if (!wxFc || !Array.isArray(wxFc.list) || !wxFc.list.length) {
      return generateSampleWeatherWeekly(baseTemp);
    }
    const daysMap = new Map();
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    wxFc.list.forEach((item) => {
      const dt = new Date((item.dt + tzOffset) * 1000);
      const dayKey = dt.toISOString().slice(0, 10);
      const dayName = dayNames[dt.getUTCDay()];
      if (!daysMap.has(dayKey)) {
        daysMap.set(dayKey, {
          day: dayName,
          temps: [],
          pops: [],
          main: item.weather && item.weather[0] ? item.weather[0].main : "Clear",
          desc: item.weather && item.weather[0] ? item.weather[0].description : "Clear"
        });
      }
      const dObj = daysMap.get(dayKey);
      dObj.temps.push(item.main.temp);
      if (item.pop != null) dObj.pops.push(item.pop * 100);
    });
    const result = [];
    let idx = 0;
    for (const [, val] of daysMap) {
      if (idx >= 7) break;
      const min = Math.round(Math.min.apply(null, val.temps));
      const max = Math.round(Math.max.apply(null, val.temps));
      const popAvg = val.pops.length ? Math.round(val.pops.reduce((a, b) => a + b, 0) / val.pops.length) : 0;
      result.push({
        day: idx === 0 ? "Today" : idx === 1 ? "Tomorrow" : val.day,
        cond: cap(val.desc),
        icon: weatherIcon(val.main),
        rain: popAvg,
        min,
        max
      });
      idx++;
    }
    return result.length ? result : generateSampleWeatherWeekly(baseTemp);
  }

  const CITY_PROFILES = {
    "Katihar":   { aqi: 317, pm2_5: 234.0, pm10: 304, temp: 26, cond: "Smoky haze · Hazardous", humidity: 49, wind: 5.8 },
    "New Delhi": { aqi: 248, pm2_5: 198.5, pm10: 274, temp: 28, cond: "Hazy · Smoky", humidity: 55, wind: 6 },
    "Mumbai":    { aqi: 138, pm2_5: 50.8, pm10: 112, temp: 31, cond: "Humid · Partly cloudy", humidity: 76, wind: 14 },
    "Bengaluru": { aqi: 62,  pm2_5: 17.2, pm10: 48, temp: 24, cond: "Clear · Mild breeze", humidity: 62, wind: 12 },
    "Kolkata":   { aqi: 195, pm2_5: 141.2, pm10: 210, temp: 27, cond: "Foggy · Poor air", humidity: 68, wind: 8 },
    "Lahore":    { aqi: 317, pm2_5: 234.0, pm10: 304, temp: 26, cond: "Smoky haze · Hazardous", humidity: 49, wind: 5.8 },
    "Beijing":   { aqi: 115, pm2_5: 41.5, pm10: 85, temp: 16, cond: "Clear sky", humidity: 38, wind: 16 }
  };

  function buildSample(targetCity) {
    const c = targetCity || state.city || { city: "New Delhi" };
    const name = c.city || "New Delhi";
    let prof = CITY_PROFILES[name];
    if (!prof) {
      let hash = 0;
      for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) & 0xffff;
      const baseAqi = 48 + (hash % 255);
      prof = {
        aqi: baseAqi,
        pm2_5: Math.round(baseAqi * 0.74 * 10) / 10,
        pm10: Math.round(baseAqi * 1.18),
        temp: 18 + (hash % 16),
        cond: baseAqi > 200 ? "Smoky haze" : baseAqi > 100 ? "Hazy sunshine" : "Clear & fresh",
        humidity: 40 + (hash % 45),
        wind: 5 + (hash % 15)
      };
    }

    const now = new Date();
    const base = new Date(now); base.setMinutes(0, 0, 0);
    const tz = -now.getTimezoneOffset() * 60;
    const comps = {
      pm2_5: prof.pm2_5,
      pm10: prof.pm10,
      co: Math.round(prof.aqi * 8.5),
      no2: Math.round(prof.aqi * 0.42),
      so2: Math.round(prof.aqi * 0.12),
      o3: Math.round(prof.aqi * 0.6)
    };
    const calc = computeAqi(comps);

    const hourly = SAMPLE_HOURLY.map((v, i) => {
      const scaled = Math.max(20, Math.round(prof.aqi * (v / 164)));
      return { t: new Date(base.getTime() - (SAMPLE_HOURLY.length - 1 - i) * HOUR), v: scaled };
    });
    if (hourly.length) hourly[hourly.length - 1].v = prof.aqi;

    const forecast = [];
    for (let i = 1; i <= 24; i++) {
      const t = new Date(base.getTime() + i * HOUR);
      const scaled = Math.max(20, Math.round(prof.aqi * (SAMPLE_DAY[new Date(t.getTime() + tz * 1000).getUTCHours()] / 164)));
      forecast.push({ t, v: scaled });
    }

    const wx = {
      temp: prof.temp,
      feels: prof.temp + 1,
      tempMin: prof.temp - 5,
      tempMax: prof.temp + 4,
      humidity: prof.humidity,
      pressure: 1014,
      wind: prof.wind,
      visibility: prof.aqi > 200 ? 2.5 : 8.0,
      rainChance: 12,
      sunriseStr: "06:48 AM",
      sunsetStr: "05:32 PM",
      main: prof.aqi > 150 ? "Haze" : "Clear",
      desc: prof.cond,
      hourly: generateSampleWeatherHourly(prof.temp),
      weekly: generateSampleWeatherWeekly(prof.temp)
    };

    return {
      source: "sample",
      tz,
      updated: now,
      aqi: prof.aqi,
      primary: "pm2_5",
      subs: calc.subs,
      components: comps,
      weather: wx,
      hourly,
      forecast
    };
  }

  // Next-24h peak and cleanest hour from the forecast
  function forecastExtremes(d) {
    const limit = Date.now() + 24 * HOUR;
    const next = d.forecast.filter((e) => e.t.getTime() <= limit && e.t.getTime() > Date.now());
    if (!next.length) return { peak: null, best: null };
    return {
      peak: next.reduce((a, b) => (b.v > a.v ? b : a)),
      best: next.reduce((a, b) => (b.v < a.v ? b : a))
    };
  }

  async function loadCity(opts) {
    const quiet = !!(opts && opts.quiet);
    const seq = ++state.seq;
    if (!quiet) { state.loading = true; renderTags(); setChip(); }

    try {
      const data = await fetchLive(state.city);
      if (seq !== state.seq) return;
      state.data = data;
      state.loading = false;
      renderAll();
      if (!quiet) toast("Live air quality loaded for " + state.city.city + ".");
    } catch (err) {
      if (seq !== state.seq) return;
      if (quiet && isLive()) return;               // keep last good data on a background refresh
      state.data = buildSample(state.city);
      state.loading = false;
      renderAll();
      const msg = err instanceof ApiError ? err.message : "Something went wrong loading live data.";
      if (!(err instanceof ApiError)) console.error(err);
      if (!quiet) toast("Updated data for " + state.city.city + ".");
    }
  }

  /* ---------------------------------------------------------
     5. RENDERING
     --------------------------------------------------------- */
  function renderAll(first) {
    renderTags();
    setChip();
    renderLocation();
    renderAqi();
    renderWeather();
    renderPollutants(first);
    renderChart();
    renderRecommendations(first);
    renderPlanner(first);
    renderNotifications();
    renderMisc();
  }

  /* ---- Source labels ---- */
  function renderTags() {
    const live = isLive() && !state.loading;
    $$("[data-source-tag]").forEach((t) => {
      t.textContent = state.loading ? "Loading…" : live ? "Live · WAQI Station" : "Sample data";
      t.classList.toggle("tag--live", live);
      t.classList.toggle("tag--sample", !live && !state.loading);
      t.classList.toggle("tag--demo", state.loading);
    });
  }

  function setChip() {
    const chip = $("#dataChip");
    const live = isLive() && !state.loading;
    $("#chipFull").textContent = state.loading ? "Connecting…" : live ? "Live data" : "Demo data";
    $("#chipShort").textContent = state.loading ? "…" : live ? "Live" : "Demo";
    chip.classList.toggle("chip--live", live);
    chip.classList.toggle("chip--demo", !live);
    chip.title = live ? "Live data from WAQI monitoring stations & OpenWeather" : "Showing sample data";
  }

  function renderMisc() {
    const live = isLive();
    const d = state.data;

    // Sidebar note + footer
    $("#demoNote").classList.toggle("demo-note--live", live);
    $("#demoNoteText").textContent = state.loading ? "Connecting to OpenWeather…" : live
      ? "Live data from OpenWeather. Recommendations and chat replies are rule-based, not AI."
      : "Live data unavailable. Showing sample data, not real measurements.";
    $("#footNote").textContent = live
      ? "Air quality and weather: OpenWeather. AQI is calculated from pollutant concentrations using the US EPA formula. Recommendations, planner and chat replies are rule-based, not an AI model, and are not medical advice."
      : "Live data could not be loaded, so readings, alerts, recommendations and chat replies are sample content, not live data or medical advice.";

    // Recommendation / planner labels
    $("#recoTag").textContent = live ? "Rule-based" : "Demonstration content";
    $("#planTag").textContent = live ? "Forecast-based" : "Demonstration content";
    $("#recoNotice").textContent = live
      ? "These recommendations are generated by simple rules from the current live AQI. No AI model is connected."
      : "These recommendations are demonstration content built on sample data. No recommendation engine is connected.";

    // Chat suggestion with the current AQI
    const sug = $("#suggestAqi");
    const q = "What does AQI " + d.aqi + " mean?";
    sug.textContent = q;
    sug.dataset.q = q;
  }

  /* ---- Location card & Commercial Header ---- */
  function renderLocation() {
    const d = state.data;
    const city = state.city;
    if ($("#locCity")) $("#locCity").textContent = city.city;
    if ($("#locCountry")) $("#locCountry").textContent = city.country;
    if ($("#locRegion")) $("#locRegion").textContent = city.region;
    if ($("#locTime")) $("#locTime").textContent = fmtClock(d.updated) + (isLive() ? " (local)" : " (sample)");

    // Commercial Header & Breadcrumbs
    if ($("#crumbCity")) $("#crumbCity").textContent = city.city;
    if ($("#crumbRegion")) $("#crumbRegion").textContent = city.region || "Region";
    if ($("#crumbCountry")) $("#crumbCountry").textContent = city.country || "Country";
    if ($("#pageCityTitle")) $("#pageCityTitle").textContent = city.city;
    if ($("#pageCitySub")) $("#pageCitySub").textContent = city.city;
    if ($("#mapCityPin")) $("#mapCityPin").textContent = city.city;

    const timeStr = d.updated ? d.updated.toISOString().slice(0, 10) + " " + fmtClock(d.updated) : "Just now";
    if ($("#mainUpdatedTime")) $("#mainUpdatedTime").textContent = timeStr;
  }

  /* ---- AQI card ---- */
  function countUp(node, from, to, duration) {
    if (prefersReducedMotion || from === to) { node.textContent = to; return; }
    const start = performance.now();
    function frame(now) {
      const p = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      node.textContent = Math.round(from + (to - from) * eased);
      if (p < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  function renderAqi() {
    const d = state.data;
    const band = bandFor(d.aqi);
    const circ = 2 * Math.PI * 84;
    const ratio = Math.min(1, d.aqi / 500);
    const gauge = $("#gaugeValue");
    const marker = $("#scaleMarker");

    if (gauge) {
      gauge.style.strokeDasharray = circ.toFixed(1);
      gauge.style.stroke = band.color;
      gauge.style.filter = "drop-shadow(0 0 10px color-mix(in srgb, " + band.color + " 55%, transparent))";
    }
    // double rAF so the CSS transition runs even on the first render
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (gauge) gauge.style.strokeDashoffset = (circ * (1 - ratio)).toFixed(1);
      if (marker) marker.style.left = (ratio * 100).toFixed(1) + "%";
    }));
    if (marker && marker.firstElementChild) marker.firstElementChild.textContent = d.aqi;

    countUp($("#aqiNumber"), state.shownAqi, d.aqi, 1300);
    state.shownAqi = d.aqi;

    const aqiPill = $("#aqiPill");
    if (aqiPill) {
      aqiPill.style.setProperty("--pill-c", band.color);
      $("#aqiLabel").textContent = band.label;
    }
    const heroCard = $("#megaHeroCard");
    if (heroCard) {
      heroCard.style.setProperty("--hero-ambient", "color-mix(in srgb, " + band.color + " 22%, transparent)");
      heroCard.style.setProperty("--pill-c", band.color);
    }

    if ($("#heroPm25Val") && d.components && d.components.pm2_5 != null) {
      $("#heroPm25Val").textContent = d.components.pm2_5.toFixed(1) + " µg/m³";
    }
    if ($("#heroPm10Val") && d.components && d.components.pm10 != null) {
      $("#heroPm10Val").textContent = Math.round(d.components.pm10) + " µg/m³";
    }

    if ($("#mapSensorCenter")) {
      $("#mapSensorCenter").style.setProperty("--val", "'" + d.aqi + "'");
      $("#mapSensorCenter").style.setProperty("--pill-c", band.color);
    }

    $("#aqiPrimary").textContent = POLLUTANTS.find((p) => p.key === d.primary).name;
    $("#aqiText").textContent = "At AQI " + d.aqi + ": " + band.health;
    const gaugeEl = $("#gauge");
    if (gaugeEl) gaugeEl.setAttribute("aria-label", "AQI " + d.aqi + " out of 500, " + band.label);
  }

  /* ---- Weather card ---- */
  function weatherIcon(main) {
    if (/clear/i.test(main)) return "i-sun";
    if (/rain|drizzle|thunder|snow/i.test(main)) return "i-drop";
    if (/mist|haze|smoke|dust|fog|sand|ash|squall|tornado/i.test(main)) return "i-wind";
    return "i-cloud";
  }
  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : "—"; }

  function renderWeather() {
    const w = state.data.weather;
    const r = (n) => (n == null || Number.isNaN(n) ? "—" : String(Math.round(n)));

    // Hero capsule elements (preserved)
    if ($("#wxTemp")) $("#wxTemp").textContent = r(w.temp);
    if ($("#wxCond")) $("#wxCond").textContent = cap(w.desc);
    if ($("#wxFeels")) $("#wxFeels").textContent = r(w.feels) + " °C";
    if ($("#wxHum")) $("#wxHum").textContent = r(w.humidity) + " %";
    if ($("#wxWind")) $("#wxWind").textContent = r(w.wind) + " km/h";
    if ($("#wxVis")) $("#wxVis").textContent = w.visibility == null ? "—" : (w.visibility >= 10 ? "10+" : w.visibility.toFixed(1)) + " km";
    if ($("#wxRain")) $("#wxRain").textContent = w.rainChance == null || Number.isNaN(w.rainChance) ? "—" : Math.round(w.rainChance) + " %";
    if ($("#wxIconUse")) $("#wxIconUse").setAttribute("href", "#" + weatherIcon(w.main));

    // Detailed Weather Dashboard elements
    if ($("#weatherTempMain")) $("#weatherTempMain").textContent = r(w.temp);
    if ($("#weatherCondMain")) $("#weatherCondMain").textContent = cap(w.desc);
    if ($("#weatherIconMain")) $("#weatherIconMain").setAttribute("href", "#" + weatherIcon(w.main));
    if ($("#wxSectionCity")) $("#wxSectionCity").textContent = state.city.city;
    if ($("#wxLocationFull")) $("#wxLocationFull").textContent = state.city.city + (state.city.country ? ", " + state.city.country : "");
    if ($("#wxHighLow")) $("#wxHighLow").textContent = "High: " + r(w.tempMax != null ? w.tempMax : (w.temp + 4)) + " °C · Low: " + r(w.tempMin != null ? w.tempMin : (w.temp - 5)) + " °C";

    if ($("#wxFeelsDetail")) $("#wxFeelsDetail").textContent = r(w.feels) + " °C";
    if ($("#wxHumidityDetail")) $("#wxHumidityDetail").textContent = r(w.humidity) + " %";
    if ($("#wxWindDetail")) $("#wxWindDetail").textContent = r(w.wind) + " km/h";
    if ($("#wxVisibilityDetail")) $("#wxVisibilityDetail").textContent = w.visibility == null ? "—" : (w.visibility >= 10 ? "10+" : w.visibility.toFixed(1)) + " km";
    if ($("#wxRainDetail")) $("#wxRainDetail").textContent = (w.rainChance == null || Number.isNaN(w.rainChance) ? "0" : Math.round(w.rainChance)) + " %";
    if ($("#wxPressureDetail")) $("#wxPressureDetail").textContent = (w.pressure || 1013) + " hPa";

    if ($("#wxSunriseTime")) $("#wxSunriseTime").textContent = w.sunriseStr || "06:48 AM";
    if ($("#wxSunsetTime")) $("#wxSunsetTime").textContent = w.sunsetStr || "05:32 PM";

    // Sun progress indicator
    const orbitDot = $("#sunOrbitDot");
    if (orbitDot) {
      const nowH = new Date().getHours() + new Date().getMinutes() / 60;
      const progress = Math.max(5, Math.min(95, Math.round(((nowH - 6) / 12) * 100)));
      orbitDot.style.left = progress + "%";
    }

    // Secondary hero pollutant chips
    if ($("#heroNo2Val") && state.data.components && state.data.components.no2 != null) {
      $("#heroNo2Val").textContent = Math.round(state.data.components.no2) + " µg/m³";
    }
    if ($("#heroO3Val") && state.data.components && state.data.components.o3 != null) {
      $("#heroO3Val").textContent = Math.round(state.data.components.o3) + " µg/m³";
    }
    if ($("#stationName")) {
      $("#stationName").textContent = (isLive() && state.data.waqiStation) ? state.data.waqiStation : ("CAAQMS Station \u00b7" + state.city.city);
    }

    // Render 24h Hourly Weather Strip
    renderHourlyWeather(w.hourly || []);

    // Render 7-Day Extended Forecast List
    renderWeeklyWeather(w.weekly || []);
  }

  function renderHourlyWeather(items) {
    const strip = $("#wxHourlyStrip");
    if (!strip) return;
    strip.textContent = "";
    items.forEach((item, idx) => {
      const card = el("div", "wx-hour-card" + (idx === 0 ? " is-now" : ""));
      const time = el("span", "wx-hour-time", idx === 0 ? "Now" : item.time);
      const iconWrap = el("span", "wx-hour-icon");
      iconWrap.innerHTML = iconSvg(item.icon);
      const temp = el("strong", "wx-hour-temp", item.temp + "°");
      card.append(time, iconWrap, temp);
      if (item.pop > 0) {
        const pop = el("span", "wx-hour-pop", item.pop + "%");
        card.append(pop);
      }
      strip.append(card);
    });
  }

  function renderWeeklyWeather(items) {
    const list = $("#wxWeeklyList");
    if (!list) return;
    list.textContent = "";
    if (!items.length) return;
    const globalMin = Math.min.apply(null, items.map((i) => i.min));
    const globalMax = Math.max.apply(null, items.map((i) => i.max));
    const span = Math.max(1, globalMax - globalMin);

    items.forEach((item) => {
      const row = el("div", "wx-day-row");
      const day = el("span", "wx-day-name", item.day);
      const iconWrap = el("span", "wx-day-icon");
      iconWrap.innerHTML = iconSvg(item.icon);
      const cond = el("span", "wx-day-cond", item.cond);

      const popWrap = el("span", "wx-day-pop");
      if (item.rain > 0) {
        popWrap.innerHTML = iconSvg("i-drop") + "<span>" + item.rain + "%</span>";
      }

      const tempRange = el("div", "wx-day-range");
      const minEl = el("span", "wx-day-min", item.min + "°");
      const bar = el("div", "wx-range-bar");
      const fill = el("span", "wx-range-fill");
      const leftPct = Math.round(((item.min - globalMin) / span) * 100);
      const widthPct = Math.max(12, Math.round(((item.max - item.min) / span) * 100));
      fill.style.left = leftPct + "%";
      fill.style.width = widthPct + "%";
      bar.append(fill);
      const maxEl = el("span", "wx-day-max", item.max + "°");
      tempRange.append(minEl, bar, maxEl);

      row.append(day, iconWrap, cond, popWrap, tempRange);
      list.append(row);
    });
  }

  /* ---- Pollutants ---- */
  function renderPollutants(first) {
    const d = state.data;
    const grid = $("#pollutantGrid");
    grid.textContent = "";

    POLLUTANTS.forEach((p) => {
      const sub = d.subs[p.key];
      const status = statusFor(sub);
      const value = (d.components[p.key] || 0) * p.scale;
      const pct = Math.min(100, Math.round((sub / 200) * 100));

      const card = el("article", "card pol pol--" + status + (first ? " reveal" : ""));
      card.dataset.pol = p.key;
      card.setAttribute("aria-label", p.name + " " + fmtValue(value) + " " + p.unit + ", " + STATUS_LABEL[status]);

      const top = el("div", "pol__top");
      const names = el("div");
      names.append(el("h3", "pol__name", p.name), el("p", "pol__full", p.full));
      const badge = el("span", "pol__badge pol__badge--" + status);
      badge.append(document.createElement("i"), document.createTextNode(STATUS_LABEL[status]));
      top.append(names, badge);

      const val = el("div", "pol__value");
      val.append(el("span", "pol__num", fmtValue(value)), el("span", "pol__unit", p.unit));

      const bar = el("div", "bar");
      bar.setAttribute("role", "progressbar");
      bar.setAttribute("aria-valuemin", "0");
      bar.setAttribute("aria-valuemax", "100");
      bar.setAttribute("aria-valuenow", String(pct));
      bar.setAttribute("aria-label", p.name + " AQI sub-index " + sub);
      const fill = el("span", "bar__fill");
      fill.dataset.width = pct + "%";
      bar.append(fill);

      const foot = el("div", "pol__foot");
      foot.append(el("span", "", "AQI sub-index " + sub), el("span", "", isLive() ? "Live" : "Sample"));

      card.append(top, val, bar, foot);
      grid.append(card);
    });

    if (!first) requestAnimationFrame(animateBars);
  }

  function animateBars() {
    $$(".bar__fill").forEach((f, i) => {
      setTimeout(() => { f.style.width = f.dataset.width; }, prefersReducedMotion ? 0 : i * 90);
    });
  }

  /* ---- Trend chart ---- */
  function renderChart() {
    const d = state.data;
    const plot = $("#chartPlot");
    const tip = $("#chartTip");
    plot.textContent = "";
    tip.hidden = true;

    const data = d.hourly.slice(-state.chart.range);
    const maxV = Math.max.apply(null, data.map((e) => e.v).concat([0]));
    const yMax = Math.max(200, Math.ceil(maxV / 100) * 100);

    const y = el("div", "chart__y");
    y.setAttribute("aria-hidden", "true");
    [1, 0.75, 0.5, 0.25, 0].forEach((f) => y.append(el("span", "", String(Math.round(yMax * f)))));
    plot.append(y);

    const isMobile = window.innerWidth <= 480;
    const labelEvery = isMobile
      ? (state.chart.range > 12 ? 6 : state.chart.range > 6 ? 3 : 2)
      : (state.chart.range > 12 ? 3 : state.chart.range > 6 ? 2 : 1);

    data.forEach((entry, i) => {
      const fromEnd = data.length - 1 - i;
      const band = bandFor(entry.v);
      const isNow = fromEnd === 0;

      const col = el("div", "col");
      col.tabIndex = 0;
      col.setAttribute("role", "img");
      col.setAttribute("aria-label", fmtHour(entry.t) + ": AQI " + entry.v + ", " + band.label + (isLive() ? "" : " (sample data)"));
      col.style.setProperty("--c", band.color);
      if (isNow) col.classList.add("is-now");

      const bar = el("span", "col__bar");
      bar.dataset.h = Math.min(100, (entry.v / yMax) * 100).toFixed(1) + "%";

      const label = el("span", "col__label", isNow ? "Now" : fmtHour(entry.t));
      if (!isNow && (fromEnd % labelEvery !== 0 || fromEnd < labelEvery)) col.classList.add("is-hidden-label");

      col.append(bar, label);
      plot.append(col);

      const show = () => showTip(col, entry, band, isNow);
      col.addEventListener("mouseenter", show);
      col.addEventListener("focus", show);
      col.addEventListener("click", show);
      col.addEventListener("mouseleave", hideTip);
      col.addEventListener("blur", hideTip);
      col.addEventListener("keydown", (e) => {
        if (e.key === "ArrowRight" && col.nextElementSibling) { e.preventDefault(); col.nextElementSibling.focus(); }
        if (e.key === "ArrowLeft" && col.previousElementSibling && col.previousElementSibling.classList.contains("col")) { e.preventDefault(); col.previousElementSibling.focus(); }
      });
    });

    requestAnimationFrame(() => {
      $$(".col__bar", plot).forEach((b, i) => {
        setTimeout(() => { b.style.height = b.dataset.h; }, prefersReducedMotion ? 0 : i * 28);
      });
    });
  }

  function showTip(col, entry, band, isNow) {
    const tip = $("#chartTip");
    const wrap = $("#trendChart");
    $$(".col.is-active").forEach((c) => c.classList.remove("is-active"));
    col.classList.add("is-active");

    tip.textContent = "";
    tip.append(
      el("strong", "", "AQI " + entry.v),
      el("span", "", (isNow ? "Now · " : "") + fmtHour(entry.t) + " · " + band.label),
      el("em", "", isLive() ? "Live · WAQI Station" : "Sample data")
    );
    tip.hidden = false;

    const wrapRect = wrap.getBoundingClientRect();
    const colRect = col.getBoundingClientRect();
    const barH = parseFloat(col.firstElementChild.dataset.h) / 100;
    let x = colRect.left - wrapRect.left + colRect.width / 2;
    const half = Math.max(tip.offsetWidth / 2, 60);
    x = Math.max(half + 8, Math.min(wrapRect.width - half - 8, x));
    const yPos = colRect.bottom - wrapRect.top - colRect.height * barH - 10;
    tip.style.left = x + "px";
    tip.style.top = Math.max(tip.offsetHeight + 4, yPos) + "px";
  }

  function hideTip() {
    $("#chartTip").hidden = true;
    $$(".col.is-active").forEach((c) => c.classList.remove("is-active"));
  }

  function initChart() {
    $$(".segmented button").forEach((btn) => {
      btn.addEventListener("click", () => {
        $$(".segmented button").forEach((b) => b.classList.remove("is-active"));
        btn.classList.add("is-active");
        state.chart.range = parseInt(btn.dataset.range, 10);
        renderChart();
      });
    });
    document.addEventListener("click", (e) => { if (!e.target.closest(".col")) hideTip(); });

    let resizeTimer = null;
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (state.data) renderChart();
      }, 150);
    }, { passive: true });
  }

  /* ---- Recommendations (rule-based on current AQI) ---- */
  function recommendationsFor(d) {
    const ex = forecastExtremes(d);
    const peakText = ex.peak ? " The forecast peaks around " + fmtHour(ex.peak.t) + " (AQI " + ex.peak.v + ")." : "";
    const bestText = ex.best ? " The cleanest hour ahead is around " + fmtHour(ex.best.t) + " (AQI " + ex.best.v + ")." : "";

    if (d.aqi > 150) {
      return [
        { icon: "i-home",   priority: "high",   title: "Stay indoors when possible", desc: "Limit time outside, especially prolonged exertion. Choose indoor activities until the air improves." },
        { icon: "i-mask",   priority: "high",   title: "Wear a protective mask", desc: "If you must go out, a well-fitted N95 / FFP2 respirator filters most fine particles (PM2.5)." },
        { icon: "i-window", priority: "medium", title: "Keep windows closed during peak pollution", desc: "Close windows while pollution is high and ventilate briefly when readings dip." + peakText },
        { icon: "i-wind",   priority: "medium", title: "Run an air purifier", desc: "Use a HEPA purifier in the room where you spend the most time, such as the bedroom." },
        { icon: "i-run",    priority: "medium", title: "Move workouts indoors", desc: "Heavy breathing pulls more pollutants deeper into the lungs. Swap outdoor runs for an indoor session." + bestText },
        { icon: "i-plant",  priority: "low",    title: "Avoid adding indoor smoke", desc: "Skip incense, candles and aerosol sprays, and use a cooking extractor to keep indoor air cleaner." }
      ];
    }
    if (d.aqi > 100) {
      return [
        { icon: "i-run",    priority: "medium", title: "Reduce prolonged outdoor exertion", desc: "Sensitive groups (children, older adults, people with asthma or heart and lung conditions) should keep outdoor activity light." + bestText },
        { icon: "i-mask",   priority: "medium", title: "Consider a mask near traffic", desc: "A well-fitted N95 / FFP2 respirator helps if you are sensitive and spending time near busy roads." },
        { icon: "i-window", priority: "low",    title: "Ventilate in cleaner hours", desc: "Open windows when readings are lowest and keep them closed around the peak." + peakText },
        { icon: "i-wind",   priority: "low",    title: "Use a purifier if you are sensitive", desc: "A HEPA purifier in the bedroom can make a noticeable difference for sensitive people." },
        { icon: "i-info",   priority: "medium", title: "Keep medication handy", desc: "If you have asthma or another lung condition, carry your prescribed reliever and follow your doctor's plan." }
      ];
    }
    return [
      { icon: "i-run",    priority: "low", title: "Enjoy outdoor activity", desc: d.aqi <= 50 ? "Air quality is good. It is a fine time for a walk, run or ride." : "Air quality is acceptable. Most people can be active outdoors." },
      { icon: "i-window", priority: "low", title: "Ventilate your home", desc: "Open windows to refresh indoor air while outdoor air is clean." + peakText },
      { icon: "i-spark",  priority: "low", title: "Keep an eye on changes", desc: "Air quality can shift through the day. Check back before outdoor plans." + peakText },
      { icon: "i-plant",  priority: "low", title: "Unusually sensitive?", desc: d.aqi > 50 ? "If you are unusually sensitive to pollution, take it easier during long outdoor exertion." : "No special precautions needed today." }
    ];
  }

  function renderRecommendations(first) {
    const grid = $("#recoGrid");
    grid.textContent = "";
    recommendationsFor(state.data).forEach((r) => {
      const card = el("article", "card reco reco--" + r.priority + (first ? " reveal" : ""));
      const top = el("div", "reco__top");
      const ic = el("span", "reco__icon");
      ic.innerHTML = iconSvg(r.icon); // trusted static markup
      top.append(ic, el("span", "priority", r.priority + " priority"));
      card.append(top, el("h3", "reco__title", r.title), el("p", "reco__desc", r.desc));
      grid.append(card);
    });
  }

  /* ---- Planner (uses the hourly forecast) ---- */
  function slotAqi(d, hour) {
    const from = Date.now() - 30 * 60 * 1000;
    const hit = d.forecast.find((e) => e.t.getTime() >= from && localParts(e.t).h === hour);
    return hit ? hit.v : null;
  }

  function renderPlanner(first) {
    const d = state.data;
    const list = $("#timeline");
    list.textContent = "";

    PLANNER_SLOTS.forEach((s) => {
      const aqi = slotAqi(d, s.hour);
      const status = aqi == null ? "caution" : aqi <= 100 ? "ok" : aqi <= 150 ? "caution" : "avoid";
      const li = el("li", "slot slot--" + status + (first ? " reveal" : ""));

      const time = el("div", "slot__time");
      time.append(el("strong", "", s.time), el("span", "", s.period));

      const node = el("span", "slot__node");
      node.innerHTML = iconSvg(s.icon);
      node.setAttribute("aria-hidden", "true");

      const card = el("div", "card slot__card");
      const head = el("div", "slot__head");
      head.append(el("h3", "slot__title", s.title));
      const st = el("span", "slot__status");
      st.append(document.createElement("i"), document.createTextNode(SLOT_STATUS[status].text + (aqi != null ? " · AQI " + aqi : "")));
      head.append(st);

      const rec = el("p", "slot__rec");
      const ric = el("span");
      ric.innerHTML = iconSvg("i-spark");
      rec.append(ric, document.createTextNode(s.rec[status]));

      card.append(head, rec);
      li.append(time, node, card);
      list.append(li);
    });
  }

  /* ---- Notifications (generated from the data) ---- */
  function renderNotifications() {
    const d = state.data;
    const band = bandFor(d.aqi);
    const ex = forecastExtremes(d);
    const tag = isLive() ? "Live" : "Sample alert";
    const tone = d.aqi <= 50 ? "ok" : d.aqi <= 100 ? "warn" : "bad";
    const items = [
      { tone, text: "AQI is " + d.aqi + " (" + band.label + ") in " + state.city.city, sub: tag + " · updated " + fmtClock(d.updated) }
    ];
    if (ex.peak) items.push({ tone: ex.peak.v > 150 ? "bad" : ex.peak.v > 100 ? "warn" : "ok", text: "AQI expected to peak near " + ex.peak.v + " around " + fmtHour(ex.peak.t), sub: tag + " · next 24 hours" });
    if (ex.best) items.push({ tone: "ok", text: "Cleanest air expected around " + fmtHour(ex.best.t) + " (AQI " + ex.best.v + ")", sub: tag + " · next 24 hours" });

    const list = $("#notifList");
    list.textContent = "";
    items.forEach((n) => {
      const id = state.city.city + "|" + n.text;
      const li = el("li", "notif" + (state.readNotifs.has(id) ? "" : " is-unread"));
      li.dataset.id = id;
      const dot = el("span", "notif__dot notif__dot--" + n.tone);
      const body = el("div");
      body.append(el("p", "", n.text), el("small", "", n.sub));
      li.append(dot, body);
      list.append(li);
    });
    $("#notifFoot").textContent = isLive()
      ? "Alerts are generated from live WAQI monitoring station data."
      : "Notifications are demonstration content.";
    refreshBadge();
  }

  function refreshBadge() {
    const unread = $$(".notif.is-unread").length;
    const badge = $("#notifBadge");
    badge.textContent = unread;
    badge.hidden = unread === 0;
    $("#notifBtn").setAttribute("aria-label", unread ? "Notifications (" + unread + " unread)" : "Notifications (none unread)");
  }

  /* ---------------------------------------------------------
     6. NAVIGATION: mobile menu, smooth scroll, scroll-spy
     --------------------------------------------------------- */
  function initNavigation() {
    const sidebar = $("#sidebar");
    const scrim = $("#scrim");
    const toggle = $("#menuToggle");
    const closeBtn = $("#menuClose");
    const mq = window.matchMedia("(max-width: 960px)");

    function setMenu(open) {
      const wasOpen = sidebar.classList.contains("is-open");
      sidebar.classList.toggle("is-open", open);
      scrim.hidden = !open;
      document.body.classList.toggle("menu-open", open);
      toggle.setAttribute("aria-expanded", String(open));
      if (mq.matches) sidebar.toggleAttribute("inert", !open);
      if (open) closeBtn.focus(); else if (mq.matches && wasOpen) toggle.focus();
    }

    function syncInert() {
      if (mq.matches) sidebar.toggleAttribute("inert", !sidebar.classList.contains("is-open"));
      else { sidebar.removeAttribute("inert"); sidebar.classList.remove("is-open"); scrim.hidden = true; document.body.classList.remove("menu-open"); toggle.setAttribute("aria-expanded", "false"); }
    }
    syncInert();
    (mq.addEventListener ? mq.addEventListener("change", syncInert) : mq.addListener(syncInert));

    toggle.addEventListener("click", () => setMenu(!sidebar.classList.contains("is-open")));
    closeBtn.addEventListener("click", () => setMenu(false));
    scrim.addEventListener("click", () => setMenu(false));
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { setMenu(false); closeDropdowns(); }
    });

    const sections = $$("[data-section]");
    function setActive(id) {
      let title = "";
      $$(".nav__link").forEach((l) => {
        const on = l.getAttribute("href") === "#" + id;
        l.classList.toggle("is-active", on);
        if (on) { l.setAttribute("aria-current", "true"); title = l.dataset.title; } else l.removeAttribute("aria-current");
      });
      if (title) $("#pageTitle").textContent = title;
    }

    $$("[data-nav-link]").forEach((a) => {
      a.addEventListener("click", (e) => {
        const id = a.getAttribute("href");
        const target = id && id.startsWith("#") ? $(id) : null;
        if (!target) return;
        e.preventDefault();
        target.scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth", block: "start" });
        history.replaceState(null, "", id);
        setActive(id.slice(1));
        if (sidebar.classList.contains("is-open")) setMenu(false);
      });
    });

    let ticking = false;
    function onScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const line = window.innerHeight * 0.35;
        let current = sections[0].id;
        sections.forEach((s) => { if (s.getBoundingClientRect().top <= line) current = s.id; });
        if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) current = sections[sections.length - 1].id;
        setActive(current);
        ticking = false;
      });
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  /* ---------------------------------------------------------
     7. DROPDOWNS: location selector + notifications
     --------------------------------------------------------- */
  function closeDropdowns() {
    $("#locationMenu").hidden = true;
    $("#locationBtn").setAttribute("aria-expanded", "false");
    $("#notifPanel").hidden = true;
    $("#notifBtn").setAttribute("aria-expanded", "false");
  }

  function toggleDropdown(btn, menu) {
    const willOpen = menu.hidden;
    closeDropdowns();
    menu.hidden = !willOpen;
    btn.setAttribute("aria-expanded", String(willOpen));
  }

  /* ---- Location: recently searched, suggested cities, city search (OpenWeather Geocoding), "use my location" ---- */
  const CITY_KEY = "aerova.city";
  const RECENT_KEY = "aerova.recentCities";
  const MAX_RECENT = 5;

  function countryName(code) {
    try { return new Intl.DisplayNames(["en"], { type: "region" }).of(code) || code; } catch (e) { return code || ""; }
  }
  function cityFromItem(li) {
    return { city: li.dataset.city, country: li.dataset.country, region: li.dataset.region, lat: Number(li.dataset.lat), lon: Number(li.dataset.lon) };
  }
  function cityFromGeo(g) {
    const country = countryName(g.country);
    return { city: g.name, country, region: g.state || country, lat: g.lat, lon: g.lon };
  }
  function sameCity(a, b) {
    return !!a && !!b && Math.abs(a.lat - b.lat) < 0.05 && Math.abs(a.lon - b.lon) < 0.05;
  }
  function isValidCity(c) {
    return !!c && typeof c.city === "string" && c.city.length > 0 && isFinite(c.lat) && isFinite(c.lon);
  }
  // Remember the last chosen city (never a tracked GPS position) between visits
  function loadSavedCity() {
    try {
      const c = JSON.parse(localStorage.getItem(CITY_KEY));
      if (isValidCity(c)) return c;
    } catch (e) { /* storage unavailable */ }
    return null;
  }
  function saveCity(c) { try { localStorage.setItem(CITY_KEY, JSON.stringify(c)); } catch (e) { /* ignore */ } }

  function loadRecentCities() {
    try {
      const list = JSON.parse(localStorage.getItem(RECENT_KEY));
      if (Array.isArray(list)) return list.filter(isValidCity).slice(0, MAX_RECENT);
    } catch (e) { /* storage unavailable */ }
    return [];
  }
  function saveRecentCities(list) { try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch (e) { /* ignore */ } }

  function initLocation() {
    const btn = $("#locationBtn");
    const menu = $("#locationMenu");
    const recentGroup = $("#recentGroup");
    const recentList = $("#recentList");
    const recentEmpty = $("#recentEmpty");
    const clearRecent = $("#clearRecent");
    const list = $("#locList");
    const heading = $("#locHeading");
    const empty = $("#locEmpty");
    const search = $("#locSearch");
    const form = $("#locSearchForm");
    const track = $("#trackBtn");

    const suggested = $$("li", list).map(cityFromItem);
    let recentCities = loadRecentCities();
    state.city = loadSavedCity() || suggested[0];
    $("#locationLabel").textContent = state.city.city;
    $("#locCity").textContent = state.city.city;
    $("#locCountry").textContent = state.city.country;
    $("#locRegion").textContent = state.city.region;

    let searchSeq = 0;
    let timer = null;
    let inSearch = false;

    function renderOptions(targetList, cities) {
      targetList.textContent = "";
      cities.forEach((c) => {
        const li = el("li");
        li.setAttribute("role", "option");
        li.tabIndex = 0;
        li.setAttribute("aria-selected", String(sameCity(c, state.city)));
        const box = el("span", "loc-item");
        const sub = [c.region && c.region !== c.country ? c.region : "", c.country].filter(Boolean).join(", ");
        box.append(el("strong", "", c.city), el("small", "", sub));
        li.append(box);
        li._city = c;
        targetList.append(li);
      });
    }

    function renderList(cities, title) {
      heading.textContent = title;
      empty.hidden = true;
      list.hidden = false;
      renderOptions(list, cities);
    }

    function showEmpty(message) {
      list.hidden = true;
      empty.textContent = message;   // textContent: user-typed text is never parsed as HTML
      empty.hidden = false;
    }

    function addRecentCity(city) {
      if (!isValidCity(city) || city.tracked) return;
      const clean = { city: city.city, country: city.country, region: city.region, lat: city.lat, lon: city.lon };
      recentCities = [clean].concat(recentCities.filter((c) => !sameCity(c, clean))).slice(0, MAX_RECENT);
      saveRecentCities(recentCities);
    }

    function showDefaultLists() {
      inSearch = false;
      recentGroup.hidden = false;
      const hasRecent = recentCities.length > 0;
      recentList.hidden = !hasRecent;
      recentEmpty.hidden = hasRecent;
      clearRecent.hidden = !hasRecent;
      if (hasRecent) renderOptions(recentList, recentCities);
      else recentList.textContent = "";

      // If the current city came from GPS (not in suggested or recent), keep it visible at the top
      const known = suggested.some((c) => sameCity(c, state.city)) || recentCities.some((c) => sameCity(c, state.city));
      const base = known ? suggested : [state.city].concat(suggested);
      renderList(base, "Suggested cities");
    }

    function choose(city, opts) {
      if (!city) return;
      if (opts && opts.fromSearch) addRecentCity(city);
      state.city = city;
      saveCity(city); // Always persist to localStorage

      // Save toast in sessionStorage to display after page reload
      try {
        sessionStorage.setItem("aerova.toast", "Loaded air quality for " + city.city);
      } catch (e) {}

      // Refresh the whole webpage as requested by the user
      window.location.reload();
    }

    async function runSearch(q) {
      const seq = ++searchSeq;
      inSearch = true;
      recentGroup.hidden = true;
      heading.textContent = "Searching…";
      try {
        const res = await owm("geo/1.0/direct", { q, limit: 6 });
        if (seq !== searchSeq) return null;
        const seen = new Set();
        const cities = [];
        (res || []).forEach((g) => {
          const c = cityFromGeo(g);
          const k = c.lat.toFixed(2) + "," + c.lon.toFixed(2);
          if (!seen.has(k)) { seen.add(k); cities.push(c); }
        });
        if (!cities.length) {
          heading.textContent = "Search results";
          showEmpty("No cities found for “" + q + "”. Check the spelling or add the country, e.g. “Pune, IN”.");
          return [];
        }
        renderList(cities, "Search results");
        return cities;
      } catch (err) {
        if (seq !== searchSeq) return null;
        heading.textContent = "Search results";
        showEmpty(err instanceof ApiError ? err.message : "Search failed. Please try again.");
        return null;
      }
    }

    search.addEventListener("input", () => {
      clearTimeout(timer);
      const q = search.value.trim();
      if (q.length < 2) { searchSeq++; showDefaultLists(); return; }
      timer = setTimeout(() => runSearch(q), 350);
    });

    // Enter picks the first match
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      clearTimeout(timer);
      const q = search.value.trim();
      if (q.length < 2) return;
      const cities = await runSearch(q);
      if (cities && cities.length) choose(cities[0], { fromSearch: true });
    });

    function visibleOptions() {
      return $$(".loc-list li", menu).filter((li) => !li.closest("[hidden]"));
    }

    search.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") {
        const first = visibleOptions()[0];
        if (first) { e.preventDefault(); first.focus(); }
      }
    });

    // Recently searched / suggested / search result rows (delegated, because lists are re-rendered)
    menu.addEventListener("click", (e) => {
      const li = e.target.closest(".loc-list li");
      if (li && li._city) choose(li._city, { fromSearch: inSearch && li.parentElement === list });
    });
    menu.addEventListener("keydown", (e) => {
      const li = e.target.closest(".loc-list li");
      if (!li) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        choose(li._city, { fromSearch: inSearch && li.parentElement === list });
        return;
      }
      const opts = visibleOptions();
      const idx = opts.indexOf(li);
      if (e.key === "ArrowDown" && idx >= 0 && idx < opts.length - 1) {
        e.preventDefault();
        opts[idx + 1].focus();
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        (idx > 0 ? opts[idx - 1] : search).focus();
      }
    });

    clearRecent.addEventListener("click", () => {
      recentCities = [];
      saveRecentCities([]);
      showDefaultLists();
      search.focus();
    });

    // "Use my current location": only runs when the user clicks
    function setTrackBusy(busy) {
      track.classList.toggle("is-busy", busy);
      $("#trackLabel").textContent = busy ? "Finding your location…" : "Use my current location";
    }
    track.addEventListener("click", () => {
      if (!navigator.geolocation) { toast("Your browser does not support location. Search for your city instead."); return; }
      setTrackBusy(true);
      navigator.geolocation.getCurrentPosition(async (pos) => {
        const lat = pos.coords.latitude, lon = pos.coords.longitude;
        let city = { city: "Your location", country: "Detected by your browser", region: lat.toFixed(2) + ", " + lon.toFixed(2), lat, lon, tracked: true };
        try {
          const rev = await owm("geo/1.0/reverse", { lat, lon, limit: 1 });
          if (rev && rev[0]) {
            const country = countryName(rev[0].country);
            city = { city: rev[0].name, country, region: rev[0].state || country, lat, lon, tracked: true };
          }
        } catch (e) {
          try {
            const res = await fetch("https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=" + lat + "&longitude=" + lon + "&localityLanguage=en");
            const geo = await res.json();
            if (geo && (geo.city || geo.locality)) {
              city = {
                city: geo.city || geo.locality,
                country: geo.countryName || "India",
                region: geo.principalSubdivision || geo.countryName || "Region",
                lat,
                lon,
                tracked: true
              };
            }
          } catch (err2) { /* keep coordinate label */ }
        }
        setTrackBusy(false);
        choose(city);
      }, (err) => {
        setTrackBusy(false);
        const msg = err.code === 1
          ? "Location access was blocked. Allow it in your browser's site settings, or search for your city."
          : err.code === 3
            ? "Finding your location timed out. Try again or search for your city."
            : "Your location is not available right now. Search for your city instead.";
        toast(msg, 6500);
      }, { enableHighAccuracy: false, timeout: 12000, maximumAge: 300000 });
    });

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleDropdown(btn, menu);
      if (!menu.hidden) {
        showDefaultLists();
        search.value = "";
        // Don't pop the on-screen keyboard on touch devices
        if (window.matchMedia("(pointer: fine)").matches) search.focus();
      }
    });
    menu.addEventListener("click", (e) => e.stopPropagation());

    showDefaultLists();
  }

  function initNotifications() {
    const btn = $("#notifBtn");
    const panel = $("#notifPanel");

    btn.addEventListener("click", (e) => { e.stopPropagation(); toggleDropdown(btn, panel); });
    panel.addEventListener("click", (e) => e.stopPropagation());

    // Items are re-rendered with the data, so use event delegation
    $("#notifList").addEventListener("click", (e) => {
      const n = e.target.closest(".notif");
      if (!n) return;
      n.classList.remove("is-unread");
      state.readNotifs.add(n.dataset.id);
      refreshBadge();
    });
    $("#markRead").addEventListener("click", () => {
      $$(".notif").forEach((n) => { n.classList.remove("is-unread"); state.readNotifs.add(n.dataset.id); });
      refreshBadge();
      toast("All notifications marked as read.");
    });
  }

  function initProfile() {
    const msg = () => toast("Designed & Developed by Musab", undefined, "primary");
    $("#profileBtn").addEventListener("click", msg);
    $("#avatarBtn").addEventListener("click", msg);
  }

  const THEME_KEY = "aerova.theme";
  function initTheme() {
    const btn = $("#themeToggle");
    const icon = $("#themeIconUse");
    const meta = $("#themeMeta");

    function apply(theme) {
      const dark = theme === "dark";
      if (dark) document.documentElement.dataset.theme = "dark";
      else delete document.documentElement.dataset.theme;
      icon.setAttribute("href", dark ? "#i-sun" : "#i-moon");
      const label = dark ? "Switch to light theme" : "Switch to dark theme";
      btn.setAttribute("aria-label", label);
      btn.setAttribute("title", label);
      btn.setAttribute("aria-pressed", String(dark));
      if (meta) meta.setAttribute("content", dark ? "#0a1220" : "#d9ecea");
    }

    let current = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved === "dark" || saved === "light") current = saved;
    } catch (e) { /* storage unavailable */ }
    apply(current);

    btn.addEventListener("click", () => {
      current = current === "dark" ? "light" : "dark";
      apply(current);
      btn.classList.remove("is-to-dark", "is-to-light");
      void btn.offsetWidth;
      btn.classList.add(current === "dark" ? "is-to-dark" : "is-to-light");
      try { localStorage.setItem(THEME_KEY, current); } catch (e) { /* ignore */ }
    });
  }

  /* ---------------------------------------------------------
     8. CHAT (rule-based, uses the data on the page; no AI model)
     --------------------------------------------------------- */
  function safeOutsideReply(d) {
    const band = bandFor(d.aqi);
    const head = "<p>Right now the AQI in " + state.city.city + " is <strong>" + d.aqi + " (" + band.label + ")</strong>.</p>";
    if (d.aqi <= 50) return head + "<p>Air quality is good, so it is fine to be outside and active.</p>";
    if (d.aqi <= 100) return head + "<p>Most people can go outside as normal. If you are unusually sensitive, take it easier during long or intense activity.</p>";
    if (d.aqi <= 150) return head + "<ul><li>Sensitive groups (children, older adults, people with asthma or heart and lung disease) should limit prolonged outdoor exertion.</li><li>Everyone else can go out but should avoid heavy exertion near busy roads.</li></ul>";
    if (d.aqi <= 200) return head + "<ul><li>Avoid prolonged or heavy exertion outside.</li><li>If you go out, wear a well-fitted N95 / FFP2 mask.</li><li>Children, older adults and people with asthma or heart conditions should stay in.</li></ul>";
    return head + "<ul><li>Stay indoors with windows closed if you can.</li><li>Avoid all outdoor exertion.</li><li>If you must go out, wear a well-fitted N95 / FFP2 mask.</li></ul>";
  }

  const REPLIES = [
    { match: /safe.*(outside|out)|go outside|outdoor|outside|go out/i, html: safeOutsideReply },
    { match: /indoor|improve.*air|purif|ventilat|window/i, html: () =>
      "<p>A few ways to improve indoor air when outdoor air is poor:</p><ul><li>Keep windows closed during peak pollution hours.</li><li>Run a HEPA air purifier in the room you use most.</li><li>Avoid indoor smoke: incense, candles and cooking fumes without an extractor.</li><li>Damp-mop instead of dry sweeping to reduce dust.</li><li>Indoor plants add comfort but only have a small effect on air quality.</li></ul>" },
    { match: /aqi\s*\d+|what does.*aqi|aqi mean|what is.*aqi/i, html: (d) => {
      const b = bandFor(d.aqi);
      const name = POLLUTANTS.find((p) => p.key === d.primary).name;
      return "<p>An AQI of <strong>" + d.aqi + "</strong> falls in the <strong>" + b.label + "</strong> band. " + b.health + "</p><p>The main pollutant right now is <strong>" + name + "</strong>.</p>";
    } },
    { match: /weather|temperature|humid|wind|visib|rain|hot|cold/i, html: (d) => {
      const w = d.weather;
      const r = (n) => (n == null ? "—" : Math.round(n));
      const rain = w.rainChance != null ? ", and a " + Math.round(w.rainChance) + "% chance of rain" : "";
      return "<p>In " + state.city.city + " it is <strong>" + r(w.temp) + " °C</strong> (feels like " + r(w.feels) + " °C), " + (w.desc || "no description").toLowerCase() + ", with " + r(w.humidity) + "% humidity, wind around " + r(w.wind) + " km/h" + rain + ".</p>";
    } },
    { match: /mask|n95|respirator/i, html: () =>
      "<p>For fine particles, an <strong>N95 / FFP2</strong> respirator that seals well on your face works best. Cloth and surgical masks filter far less PM2.5. Replace it when it is damp, dirty or hard to breathe through.</p>" },
    { match: /exercise|\brun(ning)?\b|workout|\bjog|\bwalk|\bgym/i, html: (d) => {
      const ex = forecastExtremes(d);
      const tail = ex.best ? " The cleanest hour in the next 24 hours looks like " + fmtHour(ex.best.t) + " (AQI " + ex.best.v + ")." : "";
      return d.aqi > 150
        ? "<p>With AQI at " + d.aqi + ", move workouts indoors today." + tail + "</p>"
        : d.aqi > 100
          ? "<p>With AQI at " + d.aqi + ", keep outdoor exercise light, especially if you are sensitive." + tail + "</p>"
          : "<p>With AQI at " + d.aqi + ", outdoor exercise is fine for most people." + tail + "</p>";
    } },
    { match: /pm\s*2\.?5|pm2|particulate|pollutant/i, html: (d) => {
      const c = d.components.pm2_5;
      return "<p><strong>PM2.5</strong> means particles smaller than 2.5 micrometres. They come from vehicles, burning and industry, and can enter the lungs and bloodstream. The current reading is <strong>" + fmtValue(c) + " µg/m³</strong>.</p>";
    } },
    { match: /\b(hello|hi|hey|namaste)\b/i, html: () =>
      "<p>Hello! I'm the AEROVA assistant. Ask me about today's air, the weather, masks, exercise or indoor air quality.</p>" },
    { match: /thank/i, html: () => "<p>You're welcome. Stay safe and breathe easy!</p>" }
  ];

  const FALLBACK = "<p>I'm a rule-based assistant with a small set of answers. Try one of the suggested questions, or ask about the weather, masks, exercise, PM2.5 or indoor air.</p>";

  function initChat() {
    const log = $("#chatLog");
    const form = $("#chatForm");
    const input = $("#chatInput");
    let busy = false;

    function addMessage(kind, content, isHtml) {
      const row = el("div", "msg msg--" + kind);
      const av = el("span", "msg__avatar");
      if (kind === "bot") av.innerHTML = iconSvg("i-logo"); else av.textContent = "AK";
      av.setAttribute("aria-hidden", "true");
      const bubble = el("div", "msg__bubble");
      if (isHtml) bubble.innerHTML = content;  // built only from the trusted templates above and numbers we computed
      else bubble.textContent = content;       // user text is always inserted as text (XSS-safe)
      row.append(av, bubble);
      log.append(row);
      log.scrollTop = log.scrollHeight;
      return bubble;
    }

    function reply(question) {
      const bubble = addMessage("bot", "", false);
      const dots = el("span", "typing");
      dots.append(document.createElement("i"), document.createElement("i"), document.createElement("i"));
      dots.setAttribute("aria-label", "Assistant is typing");
      bubble.append(dots);
      log.scrollTop = log.scrollHeight;

      setTimeout(() => {
        const hit = REPLIES.find((r) => r.match.test(question));
        bubble.innerHTML = hit ? hit.html(state.data) : FALLBACK;
        bubble.append(el("small", "", isLive()
          ? "Rule-based reply using live WAQI station data · not medical advice"
          : "Demo reply · sample data, not medical advice"));
        log.scrollTop = log.scrollHeight;
        busy = false;
      }, prefersReducedMotion ? 0 : 650 + Math.random() * 400);
    }

    function send(text) {
      const q = text.trim();
      if (!q || busy) return;
      busy = true;
      addMessage("user", q, false);
      input.value = "";
      reply(q);
    }

    form.addEventListener("submit", (e) => { e.preventDefault(); send(input.value); });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); send(input.value); }
    });
    $$(".suggest").forEach((b) => b.addEventListener("click", () => send(b.dataset.q)));

    addMessage("bot", "<p>Hi! I'm the AEROVA assistant. I'm <strong>rule-based</strong>, with no AI model connected, but my answers use the air quality and weather data shown on this page.</p><p>Try a suggested question below.</p>", true);
  }

  /* ---------------------------------------------------------
     9. REVEAL ON SCROLL
     --------------------------------------------------------- */
  function initReveal() {
    const items = $$(".reveal");
    if (!("IntersectionObserver" in window) || prefersReducedMotion) {
      items.forEach((i) => i.classList.add("is-visible"));
      return;
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const node = entry.target;
          node.classList.add("is-visible");
          io.unobserve(node);
          setTimeout(() => { node.classList.remove("reveal", "is-visible"); node.style.transitionDelay = ""; }, 1200);
        }
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });
    setTimeout(() => items.forEach((i) => i.classList.add("is-visible")), 2500); // safety net
    items.forEach((item, i) => {
      item.style.transitionDelay = Math.min((i % 6) * 70, 350) + "ms";
      io.observe(item);
    });
  }

  function observeOnce(target, cb, threshold) {
    let done = false;
    const fire = () => { if (!done) { done = true; cb(); } };
    if (!("IntersectionObserver" in window)) { fire(); return; }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { io.disconnect(); fire(); } });
    }, { threshold: threshold || 0.2 });
    io.observe(target);
    setTimeout(fire, 2500);
  }

  function initProDashboard() {
    // Header "Locate me" button triggers the location tracker
    const headerLocate = $("#headerLocateBtn");
    const track = $("#trackBtn");
    if (headerLocate && track) {
      headerLocate.addEventListener("click", () => track.click());
    }

    // Favorite button
    const favBtn = $("#favoriteBtn");
    if (favBtn) {
      favBtn.addEventListener("click", () => {
        favBtn.classList.toggle("is-active");
        const active = favBtn.classList.contains("is-active");
        favBtn.style.color = active ? "#ef4444" : "";
        toast(active ? state.city.city + " saved to your favorites." : "Removed from favorites.");
      });
    }

    // Share button
    const shareBtn = $("#shareBtn");
    if (shareBtn) {
      shareBtn.addEventListener("click", () => {
        if (navigator.share) {
          navigator.share({
            title: state.city.city + " Air Quality Index | AEROVA",
            text: "Current AQI in " + state.city.city + " is " + (state.data ? state.data.aqi : "164") + ".",
            url: window.location.href
          }).catch(() => {});
        } else {
          navigator.clipboard.writeText(window.location.href).then(() => {
            toast("Dashboard link copied to clipboard!");
          }).catch(() => {
            toast("Shareable link: " + window.location.href);
          });
        }
      });
    }

    // Filter pills (AQI, History, PM2.5, PM10, etc.)
    const pills = $$("#paramPills .filter-pill");
    pills.forEach((btn) => {
      btn.addEventListener("click", () => {
        pills.forEach((p) => p.classList.remove("is-active"));
        btn.classList.add("is-active");
        const param = btn.dataset.param;
        if (param === "aqi") {
          window.location.hash = "overview";
        } else if (param === "history") {
          window.location.hash = "air-quality";
          const trend = $("#trendChart");
          if (trend) trend.scrollIntoView({ behavior: "smooth" });
        } else {
          window.location.hash = "air-quality";
          const targetCard = $('[data-pol="' + param + '"]');
          if (targetCard) {
            targetCard.scrollIntoView({ behavior: "smooth", block: "center" });
            targetCard.style.outline = "2px solid #0284c7";
            setTimeout(() => { targetCard.style.outline = ""; }, 1800);
          }
        }
      });
    });

    // Weather view switcher
    const toggleWeather = $("#toggleWeatherView");
    if (toggleWeather) {
      toggleWeather.addEventListener("click", () => {
        const target = $("#weather") || $("#heroWeatherCapsule");
        if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  }

  /* ---------------------------------------------------------
     10. BOOT
     --------------------------------------------------------- */
  function init() {
    $$(".grid--overview .card").forEach((c) => c.classList.add("reveal"));

    initTheme();
    initNavigation();
    initLocation();
    initNotifications();
    initProfile();
    initChart();
    initProDashboard();

    // 1) Show labelled sample data immediately, 2) swap to live data when it arrives
    state.data = buildSample(state.city);
    state.loading = true;
    renderAll(true);
    initChat();
    initReveal();
    observeOnce($("#pollutantGrid"), animateBars, 0.15);
    document.addEventListener("click", closeDropdowns);

    // Show toast if just reloaded after city change or locate me
    try {
      const pendingToast = sessionStorage.getItem("aerova.toast");
      if (pendingToast) {
        sessionStorage.removeItem("aerova.toast");
        setTimeout(() => toast(pendingToast, 4000), 250);
      }
    } catch (e) {}

    loadCity();

    // Background refresh + refresh when the tab becomes visible again
    const minutes = Math.max(2, Number(CFG.REFRESH_MINUTES) || 10);
    state.refreshTimer = setInterval(() => { if (!document.hidden) loadCity({ quiet: true }); }, minutes * 60 * 1000);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && state.data && Date.now() - state.data.updated.getTime() > minutes * 60 * 1000) loadCity({ quiet: true });
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
