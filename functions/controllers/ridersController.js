const Rider = require("../models/rider");
const Ride = require("../models/ride");
const { getCoordsFromAddress } = require("../utils/geocode");
const { publishRideRequestEvent, publishRideCancelledEvent } = require("../utils/kafkaEvents");

function milesToMeters(mi) { return Number(mi) * 1609.34; }

// POST /rider/request
async function requestRide(req, res) {
  try {
    const { telegramId, pickup, dropoff, bid = 0, rideTime, notes } = req.body || {};
    if (!telegramId) return res.status(400).json({ ok: false, error: "telegramId is required" });
    if (!pickup || !dropoff) return res.status(400).json({ ok: false, error: "pickup and dropoff are required" });

    const rider = await Rider.findOne({ telegramId: String(telegramId) });
    if (!rider) return res.status(404).json({ ok: false, error: "Rider not found" });

    const p = await getCoordsFromAddress(pickup);
    const d = await getCoordsFromAddress(dropoff);

    const when = rideTime ? new Date(rideTime) : null;
    if (!when || isNaN(when.getTime())) return res.status(400).json({ ok: false, error: "rideTime must be a valid date/time" });
    if (when.getTime() - Date.now() < 30 * 60 * 1000) {
      return res.status(400).json({ ok: false, error: "rideTime must be at least 30 minutes from now" });
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

    // Publish Kafka event for ride request
    try {
      await publishRideRequestEvent(ride);
    } catch (kafkaError) {
      console.error('❌ Failed to publish ride request event:', kafkaError.message);
      // Don't fail the request if Kafka fails
    }

    return res.json({ ok: true, ride });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}

// POST /rider/delete-open
async function deleteOpen(req, res) {
  try {
    const { telegramId } = req.body || {};
    if (!telegramId) return res.status(400).json({ ok: false, error: "telegramId is required" });

    const rider = await Rider.findOne({ telegramId: String(telegramId) });
    if (!rider) return res.status(404).json({ ok: false, error: "Rider not found" });

    const ride = await Ride.findOneAndDelete({ riderId: rider._id, status: "open" });
    if (!ride) return res.status(404).json({ ok: false, error: "No open ride found" });

    // Publish Kafka event for ride cancellation
    try {
      await publishRideCancelledEvent(ride._id, 'rider', 'Rider deleted open ride request');
    } catch (kafkaError) {
      console.error('❌ Failed to publish ride cancelled event:', kafkaError.message);
      // Don't fail the request if Kafka fails
    }

    return res.json({ ok: true, deleted: ride._id });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}

// GET /rider/history/:telegramId
async function history(req, res) {
  try {
    const telegramId = String(req.params.telegramId);
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

// GET /rider/stats/:telegramId
async function stats(req, res) {
  try {
    const telegramId = String(req.params.telegramId);
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
