// utils/guards.js
// Guards and sanitizers for bot-triggered operations

const Ride = require("../models/ride");
const Driver = require("../models/driver");

// Fields that must not be user-editable via the bot
const RESTRICTED_FIELDS = new Set([
  "rating",
  "ratings",
  "pastRides",
  "pastRidesIds",
  "pastRidesIds[]",
]);

function deepStripRestricted(obj) {
  if (!obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(deepStripRestricted);
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (RESTRICTED_FIELDS.has(k)) continue; // strip
    // also block nested payloads attempting to set $set.rating, etc.
    if (k === "$set" || k === "$push" || k === "$addToSet" || k === "$inc") {
      out[k] = deepStripRestricted(v);
      continue;
    }
    out[k] = deepStripRestricted(v);
  }
  return out;
}

function sanitizeCrudPayload(action, payload) {
  // Allow system flows to log past rides explicitly if action name matches
  if (action === "logPastRide") return payload;
  return deepStripRestricted(payload);
}

async function assertSingleOpen(role, userId) {
  // Prevent more than one open ride or availability per user
  if (role === "rider") {
    const open = await Ride.countDocuments({ riderId: userId, status: { $in: ["open", "matched"] } });
    if (open > 0) throw new Error("You already have an active ride.");
    return true;
  }
  if (role === "driver") {
    const driver = await Driver.findById(userId).lean();
    if (driver?.availability) throw new Error("You’re already available. Turn it off first.");
    return true;
  }
  return true;
}

module.exports = { sanitizeCrudPayload, assertSingleOpen };
