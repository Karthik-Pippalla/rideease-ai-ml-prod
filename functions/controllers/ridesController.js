const Ride = require("../models/ride");
const Rider = require("../models/rider");
const Driver = require("../models/driver");
const { 
  publishRideAcceptedEvent, 
  publishRideCancelledEvent, 
  publishRideCompletedEvent 
} = require("../utils/kafkaEvents");

// POST /rides/accept
exports.acceptRide = async (req, res) => {
  try {
    const { driverTelegramId, rideId } = req.body || {};
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

    // Publish Kafka event for ride acceptance
    try {
      await publishRideAcceptedEvent(rideId, driver._id, ride.riderId);
    } catch (kafkaError) {
      console.error('❌ Failed to publish ride accepted event:', kafkaError.message);
      // Don't fail the request if Kafka fails
    }

    return res.json({ ok: true, ride });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
};

// POST /rides/complete
exports.completeRide = async (req, res) => {
  try {
    const { rideId } = req.body || {};
    if (!rideId) return res.status(400).json({ ok: false, error: "rideId is required" });

    const ride = await Ride.findOneAndUpdate(
      { _id: rideId, status: { $in: ["matched", "open"] } },
      { $set: { status: "completed", updatedAt: new Date() } },
      { new: true }
    );
    if (!ride) return res.status(404).json({ ok: false, error: "Ride not found or already finished" });

    // Publish Kafka event for ride completion
    try {
      await publishRideCompletedEvent(rideId, ride.driverId, ride.riderId);
    } catch (kafkaError) {
      console.error('❌ Failed to publish ride completed event:', kafkaError.message);
      // Don't fail the request if Kafka fails
    }

    return res.json({ ok: true, ride });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
};

// POST /rides/cancel
exports.cancelRide = async (req, res) => {
  try {
    const { rideId, cancelledBy = 'system' } = req.body || {};
    if (!rideId) return res.status(400).json({ ok: false, error: "rideId is required" });

    const ride = await Ride.findOneAndUpdate(
      { _id: rideId, status: { $in: ["open", "matched"] } },
      { $set: { status: "cancelled", updatedAt: new Date() } },
      { new: true }
    );
    if (!ride) return res.status(404).json({ ok: false, error: "Ride not found or cannot be cancelled" });

    // Publish Kafka event for ride cancellation
    try {
      await publishRideCancelledEvent(rideId, cancelledBy, 'Ride cancelled via API');
    } catch (kafkaError) {
      console.error('❌ Failed to publish ride cancelled event:', kafkaError.message);
      // Don't fail the request if Kafka fails
    }

    return res.json({ ok: true, ride });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
};

// GET /rides/for-driver/:telegramId
exports.forDriver = async (req, res) => {
  try {
    const telegramId = String(req.params.telegramId);
    const driver = await Driver.findOne({ telegramId });
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

// GET /rides/for-rider/:telegramId
exports.forRider = async (req, res) => {
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
};
