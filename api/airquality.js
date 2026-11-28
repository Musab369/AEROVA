"use strict";

/**
 * Vercel Serverless Function: /api/airquality
 * Multi-provider Air Quality proxy:
 * 1. XKDR India Air Quality API (when key starts with aqi_)
 * 2. WAQI (World Air Quality Index) API (aqicn.org)
 * 3. OpenWeather Air Pollution API fallback
 */

const WAQI_BASE = "https://api.waqi.info/";
const XKDR_BASE = "https://airquality.xkdr.org/v1/";
const OWM_BASE = "https://api.openweathermap.org/data/2.5/";
const REQUEST_TIMEOUT_MS = 10000;

// US EPA AQI breakpoints [conc_low, conc_high, aqi_low, aqi_high]
const EPA_BREAKPOINTS = {
  pm2_5: [[0, 9, 0, 50], [9.1, 35.4, 51, 100], [35.5, 55.4, 101, 150], [55.5, 125.4, 151, 200], [125.5, 225.4, 201, 300], [225.5, 325.4, 301, 500]],
  pm10:  [[0, 54, 0, 50], [55, 154, 51, 100], [155, 254, 101, 150], [255, 354, 151, 200], [355, 424, 201, 300], [425, 604, 301, 500]],
  o3:    [[0, 54, 0, 50], [55, 70, 51, 100], [71, 85, 101, 150], [86, 105, 151, 200], [106, 200, 201, 300]],
  no2:   [[0, 53, 0, 50], [54, 100, 51, 100], [101, 360, 101, 150], [361, 649, 151, 200], [650, 1249, 201, 300], [1250, 2049, 301, 500]],
  so2:   [[0, 35, 0, 50], [36, 75, 51, 100], [76, 185, 101, 150], [186, 304, 151, 200], [305, 604, 201, 300], [605, 1004, 301, 500]],
  co:    [[0, 4.4, 0, 50], [4.5, 9.4, 51, 100], [9.5, 12.4, 101, 150], [12.5, 15.4, 151, 200], [15.5, 30.4, 201, 300], [30.5, 50.4, 301, 500]]
};

const CONVERSIONS = {
  pm2_5: 1,
  pm10: 1,
  o3: 0.509,
  no2: 0.532,
  so2: 0.382,
  co: 0.000873
};

function calcSubIndex(key, ugm3) {
  const bpList = EPA_BREAKPOINTS[key];
  if (!bpList) return 0;
  const c = (ugm3 || 0) * (CONVERSIONS[key] || 1);
  for (const [cl, ch, il, ih] of bpList) {
    if (c <= ch) return Math.max(il, Math.round(((ih - il) / (ch - cl)) * (c - cl) + il));
  }
  return 500;
}

function calcAqi(components) {
  let maxAqi = 0;
  let primary = "pm2_5";
  for (const key of Object.keys(EPA_BREAKPOINTS)) {
    const sub = calcSubIndex(key, components[key]);
    if (sub > maxAqi) {
      maxAqi = sub;
      primary = key;
    }
  }
  return { aqi: maxAqi, primary };
}

function sendJson(res, status, payload, cacheHeader) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", cacheHeader || "no-store");
  res.end(JSON.stringify(payload));
}

