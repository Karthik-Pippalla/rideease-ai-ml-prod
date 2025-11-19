const Driver = require("../models/driver");
const Ride = require("../models/ride");
const { getCoordsFromAddress } = require("../utils/geocode");

// Import security middleware from ridesController  
const { requireApiKey } = require("./ridesController");

function milesToMeters(mi) {
  return Number(mi) * 1609.34;
}

function ensureNumber(n, def = 0) {
  const v = Number(n);
  return Number.isFinite(v) ? v : def;
}

// Authentication middleware specific to driver operations
function requireDriverAuth(req, res, next) {
  const requestingTelegramId = req.headers['x-telegram-id'] || req.headers['telegram-id'];
  const targetTelegramId = req.body?.telegramId || req.params?.telegramId;
  
  // Check for API key (internal system access)
  const apiKey = req.headers['x-api-key'];
  const hasValidApiKey = apiKey && apiKey === process.env.INTERNAL_API_KEY;
  
  if (hasValidApiKey) {
    return next(); // Allow internal system calls
  }
  
  if (!requestingTelegramId) {
    return res.status(401).json({ 
      ok: false, 
      error: "Authentication required - missing telegram ID header" 
    });
  }
  
  if (requestingTelegramId !== targetTelegramId) {
    // Log security violation
    console.warn('[SECURITY] Unauthorized driver operation attempt:', {
      timestamp: new Date().toISOString(),
      requestingId: requestingTelegramId,
      targetId: targetTelegramId,
      endpoint: req.originalUrl,
      method: req.method,
      ip: req.ip || req.connection?.remoteAddress
    });
    
    return res.status(403).json({ 
      ok: false, 
      error: "Access denied - can only perform actions on your own account" 
    });
  }
  
  next();
}

