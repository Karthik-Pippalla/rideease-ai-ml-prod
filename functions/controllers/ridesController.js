const Ride = require("../models/ride");
const Rider = require("../models/rider");
const Driver = require("../models/driver");
const { calculateAndUpdateRouteInfo, batchUpdateRouteInfo } = require("../utils/database");

// Authentication middleware to verify user ownership
function requireAuth(requiredRole) {
  return (req, res, next) => {
    const requestingTelegramId = req.headers['x-telegram-id'] || req.headers['telegram-id'];
    const targetTelegramId = req.params.telegramId;
    
    // Check if authenticated user is trying to access their own data
    if (!requestingTelegramId) {
      return res.status(401).json({ 
        ok: false, 
        error: "Authentication required - missing telegram ID header" 
      });
    }
    
    if (requestingTelegramId !== targetTelegramId) {
      return res.status(403).json({ 
        ok: false, 
        error: "Access denied - can only access your own data" 
      });
    }
    
    // Store for later use
    req.authenticatedTelegramId = requestingTelegramId;
    next();
  };
}

// API key middleware for internal system calls
function requireApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  
  if (!apiKey || apiKey !== process.env.INTERNAL_API_KEY) {
    return res.status(401).json({ 
      ok: false, 
      error: "Invalid or missing API key" 
    });
  }
  
  next();
}

