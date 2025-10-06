const Driver = require("../models/driver");
const Ride = require("../models/ride");
const { getCoordsFromAddress } = require("../utils/geocode");

function milesToMeters(mi) {
  return Number(mi) * 1609.34;
}

function ensureNumber(n, def = 0) {
  const v = Number(n);
  return Number.isFinite(v) ? v : def;
}

// POST /driver/available
async function setAvailable(req, res) {
  try {
    const {
      telegramId,
      address,
      radiusMiles,
      hours = 1,
    } = req.body || {};

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

// POST /driver/availability_off
async function availabilityOff(req, res) {
  try {
    const { telegramId } = req.body || {};
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

// GET /driver/nearby-rides/:telegramId
async function nearby(req, res) {
  try {
    const telegramId = String(req.params.telegramId);
    const driver = await Driver.findOne({ telegramId });
    if (!driver) return res.status(404).json({ ok: false, error: "Driver not found" });
    if (!driver.availability || !driver.availableLocation) {
      return res.status(400).json({ ok: false, error: "Driver is not currently available" });
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

// GET /driver/stats/:telegramId
async function stats(req, res) {
  try {
    const telegramId = String(req.params.telegramId);
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

module.exports = { setAvailable, availabilityOff, nearby, stats };