// POST /driver/available - Secured with authentication
async function setAvailable(req, res) {
  try {
    const {
      telegramId,
      address,
      radiusMiles,
      hours = 1,
    } = req.body || {};

    const requestingTelegramId = req.headers['x-telegram-id'] || req.headers['telegram-id'];
    
    // Verify authentication (unless internal API call)
    const apiKey = req.headers['x-api-key'];
    const hasValidApiKey = apiKey && apiKey === process.env.INTERNAL_API_KEY;
    
    if (!hasValidApiKey && (!requestingTelegramId || requestingTelegramId !== telegramId)) {
      return res.status(403).json({ 
        ok: false, 
        error: "Access denied - can only set availability for your own account" 
      });
    }

    if (!telegramId) return res.status(400).json({ ok: false, error: "telegramId is required" });
    if (!address) return res.status(400).json({ ok: false, error: "address is required" });
    const radius = ensureNumber(radiusMiles, 0);
    if (!(radius > 0)) return res.status(400).json({ ok: false, error: "radiusMiles must be > 0" });
    const dur = ensureNumber(hours, 0);
    if (!(dur > 0)) return res.status(400).json({ ok: false, error: "hours must be > 0" });

    const driver = await Driver.findOne({ telegramId: String(telegramId) });
    if (!driver) return res.status(404).json({ ok: false, error: "Driver not found" });

    const point = await getCoordsFromAddress(address);
    const endsAt = new Date(Date.now() + dur * 60 * 60 * 1000);

    driver.availability = true;
    driver.availableLocationName = address;
    driver.availableLocation = point; // GeoJSON { type: "Point", coordinates: [lng, lat] }
    driver.myRadiusOfAvailabilityMiles = radius;
    driver.timeTillAvailable = endsAt; // when availability window ends
    await driver.save();

    // find nearby open rides
    const rides = await Ride.find({
      status: "open",
      timeOfRide: { $gte: new Date(Date.now() - 5 * 60 * 1000) },
      pickupLocation: {
        $near: {
          $geometry: point,
          $maxDistance: milesToMeters(Math.min(radius, 100)),
        },
      },
    })
      .sort({ timeOfRide: 1 })
      .limit(20)
      .lean();

    return res.json({ ok: true, driver, nearbyOpenRides: rides, count: rides.length });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}

// POST /driver/availability_off - Secured with authentication
async function availabilityOff(req, res) {
  try {
    const { telegramId } = req.body || {};
    const requestingTelegramId = req.headers['x-telegram-id'] || req.headers['telegram-id'];
    
    // Verify authentication (unless internal API call)
    const apiKey = req.headers['x-api-key'];
    const hasValidApiKey = apiKey && apiKey === process.env.INTERNAL_API_KEY;
    
    if (!hasValidApiKey && (!requestingTelegramId || requestingTelegramId !== telegramId)) {
      return res.status(403).json({ 
        ok: false, 
        error: "Access denied - can only turn off availability for your own account" 
      });
    }
    
    if (!telegramId) return res.status(400).json({ ok: false, error: "telegramId is required" });

    const driver = await Driver.findOne({ telegramId: String(telegramId) });
    if (!driver) return res.status(404).json({ ok: false, error: "Driver not found" });

    driver.availability = false;
    driver.availableLocationName = undefined;
    driver.availableLocation = undefined;
    driver.myRadiusOfAvailabilityMiles = 0;
    driver.timeTillAvailable = undefined;
    await driver.save();

    return res.json({ ok: true, driver, message: "Availability closed" });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}

// GET /driver/nearby-rides/:telegramId - Secured with authentication  
async function nearby(req, res) {
  try {
    const telegramId = String(req.params.telegramId);
    const requestingTelegramId = req.headers['x-telegram-id'] || req.headers['telegram-id'];
    
    // Check for API key (internal system access) OR user authentication
    const apiKey = req.headers['x-api-key'];
    const hasValidApiKey = apiKey && apiKey === process.env.INTERNAL_API_KEY;
    const isOwnData = requestingTelegramId && requestingTelegramId === telegramId;
    
    if (!hasValidApiKey && !isOwnData) {
      // Log security violation
      console.warn('[SECURITY] Unauthorized access attempt to driver nearby rides:', {
        timestamp: new Date().toISOString(),
        requestingId: requestingTelegramId || 'none',
        targetId: telegramId,
        endpoint: 'nearby',
        ip: req.ip || req.connection?.remoteAddress
      });
      
      return res.status(403).json({ 
        ok: false, 
        error: "Access denied - can only view your own nearby rides" 
      });
    }
    
    const driver = await Driver.findOne({ telegramId });
    if (!driver) return res.status(404).json({ ok: false, error: "Driver not found" });
    if (!driver.availability || !driver.availableLocation) {
      return res.status(400).json({ ok: false, error: "Driver is not currently available" });
    }

    // Check if driver's availability has expired
    const now = new Date();
    if (driver.timeTillAvailable && now > new Date(driver.timeTillAvailable)) {
      return res.status(400).json({ ok: false, error: "Driver availability has expired" });
    }

    const radius = ensureNumber(driver.myRadiusOfAvailabilityMiles, 10);
    const rides = await Ride.find({
      status: "open",
      pickupLocation: {
        $near: {
          $geometry: driver.availableLocation,
          $maxDistance: milesToMeters(Math.min(radius, 100)),
        },
      },
    })
      .sort({ timeOfRide: 1 })
      .limit(20)
      .lean();

    return res.json({ ok: true, rides, count: rides.length, center: driver.availableLocationName, radiusMiles: radius });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}

// GET /driver/stats/:telegramId - Secured with authentication
async function stats(req, res) {
  try {
    const telegramId = String(req.params.telegramId);
    const requestingTelegramId = req.headers['x-telegram-id'] || req.headers['telegram-id'];
    
    // Check for API key (internal system access) OR user authentication
    const apiKey = req.headers['x-api-key'];
    const hasValidApiKey = apiKey && apiKey === process.env.INTERNAL_API_KEY;
    const isOwnData = requestingTelegramId && requestingTelegramId === telegramId;
    
    if (!hasValidApiKey && !isOwnData) {
      // Log security violation
      console.warn('[SECURITY] Unauthorized access attempt to driver stats:', {
        timestamp: new Date().toISOString(),
        requestingId: requestingTelegramId || 'none',
        targetId: telegramId,
        endpoint: 'stats',
        ip: req.ip || req.connection?.remoteAddress
      });
      
      return res.status(403).json({ 
        ok: false, 
        error: "Access denied - can only view your own statistics" 
      });
    }
    
    const driver = await Driver.findOne({ telegramId });
    if (!driver) return res.status(404).json({ ok: false, error: "Driver not found" });

    const [totalMatched, totalCompleted, earnedAgg] = await Promise.all([
      Ride.countDocuments({ driverId: driver._id }),
      Ride.countDocuments({ driverId: driver._id, status: "completed" }),
      Ride.aggregate([
        { $match: { driverId: driver._id, status: "completed" } },
        { $group: { _id: null, sum: { $sum: "$bid" } } },
      ]),
    ]);

    return res.json({
      ok: true,
      stats: {
        totalMatched,
        totalCompleted,
        totalEarned: earnedAgg?.[0]?.sum || 0,
        rating: driver.rating || 0,
      },
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}

module.exports = { setAvailable, availabilityOff, nearby, stats, requireDriverAuth };
