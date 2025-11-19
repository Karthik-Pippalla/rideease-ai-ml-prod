const axios = require("axios");

// Debug logging
const DEBUG = process.env.DEBUG === "true" || process.env.NODE_ENV === "development";
const debug = (message, data = null) => {
  if (DEBUG) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] 🛣️ ROUTE DEBUG: ${message}`);
    if (data) console.log(`[${timestamp}] 🛣️ ROUTE DEBUG DATA:`, JSON.stringify(data, null, 2));
  }
};

/**
 * Get driving distance and time between two points using Google Maps Distance Matrix API
 * @param {Object} origin - Origin point with coordinates [lng, lat]
 * @param {Object} destination - Destination point with coordinates [lng, lat]
 * @param {Date} departureTime - Departure time for traffic-aware estimates (optional)
 * @returns {Promise<Object>} Route information with distance, duration, and dropoff time
 */
async function getRouteInfo(origin, destination, departureTime = null) {
  debug("Getting route info", { 
    origin: origin.coordinates, 
    destination: destination.coordinates,
    departureTime: departureTime?.toISOString()
  });

  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) {
    debug("Google Maps API key not set");
    throw new Error("Google Maps API key not configured");
  }

  try {
    const originStr = `${origin.coordinates[1]},${origin.coordinates[0]}`; // lat,lng format for Google
    const destinationStr = `${destination.coordinates[1]},${destination.coordinates[0]}`;
    
    const params = {
      origins: originStr,
      destinations: destinationStr,
      mode: 'driving',
      units: 'imperial', // Get results in miles
      key: key
    };

    // Add departure time for traffic-aware estimates if provided
    if (departureTime && departureTime > new Date()) {
      params.departure_time = Math.floor(departureTime.getTime() / 1000); // Unix timestamp
    }

    const url = 'https://maps.googleapis.com/maps/api/distancematrix/json';
    debug("Making Distance Matrix API request", { params });
    
    const response = await axios.get(url, { params });
    const data = response.data;

    debug("Distance Matrix API response", { 
      status: data.status, 
      rowsCount: data.rows?.length,
      elementsCount: data.rows?.[0]?.elements?.length
    });

    if (data.status !== 'OK') {
      debug("Distance Matrix API error", { status: data.status, error: data.error_message });
      throw new Error(`Distance Matrix API error: ${data.status} - ${data.error_message || 'Unknown error'}`);
    }

    const element = data.rows?.[0]?.elements?.[0];
    if (!element) {
      debug("No route elements found in response");
      throw new Error('No route data found in API response');
    }

    if (element.status !== 'OK') {
      debug("Route element error", { elementStatus: element.status });
      throw new Error(`Route calculation failed: ${element.status}`);
    }

    // Extract distance and duration
    const distanceMeters = element.distance?.value;
    const distanceMiles = element.distance?.text;
    const durationSeconds = element.duration?.value;
    const durationText = element.duration?.text;

    // Use duration_in_traffic if available (when departure_time is provided)
    const trafficDurationSeconds = element.duration_in_traffic?.value || durationSeconds;
    const trafficDurationText = element.duration_in_traffic?.text || durationText;

    if (!distanceMeters || !durationSeconds) {
      debug("Missing distance or duration data", { element });
      throw new Error('Incomplete route data received from API');
    }

    // Calculate dropoff time
    let estimatedDropoffTime = null;
    if (departureTime) {
      estimatedDropoffTime = new Date(departureTime.getTime() + (trafficDurationSeconds * 1000));
    }

    const routeInfo = {
      distance: {
        meters: distanceMeters,
        miles: parseFloat(distanceMiles.replace(/[^\d.]/g, '')), // Extract numeric value
        text: distanceMiles
      },
      duration: {
        seconds: trafficDurationSeconds,
        minutes: Math.ceil(trafficDurationSeconds / 60),
        text: trafficDurationText
      },
      estimatedDropoffTime,
      hasTrafficData: !!element.duration_in_traffic
    };

    debug("Route info calculated successfully", routeInfo);
    return routeInfo;

  } catch (error) {
    debug("Route calculation failed", { error: error.message });
    
    // If Google API fails, fall back to straight-line distance estimate
    if (error.message.includes('API')) {
      debug("Falling back to haversine calculation");
      return getFallbackRouteInfo(origin, destination, departureTime);
    }
    
    throw error;
  }
}

/**
 * Fallback route calculation using straight-line distance
 * @param {Object} origin - Origin point
 * @param {Object} destination - Destination point  
 * @param {Date} departureTime - Departure time
 * @returns {Object} Estimated route info
 */
function getFallbackRouteInfo(origin, destination, departureTime = null) {
  debug("Using fallback route calculation");
  
  // Calculate straight-line distance using haversine formula
  const [lng1, lat1] = origin.coordinates;
  const [lng2, lat2] = destination.coordinates;
  
  const toRad = (x) => (x * Math.PI) / 180;
  const R = 3958.7613; // Earth radius in miles
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLng/2)**2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const straightLineMiles = R * c;
  
  // Estimate driving distance as 1.3x straight-line distance (typical road factor)
  const estimatedDrivingMiles = straightLineMiles * 1.3;
  const estimatedDrivingMeters = estimatedDrivingMiles * 1609.34;
  
  // Estimate driving time assuming average speed of 25 mph in urban areas
  const estimatedDurationSeconds = Math.ceil((estimatedDrivingMiles / 25) * 3600);
  const estimatedDurationMinutes = Math.ceil(estimatedDurationSeconds / 60);
  
  // Calculate dropoff time
  let estimatedDropoffTime = null;
  if (departureTime) {
    estimatedDropoffTime = new Date(departureTime.getTime() + (estimatedDurationSeconds * 1000));
  }

  const fallbackInfo = {
    distance: {
      meters: Math.round(estimatedDrivingMeters),
      miles: Math.round(estimatedDrivingMiles * 100) / 100,
      text: `${Math.round(estimatedDrivingMiles * 100) / 100} mi (estimated)`
    },
    duration: {
      seconds: estimatedDurationSeconds,
      minutes: estimatedDurationMinutes,
      text: `${estimatedDurationMinutes} min (estimated)`
    },
    estimatedDropoffTime,
    hasTrafficData: false,
    isFallback: true
  };

  debug("Fallback route info calculated", fallbackInfo);
  return fallbackInfo;
}

/**
 * Batch calculate routes for multiple origin-destination pairs
 * @param {Array} routes - Array of {origin, destination, departureTime} objects
 * @returns {Promise<Array>} Array of route info objects
 */
async function batchGetRouteInfo(routes) {
  debug("Batch calculating routes", { routeCount: routes.length });
  
  if (!routes || routes.length === 0) {
    return [];
  }

  // Google Distance Matrix API supports up to 25 origins x 25 destinations per request
  // For simplicity, we'll process them individually but could optimize for larger batches
  const results = [];
  
  for (let i = 0; i < routes.length; i++) {
    const route = routes[i];
    try {
      const routeInfo = await getRouteInfo(route.origin, route.destination, route.departureTime);
      results.push({ success: true, data: routeInfo, index: i });
    } catch (error) {
      debug(`Route calculation failed for index ${i}`, { error: error.message });
      results.push({ success: false, error: error.message, index: i });
    }
  }

  debug("Batch route calculation completed", { 
    total: routes.length, 
    successful: results.filter(r => r.success).length,
    failed: results.filter(r => !r.success).length
  });

  return results;
}

module.exports = {
  getRouteInfo,
  batchGetRouteInfo,
  getFallbackRouteInfo
};
