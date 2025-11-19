const Rider = require("../models/rider");
const Ride = require("../models/ride");
const { getCoordsFromAddress } = require("../utils/geocode");
const { parseDateTime, isValidFutureTime } = require("../utils/dateParser");

function milesToMeters(mi) { return Number(mi) * 1609.34; }

// POST /rider/request - Secured with authentication
async function requestRide(req, res) {
  try {
    const { telegramId, pickup, dropoff, bid = 0, rideTime, notes } = req.body || {};
    const requestingTelegramId = req.headers['x-telegram-id'] || req.headers['telegram-id'];
    
    // Verify authentication (unless internal API call)
    const apiKey = req.headers['x-api-key'];
    const hasValidApiKey = apiKey && apiKey === process.env.INTERNAL_API_KEY;
    
    if (!hasValidApiKey && (!requestingTelegramId || requestingTelegramId !== telegramId)) {
      return res.status(403).json({ 
        ok: false, 
        error: "Access denied - can only request rides for your own account" 
      });
    }
    
    if (!telegramId) return res.status(400).json({ ok: false, error: "telegramId is required" });
    if (!pickup || !dropoff) return res.status(400).json({ ok: false, error: "pickup and dropoff are required" });

    const rider = await Rider.findOne({ telegramId: String(telegramId) });
    if (!rider) return res.status(404).json({ ok: false, error: "Rider not found" });

    const p = await getCoordsFromAddress(pickup);
    const d = await getCoordsFromAddress(dropoff);

    // Enhanced date parsing - supports "today", "tomorrow", natural language
    const when = rideTime ? parseDateTime(rideTime) : null;
    if (!when || isNaN(when.getTime())) {
      return res.status(400).json({ 
        ok: false, 
        error: "Invalid rideTime. Use formats like 'today 6pm', 'tomorrow 9am', or 'right now'" 
      });
    }
    if (!isValidFutureTime(when)) {
      return res.status(400).json({ ok: false, error: "rideTime cannot be in the past" });
    }

    const ride = await Ride.create({
      riderId: rider._id,
      pickupLocationName: pickup,
      pickupLocation: p,
      dropLocationName: dropoff,
      dropLocation: d,
      bid: Number(bid) || 0,
      timeOfRide: when,
      status: "open",
      notes: notes || undefined,
    });

    return res.json({ ok: true, ride });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}

// POST /rider/delete-open - Secured with authentication
async function deleteOpen(req, res) {
  try {
    const { telegramId } = req.body || {};
    const requestingTelegramId = req.headers['x-telegram-id'] || req.headers['telegram-id'];
    
    // Verify authentication (unless internal API call)
    const apiKey = req.headers['x-api-key'];
    const hasValidApiKey = apiKey && apiKey === process.env.INTERNAL_API_KEY;
    
    if (!hasValidApiKey && (!requestingTelegramId || requestingTelegramId !== telegramId)) {
      return res.status(403).json({ 
        ok: false, 
        error: "Access denied - can only delete your own rides" 
      });
    }
    
    if (!telegramId) return res.status(400).json({ ok: false, error: "telegramId is required" });

    const rider = await Rider.findOne({ telegramId: String(telegramId) });
    if (!rider) return res.status(404).json({ ok: false, error: "Rider not found" });

    const ride = await Ride.findOneAndDelete({ riderId: rider._id, status: "open" });
    if (!ride) return res.status(404).json({ ok: false, error: "No open ride found" });
    return res.json({ ok: true, deleted: ride._id });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}

// GET /rider/history/:telegramId - Secured with authentication
async function history(req, res) {
  try {
    const telegramId = String(req.params.telegramId);
    const requestingTelegramId = req.headers['x-telegram-id'] || req.headers['telegram-id'];
    
    // Check for API key (internal system access) OR user authentication
    const apiKey = req.headers['x-api-key'];
    const hasValidApiKey = apiKey && apiKey === process.env.INTERNAL_API_KEY;
    const isOwnData = requestingTelegramId && requestingTelegramId === telegramId;
    
    if (!hasValidApiKey && !isOwnData) {
      // Log security violation
      console.warn('[SECURITY] Unauthorized access attempt to rider history:', {
        timestamp: new Date().toISOString(),
        requestingId: requestingTelegramId || 'none',
        targetId: telegramId,
        endpoint: 'history',
        ip: req.ip || req.connection?.remoteAddress
      });
      
      return res.status(403).json({ 
        ok: false, 
        error: "Access denied - can only view your own ride history" 
      });
    }
    
    const rider = await Rider.findOne({ telegramId });
    if (!rider) return res.status(404).json({ ok: false, error: "Rider not found" });

    const rides = await Ride.find({ riderId: rider._id })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    return res.json({ ok: true, rides, count: rides.length });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}

// GET /rider/stats/:telegramId - Secured with authentication
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
      console.warn('[SECURITY] Unauthorized access attempt to rider stats:', {
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
    
    const rider = await Rider.findOne({ telegramId });
    if (!rider) return res.status(404).json({ ok: false, error: "Rider not found" });

    const [open, matched, completed, failed] = await Promise.all([
      Ride.countDocuments({ riderId: rider._id, status: "open" }),
      Ride.countDocuments({ riderId: rider._id, status: "matched" }),
      Ride.countDocuments({ riderId: rider._id, status: "completed" }),
      Ride.countDocuments({ riderId: rider._id, status: { $in: ["failed", "cancelled"] } }),
    ]);

    const spentAgg = await Ride.aggregate([
      { $match: { riderId: rider._id, status: "completed" } },
      { $group: { _id: null, sum: { $sum: "$bid" } } },
    ]);

    return res.json({ ok: true, stats: { open, matched, completed, failed, totalSpent: spentAgg?.[0]?.sum || 0 } });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}

module.exports = { requestRide, deleteOpen, history, stats };
