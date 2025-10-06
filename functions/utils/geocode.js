const axios = require("axios");

// Debug logging
const DEBUG = process.env.DEBUG === "true" || process.env.NODE_ENV === "development";
const debug = (message, data = null) => {
  if (DEBUG) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] 🗺️ GEOCODE DEBUG: ${message}`);
    if (data) console.log(`[${timestamp}] 🗺️ GEOCODE DEBUG DATA:`, JSON.stringify(data, null, 2));
  }
};

function toPoint(lng, lat) {
  return { type: "Point", coordinates: [lng, lat] };
}

async function googleGeocode(q) {
  debug("Google geocoding", { query: q });
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) {
    debug("Google API key not set");
    throw new Error("Google API key not set");
  }
  const url = `https://maps.googleapis.com/maps/api/geocode/json`;
  const { data } = await axios.get(url, { params: { address: q, key } });
  debug("Google geocoding response", { status: data.status, resultsCount: data.results?.length });
  if (data.status !== "OK" || !data.results?.length) {
    debug("Google geocoding failed", { status: data.status, error: data.error_message });
    throw new Error("No results");
  }
  const loc = data.results[0].geometry.location;
  const point = toPoint(loc.lng, loc.lat);
  debug("Google geocoding successful", { point });
  return point;
}

async function nominatimGeocode(q) {
  debug("Nominatim geocoding", { query: q });
  const url = `https://nominatim.openstreetmap.org/search`;
  const { data } = await axios.get(url, {
    params: { q, format: "json", limit: 1 },
    headers: { "User-Agent": "RideBot/1.0 (contact@example.com)" },
  });
  debug("Nominatim geocoding response", { resultsCount: Array.isArray(data) ? data.length : 0 });
  if (!Array.isArray(data) || !data.length) {
    debug("Nominatim geocoding failed", { data });
    throw new Error("No results");
  }
  const r = data[0];
  const point = toPoint(Number(r.lon), Number(r.lat));
  debug("Nominatim geocoding successful", { point });
  return point;
}

async function getCoordsFromAddress(address) {
  debug("Getting coordinates from address", { address });
  const q = String(address).trim();
  if (!q) {
    debug("Empty address provided");
    throw new Error("Empty address");
  }
  try {
    debug("Trying Google geocoding first");
    return await googleGeocode(q);
  } catch (e1) {
    debug("Google geocoding failed, trying Nominatim", { error: e1.message });
    try {
      return await nominatimGeocode(q);
    } catch (e2) {
      debug("Both geocoding services failed", { googleError: e1.message, nominatimError: e2.message });
      throw new Error(`Could not find location for "${q}"`);
    }
  }
}

// Alias function to match existing usage in the codebase
async function geocodeAddress(address) {
  debug("Geocoding address (alias)", { address });
  try {
    const point = await getCoordsFromAddress(address);
    // Return in the format expected by existing code
    return {
      lat: point.coordinates[1],
      lon: point.coordinates[0],
      name: address // Use the original address as the name
    };
  } catch (error) {
    debug("Geocoding failed", { error: error.message, address });
    throw error;
  }
}

module.exports = { getCoordsFromAddress, geocodeAddress };