function getQueryParams(req) {
  if (req.query && typeof req.query === "object") return req.query;
  const parsed = new URL(req.url || "/", "http://localhost");
  return Object.fromEntries(parsed.searchParams.entries());
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (_) {
      data = null;
    }
    return { ok: res.ok, status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch from XKDR Air Quality API
 */
async function fetchXkdr(token, city) {
  const cleanCity = String(city || "Delhi").trim();
  const url = `${XKDR_BASE}measurements?city=${encodeURIComponent(cleanCity)}&agg=hourly&format=json`;
  const res = await fetchWithTimeout(url, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok || !res.data || !Array.isArray(res.data.data) || res.data.data.length === 0) {
    return null;
  }

  const rows = res.data.data;
  // Group by parameter and take the latest mean reading
  const paramMap = {};
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    const p = (r.parameter_name || "").toUpperCase();
    if (!paramMap[p] && r.mean != null) {
      paramMap[p] = r.mean;
    }
  }

  const components = {
    pm2_5: paramMap["PM2.5"] != null ? paramMap["PM2.5"] : 0,
    pm10:  paramMap["PM10"]  != null ? paramMap["PM10"]  : 0,
    co:    paramMap["CO"]    != null ? paramMap["CO"] * 1000 : 0,
    no2:   paramMap["NO2"]   != null ? paramMap["NO2"] : 0,
    so2:   paramMap["SO2"]   != null ? paramMap["SO2"] : 0,
    o3:    paramMap["OZONE"] != null ? paramMap["OZONE"] : (paramMap["O3"] || 0)
  };

  const { aqi, primary } = calcAqi(components);
  const stationId = rows[rows.length - 1].station_id || "CPCB";

  return {
    aqi: Math.max(15, Math.round(aqi)),
    idx: stationId,
    stationName: `CPCB Monitor · ${cleanCity}`,
    stationGeo: null,
    components,
    meteo: {},
    dominentpol: primary,
    time: rows[rows.length - 1].period_start || new Date().toISOString(),
    attributions: [
      { name: "India Central Pollution Control Board (CPCB) via XKDR", url: "https://airquality.xkdr.org" }
    ]
  };
}

/**
 * Fetch from WAQI (aqicn.org)
 */
async function fetchWaqi(token, lat, lon) {
  const url = `${WAQI_BASE}feed/geo:${lat};${lon}/?token=${token}`;
  const res = await fetchWithTimeout(url);
  if (!res.ok || !res.data || res.data.status !== "ok" || !res.data.data) {
    return null;
  }
  const d = res.data.data;
  if (typeof d !== "object") return null;

  const iaqi = d.iaqi || {};
  const components = {
    pm2_5: iaqi.pm25 ? iaqi.pm25.v : null,
    pm10:  iaqi.pm10  ? iaqi.pm10.v  : null,
    co:    iaqi.co    ? iaqi.co.v    : null,
    no2:   iaqi.no2   ? iaqi.no2.v   : null,
    so2:   iaqi.so2   ? iaqi.so2.v   : null,
    o3:    iaqi.o3    ? iaqi.o3.v    : null,
  };

  const meteo = {
    temp:     iaqi.t    ? iaqi.t.v    : null,
    humidity: iaqi.h    ? iaqi.h.v    : null,
    pressure: iaqi.p    ? iaqi.p.v    : null,
    wind:     iaqi.w    ? iaqi.w.v    : null,
    dewpoint: iaqi.dew  ? iaqi.dew.v  : null,
  };

  const stationName = (d.city && d.city.name) ? d.city.name : (d.station ? d.station.name : "Station");

  return {
    aqi: typeof d.aqi === "number" ? d.aqi : null,
    idx: d.idx,
    stationName,
    stationGeo: (d.city && d.city.geo) ? d.city.geo : [lat, lon],
    components,
    meteo,
    dominentpol: d.dominentpol || "pm2_5",
    time: d.time ? (d.time.iso || d.time.s || null) : null,
    attributions: Array.isArray(d.attributions) ? d.attributions : [{ name: "WAQI", url: "https://waqi.info" }]
  };
}

/**
 * Fetch OpenWeather Air Pollution as a reliable fallback
 */
async function fetchOwmPollution(owmKey, lat, lon, cityName) {
  const url = `${OWM_BASE}air_pollution?lat=${lat}&lon=${lon}&appid=${owmKey}`;
  const res = await fetchWithTimeout(url);
  if (!res.ok || !res.data || !Array.isArray(res.data.list) || res.data.list.length === 0) {
    return null;
  }

  const item = res.data.list[0];
  const comp = item.components || {};

  const components = {
    pm2_5: comp.pm2_5 != null ? comp.pm2_5 : 0,
    pm10:  comp.pm10  != null ? comp.pm10  : 0,
    co:    comp.co    != null ? comp.co    : 0,
    no2:   comp.no2   != null ? comp.no2   : 0,
    so2:   comp.so2   != null ? comp.so2   : 0,
    o3:    comp.o3    != null ? comp.o3    : 0
  };

  const { aqi, primary } = calcAqi(components);

  return {
    aqi: Math.max(10, Math.round(aqi)),
    idx: `owm_${Math.round(lat * 100)}_${Math.round(lon * 100)}`,
    stationName: cityName ? `${cityName} Environmental Area` : "Atmospheric Monitoring Area",
    stationGeo: [lat, lon],
    components,
    meteo: {},
    dominentpol: primary,
    time: new Date(item.dt * 1000).toISOString(),
    attributions: [
      { name: "OpenWeather Air Pollution & US EPA Standards", url: "https://openweathermap.org" }
    ]
  };
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Method not allowed. Use GET." });
    return;
  }

  const token = process.env.WAQI_API_KEY || process.env.AIRQUALITY_API_KEY;
  const owmKey = process.env.OPENWEATHER_API_KEY;

  if (!token && !owmKey) {
    sendJson(res, 500, { error: "Server configuration: No API keys configured (WAQI_API_KEY or OPENWEATHER_API_KEY required)." });
    return;
  }

  const query = getQueryParams(req);
  const lat = Number(query.lat);
  const lon = Number(query.lon);
  const city = String(query.city || query.q || "").trim();

  try {
    let result = null;

    // 1. If key starts with aqi_, it is an XKDR India Air Quality key
    if (token && token.startsWith("aqi_") && city) {
      try {
        result = await fetchXkdr(token, city);
      } catch (_) {
        result = null;
      }
    }

    // 2. Try WAQI station by lat/lon
    if (!result && token && !token.startsWith("aqi_") && Number.isFinite(lat) && Number.isFinite(lon)) {
      try {
        result = await fetchWaqi(token, lat, lon);
      } catch (_) {
        result = null;
      }
    }

    // 3. Fallback to OpenWeather Air Pollution
    if (!result && owmKey && Number.isFinite(lat) && Number.isFinite(lon)) {
      try {
        result = await fetchOwmPollution(owmKey, lat, lon, city);
      } catch (_) {
        result = null;
      }
    }

    // 4. Return result if any provider succeeded
    if (result && result.aqi != null) {
      sendJson(res, 200, { status: "ok", data: result }, "s-maxage=300, stale-while-revalidate=60");
      return;
    }

    // If all providers failed or coordinates missing
    sendJson(res, 200, {
      status: "fallback",
      message: "Live telemetry unavailable from upstream stations. Using calibrated regional estimate.",
      data: null
    });
  } catch (err) {
    sendJson(res, 200, {
      status: "fallback",
      message: "Upstream API timeout or error. Using sample/regional fallback.",
      data: null
    });
  }
};
