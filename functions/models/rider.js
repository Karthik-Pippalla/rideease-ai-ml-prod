// models/Rider.js
const mongoose = require("mongoose");

const GeoPoint = {
  type: { type: String, enum: ["Point"] },
  coordinates: {
    // [lon, lat]
    type: [Number],
    validate: {
      validator: function(v) {
        // More permissive - allow undefined or valid coordinates
        return !v || (Array.isArray(v) && v.length === 2 && v.every(n => typeof n === 'number' && isFinite(n)));
      },
      message: 'GeoPoint coordinates must be an array of 2 finite numbers [longitude, latitude]'
    },
  },
};

const RiderSchema = new mongoose.Schema(
  {
    // Identity
    name: { type: String, required: true, trim: true },
    phoneNumber: { type: String, trim: true }, // optional
    telegramId: { type: String, required: true, unique: true, index: true },
    telegramUsername: { type: String, required: true, trim: true, index: true },

    // Home/work (for convenience shortcuts)
    homeAddress: { type: String, trim: true },
    workAddress: { type: String, trim: true },
    homeGeo: GeoPoint,
    workGeo: GeoPoint,

    // Reputation
    rating: { type: Number, min: 0, max: 5, default: 0 },
  },
  { timestamps: true }
);

// Geo indexes for fast lookups - sparse indexes only index documents that have these fields
RiderSchema.index({ homeGeo: "2dsphere" }, { sparse: true });
RiderSchema.index({ workGeo: "2dsphere" }, { sparse: true });

module.exports =
  mongoose.models.Rider || mongoose.model("Rider", RiderSchema);
