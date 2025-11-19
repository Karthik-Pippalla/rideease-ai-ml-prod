// models/Driver.js
const mongoose = require("mongoose");

const GeoPoint = {
  type: { type: String, enum: ["Point"], default: "Point" },
  coordinates: {
    // [lon, lat]
    type: [Number],
    validate: {
      validator: function(v) {
        // Allow undefined/null or valid array with 2 numbers
        return !v || (Array.isArray(v) && v.length === 2 && v.every(n => typeof n === 'number' && !isNaN(n)));
      },
      message: 'GeoPoint coordinates must be an array of 2 valid numbers [longitude, latitude]'
    },
  },
};

const DriverSchema = new mongoose.Schema(
  {
    // Identity
    name: { type: String, required: true, trim: true },
    phoneNumber: { type: String, required: true, trim: true },
    telegramId: { type: String, required: true, unique: true, index: true },
    telegramUsername: { type: String, required: true, trim: true, index: true },

    // Vehicle / docs
    licensePlateNumber: { type: String, required: true, trim: true },
    vehicleColour: { type: String, required: true, trim: true },

    // Availability (driver can toggle; availability lifecycles elsewhere)
    availability: { type: Boolean, default: false },
    availabilityStartedAt: { type: Date }, // When driver set availability to true

    // When available=true, these may be set
    availableLocationName: { type: String, trim: true },
    availableLocation: {
      type: {
        type: String, 
        enum: ["Point"]
      },
      coordinates: {
        type: [Number]
      }
    }, // GeoJSON point used for matching
    myRadiusOfAvailabilityMiles: { type: Number, min: 0, default: 0 },
    timeTillAvailable: { type: Date }, // e.g., endsAt or next-available cutoff

    // Reputation
    rating: { type: Number, min: 0, max: 5, default: 0 },
  },
  { timestamps: true }
);

// Geo indexes (2dsphere) - sparse indexes only index documents that have these fields
DriverSchema.index({ availableLocation: "2dsphere" }, { sparse: true });

module.exports =
  mongoose.models.Driver || mongoose.model("Driver", DriverSchema);
