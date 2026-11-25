"use strict";

/**
 * Vercel Serverless Function: /api/weather
 * Zero-dependency proxy for OpenWeather APIs using process.env.OPENWEATHER_API_KEY.
 */

const OWM_DATA_BASE = "https://api.openweathermap.org/data/2.5/";
const OWM_GEO_BASE = "https://api.openweathermap.org/geo/1.0/";
const REQUEST_TIMEOUT_MS = 10000;

const ENDPOINTS = {
  weather: { url: OWM_DATA_BASE + "weather", kind: "weather" },
  forecast: { url: OWM_DATA_BASE + "forecast", kind: "weather" },
  air_pollution: { url: OWM_DATA_BASE + "air_pollution", kind: "air" },
  "air_pollution/history": { url: OWM_DATA_BASE + "air_pollution/history", kind: "air_history" },
  "air_pollution/forecast": { url: OWM_DATA_BASE + "air_pollution/forecast", kind: "air" },
  "geo/1.0/direct": { url: OWM_GEO_BASE + "direct", kind: "geo_direct" },
  "geo/1.0/reverse": { url: OWM_GEO_BASE + "reverse", kind: "geo_reverse" }
};

const ALLOWED_UNITS = new Set(["standard", "metric", "imperial"]);

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

function parseCoords(query) {
  if (query.lat == null || query.lon == null || query.lat === "" || query.lon === "") return null;
  const lat = Number(query.lat);
  const lon = Number(query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return { error: "Invalid lat or lon parameter." };
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return { error: "Coordinates out of range." };
  return { lat, lon };
}

function parseIntInRange(raw, min, max) {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) return NaN;
  return n;
}

async function fetchOwm(endpointUrl, params, apiKey) {
  const url = new URL(endpointUrl);
  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== "") url.searchParams.set(key, String(value));
  }
  url.searchParams.set("appid", apiKey);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, { signal: controller.signal });
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

async function resolveCityCoords(city, apiKey) {
  const geo = await fetchOwm(ENDPOINTS["geo/1.0/direct"].url, { q: city, limit: 1 }, apiKey);
  if (!geo.ok) return { errorStatus: geo.status, error: (geo.data && geo.data.message) || "Geocoding lookup failed." };
  if (!Array.isArray(geo.data) || geo.data.length === 0) {
    return { errorStatus: 404, error: "City not found." };
  }
  return { lat: geo.data[0].lat, lon: geo.data[0].lon };
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

  const apiKey = process.env.OPENWEATHER_API_KEY;
  if (!apiKey) {
    sendJson(res, 500, { error: "Server configuration error: OPENWEATHER_API_KEY is missing." });
    return;
  }

  const query = getQueryParams(req);
  const endpointKey = String(query.type || query.endpoint || "weather").trim();
  const target = ENDPOINTS[endpointKey];

  if (!target) {
    sendJson(res, 400, {
      error: "Unsupported endpoint. Allowed values: " + Object.keys(ENDPOINTS).join(", ")
    });
    return;
  }

  const city = typeof (query.city ?? query.q) === "string" ? (query.city ?? query.q).trim() : "";
  const coords = parseCoords(query);
  if (coords && coords.error) {
    sendJson(res, 400, { error: coords.error });
    return;
  }

  const owmParams = {};

  try {
    if (target.kind === "geo_direct") {
      if (!city) {
        sendJson(res, 400, { error: "Query parameter 'q' or 'city' is required for direct geocoding." });
        return;
      }
      const limit = parseIntInRange(query.limit, 1, 10);
      if (Number.isNaN(limit)) {
        sendJson(res, 400, { error: "Parameter 'limit' must be an integer between 1 and 10." });
        return;
      }
      owmParams.q = city;
      owmParams.limit = limit || 6;
    } else if (target.kind === "geo_reverse") {
      if (!coords) {
        sendJson(res, 400, { error: "Query parameters 'lat' and 'lon' are required for reverse geocoding." });
        return;
      }
      const limit = parseIntInRange(query.limit, 1, 10);
      if (Number.isNaN(limit)) {
        sendJson(res, 400, { error: "Parameter 'limit' must be an integer between 1 and 10." });
        return;
      }
      owmParams.lat = coords.lat;
      owmParams.lon = coords.lon;
      owmParams.limit = limit || 1;
    } else if (target.kind === "weather") {
      if (coords) {
        owmParams.lat = coords.lat;
        owmParams.lon = coords.lon;
      } else if (city) {
        owmParams.q = city;
      } else {
        sendJson(res, 400, { error: "Provide either 'city'/'q' or both 'lat' and 'lon'." });
        return;
      }

      const units = query.units ? String(query.units).trim() : "metric";
      if (!ALLOWED_UNITS.has(units)) {
        sendJson(res, 400, { error: "Invalid 'units'. Allowed values: standard, metric, imperial." });
        return;
      }
      owmParams.units = units;

      if (endpointKey === "forecast") {
        const cnt = parseIntInRange(query.cnt, 1, 40);
        if (Number.isNaN(cnt)) {
          sendJson(res, 400, { error: "Parameter 'cnt' must be an integer between 1 and 40." });
          return;
        }
        if (cnt != null) owmParams.cnt = cnt;
      }
    } else {
      // Air pollution endpoints only accept lat/lon; resolve city name automatically if provided.
      if (coords) {
        owmParams.lat = coords.lat;
        owmParams.lon = coords.lon;
      } else if (city) {
        const resolved = await resolveCityCoords(city, apiKey);
        if (resolved.error) {
          sendJson(res, resolved.errorStatus || 502, { error: resolved.error });
          return;
        }
        owmParams.lat = resolved.lat;
        owmParams.lon = resolved.lon;
      } else {
        sendJson(res, 400, { error: "Provide either 'city'/'q' or both 'lat' and 'lon'." });
        return;
      }

      if (target.kind === "air_history") {
        const nowSec = Math.floor(Date.now() / 1000);
        const start = parseIntInRange(query.start, 0, Number.MAX_SAFE_INTEGER);
        const end = parseIntInRange(query.end, 0, Number.MAX_SAFE_INTEGER);
        if (Number.isNaN(start) || Number.isNaN(end)) {
          sendJson(res, 400, { error: "Parameters 'start' and 'end' must be valid Unix timestamps." });
          return;
        }
        owmParams.start = start != null ? start : nowSec - 26 * 3600;
        owmParams.end = end != null ? end : nowSec;
        if (owmParams.start > owmParams.end) {
          sendJson(res, 400, { error: "Parameter 'start' must be less than or equal to 'end'." });
          return;
        }
      }
    }

    const result = await fetchOwm(target.url, owmParams, apiKey);
    if (!result.ok) {
      const message =
        (result.data && result.data.message) ||
        "OpenWeather API returned status " + result.status + ".";
      sendJson(res, result.status, { error: message });
      return;
    }

    sendJson(res, 200, result.data, "s-maxage=300, stale-while-revalidate=60");
  } catch (err) {
    if (err && err.name === "AbortError") {
      sendJson(res, 504, { error: "OpenWeather API request timed out." });
      return;
    }
    sendJson(res, 502, { error: "Unable to reach OpenWeather API." });
  }
};
