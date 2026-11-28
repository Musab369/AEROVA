"use strict";

/**
 * Vercel Serverless Function: /api/airquality
 * Proxy for the WAQI (World Air Quality Index) API — aqicn.org
 * Uses real monitoring station data for accurate air quality readings.
 *
 * Supported query params:
 *   type=station   – fetch by lat/lon nearest station (default)
 *   lat, lon       – coordinates (required for type=station)
 *   city           – city keyword search (type=search)
 *   type=search    – search stations by keyword
 *   uid            – fetch by specific station UID
 */

const WAQI_BASE = "https://api.waqi.info/";
const REQUEST_TIMEOUT_MS = 10000;

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

async function fetchWaqi(url, token) {
  const fullUrl = url + (url.includes("?") ? "&" : "?") + "token=" + token;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(fullUrl, { signal: controller.signal });
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (_) {
      data = null;
    }
    return { ok: response.ok, status: response.status, data };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Normalize WAQI station data into a consistent format for the frontend.
 * WAQI response: { status: "ok", data: { aqi, idx, city, iaqi, time, ... } }
 */
function normalizeStation(raw) {
  const d = raw.data;
  if (!d || d === "Unknown station" || d === "Invalid key") return null;

  // iaqi contains individual pollutant readings in their standard units
  const iaqi = d.iaqi || {};

  // Build pollutant components object matching OpenWeather's key names
  const components = {
    pm2_5: iaqi.pm25 ? iaqi.pm25.v : null,
    pm10:  iaqi.pm10  ? iaqi.pm10.v  : null,
    co:    iaqi.co    ? iaqi.co.v    : null,
    no2:   iaqi.no2   ? iaqi.no2.v   : null,
    so2:   iaqi.so2   ? iaqi.so2.v   : null,
    o3:    iaqi.o3    ? iaqi.o3.v    : null,
  };

  // Additional meteorological data from WAQI
  const meteo = {
    temp:     iaqi.t    ? iaqi.t.v    : null,
    humidity: iaqi.h    ? iaqi.h.v    : null,
    pressure: iaqi.p    ? iaqi.p.v    : null,
    wind:     iaqi.w    ? iaqi.w.v    : null,
    dewpoint: iaqi.dew  ? iaqi.dew.v  : null,
  };

  const stationName = (d.city && d.city.name) ? d.city.name : (d.station ? d.station.name : "Unknown Station");
  const stationGeo  = (d.city && d.city.geo)  ? d.city.geo  : null;

  return {
    aqi:         typeof d.aqi === "number" ? d.aqi : null,
    idx:         d.idx,  // station UID — use to fetch specific station later
    stationName,
    stationGeo,
    components,
    meteo,
    dominentpol: d.dominentpol || null,
    time:        d.time ? (d.time.iso || d.time.s || null) : null,
    attributions: Array.isArray(d.attributions) ? d.attributions : [],
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

  const token = process.env.WAQI_API_KEY;
  if (!token) {
    sendJson(res, 500, { error: "Server configuration error: WAQI_API_KEY is missing." });
    return;
  }

  const query = getQueryParams(req);
  const type  = String(query.type || "station").trim();

  try {
    if (type === "station") {
      // Nearest station to given coordinates
      const lat = Number(query.lat);
      const lon = Number(query.lon);

      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        sendJson(res, 400, { error: "Parameters 'lat' and 'lon' are required for type=station." });
        return;
      }

      const url = WAQI_BASE + "feed/geo:" + lat + ";" + lon + "/";
      const result = await fetchWaqi(url, token);

      if (!result.ok) {
        sendJson(res, result.status, { error: "WAQI API error: " + result.status });
        return;
      }

      const raw = result.data;
      if (!raw || raw.status !== "ok") {
        const msg = (raw && raw.data) || "WAQI returned no data for this location.";
        sendJson(res, 502, { error: String(msg) });
        return;
      }

      const normalized = normalizeStation(raw);
      if (!normalized) {
        sendJson(res, 502, { error: "Could not parse WAQI station data." });
        return;
      }

      sendJson(res, 200, { status: "ok", data: normalized }, "s-maxage=300, stale-while-revalidate=60");

    } else if (type === "search") {
      // Search stations by city keyword
      const city = String(query.city || query.q || "").trim();
      if (!city) {
        sendJson(res, 400, { error: "Parameter 'city' or 'q' is required for type=search." });
        return;
      }

      const url = WAQI_BASE + "search/?keyword=" + encodeURIComponent(city);
      const result = await fetchWaqi(url, token);

      if (!result.ok) {
        sendJson(res, result.status, { error: "WAQI search error: " + result.status });
        return;
      }

      const raw = result.data;
      if (!raw || raw.status !== "ok") {
        sendJson(res, 502, { error: "WAQI search returned no results." });
        return;
      }

      sendJson(res, 200, { status: "ok", data: raw.data || [] }, "s-maxage=300, stale-while-revalidate=60");

    } else if (type === "uid") {
      // Fetch a specific station by its UID (idx)
      const uid = String(query.uid || "").trim();
      if (!uid) {
        sendJson(res, 400, { error: "Parameter 'uid' is required for type=uid." });
        return;
      }

      const url = WAQI_BASE + "feed/@" + uid + "/";
      const result = await fetchWaqi(url, token);

      if (!result.ok) {
        sendJson(res, result.status, { error: "WAQI API error: " + result.status });
        return;
      }

      const raw = result.data;
      if (!raw || raw.status !== "ok") {
        sendJson(res, 502, { error: "WAQI returned no data for station UID " + uid });
        return;
      }

      const normalized = normalizeStation(raw);
      if (!normalized) {
        sendJson(res, 502, { error: "Could not parse WAQI station data." });
        return;
      }

      sendJson(res, 200, { status: "ok", data: normalized }, "s-maxage=300, stale-while-revalidate=60");

    } else {
      sendJson(res, 400, { error: "Unsupported type. Allowed values: station, search, uid." });
    }

  } catch (err) {
    if (err && err.name === "AbortError") {
      sendJson(res, 504, { error: "WAQI API request timed out." });
      return;
    }
    sendJson(res, 502, { error: "Unable to reach WAQI API." });
  }
};