// POST /rides/accept - Requires driver authentication
exports.acceptRide = async (req, res) => {
  try {
    const { driverTelegramId, rideId } = req.body || {};
    const requestingTelegramId = req.headers['x-telegram-id'] || req.headers['telegram-id'];
    
    // Verify the requesting user is the driver they claim to be
    if (!requestingTelegramId || requestingTelegramId !== driverTelegramId) {
      return res.status(403).json({ 
        ok: false, 
        error: "Access denied - can only accept rides as yourself" 
      });
    }
    
    if (!driverTelegramId || !rideId) {
      return res.status(400).json({ ok: false, error: "driverTelegramId and rideId are required" });
    }

    const driver = await Driver.findOne({ telegramId: String(driverTelegramId) });
    if (!driver) return res.status(404).json({ ok: false, error: "Driver not found" });

    const ride = await Ride.findOneAndUpdate(
      { _id: rideId, status: "open" },
      { $set: { status: "matched", driverId: driver._id, updatedAt: new Date() } },
      { new: true }
    );
    if (!ride) return res.status(404).json({ ok: false, error: "Ride not available" });

    return res.json({ ok: true, ride });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
};

// POST /rides/complete - Requires driver authentication 
exports.completeRide = async (req, res) => {
  try {
    const { rideId, driverTelegramId } = req.body || {};
    const requestingTelegramId = req.headers['x-telegram-id'] || req.headers['telegram-id'];
    
    if (!rideId) return res.status(400).json({ ok: false, error: "rideId is required" });
    
    // Find the ride first to verify ownership
    const existingRide = await Ride.findById(rideId).populate('driverId');
    if (!existingRide) {
      return res.status(404).json({ ok: false, error: "Ride not found" });
    }
    
    // Verify the requesting user owns this ride (is the assigned driver)
    if (!requestingTelegramId || existingRide.driverId?.telegramId !== requestingTelegramId) {
      return res.status(403).json({ 
        ok: false, 
        error: "Access denied - can only complete your own rides" 
      });
    }

    const ride = await Ride.findOneAndUpdate(
      { _id: rideId, status: { $in: ["matched", "in_progress"] }, driverId: existingRide.driverId._id },
      { $set: { status: "completed", completedAt: new Date(), updatedAt: new Date() } },
      { new: true }
    );
    
    if (!ride) return res.status(404).json({ ok: false, error: "Ride not found or already finished" });

    return res.json({ ok: true, ride });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
};

// POST /rides/cancel - Requires user authentication
exports.cancelRide = async (req, res) => {
  try {
    const { rideId, userTelegramId, userType } = req.body || {};
    const requestingTelegramId = req.headers['x-telegram-id'] || req.headers['telegram-id'];
    
    if (!rideId) return res.status(400).json({ ok: false, error: "rideId is required" });
    if (!userType || !["rider", "driver"].includes(userType)) {
      return res.status(400).json({ ok: false, error: "userType must be 'rider' or 'driver'" });
    }
    
    // Verify the requesting user is who they claim to be
    if (!requestingTelegramId || requestingTelegramId !== userTelegramId) {
      return res.status(403).json({ 
        ok: false, 
        error: "Access denied - can only cancel your own rides" 
      });
    }
    
    // Find the user and build the query based on their role
    let query = { _id: rideId, status: { $in: ["open", "matched"] } };
    
    if (userType === "rider") {
      const rider = await Rider.findOne({ telegramId: userTelegramId });
      if (!rider) return res.status(404).json({ ok: false, error: "Rider not found" });
      query.riderId = rider._id;
    } else {
      const driver = await Driver.findOne({ telegramId: userTelegramId });
      if (!driver) return res.status(404).json({ ok: false, error: "Driver not found" });
      query.driverId = driver._id;
    }

    const ride = await Ride.findOneAndUpdate(
      query,
      { 
        $set: { 
          status: "cancelled", 
          cancelledAt: new Date(),
          cancelledBy: userType,
          updatedAt: new Date()
        } 
      },
      { new: true }
    );
    
    if (!ride) return res.status(404).json({ ok: false, error: "Ride not found or cannot be cancelled" });

    return res.json({ ok: true, ride });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
};

// GET /rides/for-driver/:telegramId - Secured with authentication
exports.forDriver = async (req, res) => {
  try {
    // Check for API key (internal system access) OR user authentication
    const apiKey = req.headers['x-api-key'];
    const requestingTelegramId = req.headers['x-telegram-id'] || req.headers['telegram-id'];
    const targetTelegramId = String(req.params.telegramId);
    
    // Allow internal system calls with valid API key
    const hasValidApiKey = apiKey && apiKey === process.env.INTERNAL_API_KEY;
    
    // Allow user to access their own data
    const isOwnData = requestingTelegramId && requestingTelegramId === targetTelegramId;
    
    if (!hasValidApiKey && !isOwnData) {
      // Log security violation
      console.warn('[SECURITY] Unauthorized access attempt to driver data:', {
        timestamp: new Date().toISOString(),
        requestingId: requestingTelegramId || 'none',
        targetId: targetTelegramId,
        endpoint: 'forDriver',
        ip: req.ip || req.connection?.remoteAddress
      });
      
      return res.status(403).json({ 
        ok: false, 
        error: "Access denied - can only access your own ride data" 
      });
    }
    
    const driver = await Driver.findOne({ telegramId: targetTelegramId });
    if (!driver) return res.status(404).json({ ok: false, error: "Driver not found" });

    const rides = await Ride.find({ driverId: driver._id })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    return res.json({ ok: true, rides, count: rides.length });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
};

// GET /rides/for-rider/:telegramId - Secured with authentication
exports.forRider = async (req, res) => {
  try {
    // Check for API key (internal system access) OR user authentication
    const apiKey = req.headers['x-api-key'];
    const requestingTelegramId = req.headers['x-telegram-id'] || req.headers['telegram-id'];
    const targetTelegramId = String(req.params.telegramId);
    
    // Allow internal system calls with valid API key
    const hasValidApiKey = apiKey && apiKey === process.env.INTERNAL_API_KEY;
    
    // Allow user to access their own data
    const isOwnData = requestingTelegramId && requestingTelegramId === targetTelegramId;
    
    if (!hasValidApiKey && !isOwnData) {
      // Log security violation  
      console.warn('[SECURITY] Unauthorized access attempt to rider data:', {
        timestamp: new Date().toISOString(),
        requestingId: requestingTelegramId || 'none',
        targetId: targetTelegramId,
        endpoint: 'forRider', 
        ip: req.ip || req.connection?.remoteAddress
      });
      
      return res.status(403).json({ 
        ok: false, 
        error: "Access denied - can only access your own ride data" 
      });
    }
    
    const rider = await Rider.findOne({ telegramId: targetTelegramId });
    if (!rider) return res.status(404).json({ ok: false, error: "Rider not found" });

    const rides = await Ride.find({ riderId: rider._id })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    return res.json({ ok: true, rides, count: rides.length });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
};

// POST /rides/calculate-route - Requires API key (internal system access)
exports.calculateRoute = async (req, res) => {
  try {
    const { rideId } = req.body;
    const apiKey = req.headers['x-api-key'];
    
    if (!apiKey || apiKey !== process.env.INTERNAL_API_KEY) {
      return res.status(401).json({ 
        ok: false, 
        error: "Invalid or missing API key" 
      });
    }
    
    if (!rideId) {
      return res.status(400).json({ 
        ok: false, 
        error: "rideId is required" 
      });
    }

    const result = await calculateAndUpdateRouteInfo(rideId);
    
    if (!result.success) {
      return res.status(400).json({ 
        ok: false, 
        error: result.error 
      });
    }

    return res.json({ 
      ok: true, 
      ride: result.data,
      routeInfo: result.routeInfo
    });
  } catch (e) {
    return res.status(500).json({ 
      ok: false, 
      error: e.message 
    });
  }
};

// POST /rides/batch-calculate-routes - Requires API key (internal system access)
exports.batchCalculateRoutes = async (req, res) => {
  try {
    const { rideIds, status } = req.body;
    const apiKey = req.headers['x-api-key'];
    
    if (!apiKey || apiKey !== process.env.INTERNAL_API_KEY) {
      return res.status(401).json({ 
        ok: false, 
        error: "Invalid or missing API key" 
      });
    }
    
    let targetRideIds = rideIds;
    
    // If no specific rideIds provided, find rides that need route calculation
    if (!targetRideIds || targetRideIds.length === 0) {
      const query = { 
        routeDistance: { $exists: false },
        pickupLocation: { $exists: true },
        dropLocation: { $exists: true }
      };
      
      // Optionally filter by status
      if (status) {
        query.status = status;
      }
      
      const ridesNeedingCalculation = await Ride.find(query)
        .select('_id')
        .limit(50) // Limit to avoid overwhelming the API
        .lean();
        
      targetRideIds = ridesNeedingCalculation.map(ride => ride._id.toString());
    }
    
    if (targetRideIds.length === 0) {
      return res.json({ 
        ok: true, 
        message: "No rides found that need route calculation",
        results: { total: 0, successful: 0, failed: 0, errors: [] }
      });
    }

    const results = await batchUpdateRouteInfo(targetRideIds);
    
    return res.json({ 
      ok: true, 
      results 
    });
  } catch (e) {
    return res.status(500).json({ 
      ok: false, 
      error: e.message 
    });
  }
};

// Export middleware functions for use in other controllers
exports.requireAuth = requireAuth;
exports.requireApiKey = requireApiKey;
