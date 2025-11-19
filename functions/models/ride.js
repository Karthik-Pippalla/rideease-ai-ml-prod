// models/Ride.js
const mongoose = require("mongoose");

// GeoJSON Point sub-schema (no _id)
const GeoPointSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ["Point"], default: "Point" },
    // [lon, lat]
    coordinates: {
      type: [Number],
      required: true,
      validate: v => Array.isArray(v) && v.length === 2,
    },
  },
  { _id: false }
);

const RideSchema = new mongoose.Schema(
  {
    driverId: { type: mongoose.Schema.Types.ObjectId, ref: "Driver" }, // may be null until matched
    riderId: { type: mongoose.Schema.Types.ObjectId, ref: "Rider", required: true },

    // Locations
    pickupLocationName: { type: String, required: true, trim: true },
    pickupLocation: { type: GeoPointSchema, required: true },
    dropLocationName: { type: String, required: true, trim: true },
    dropLocation: { type: GeoPointSchema, required: true },

    // Money & time
    bid: { type: Number, min: 0, default: 0 },
    timeOfRide: { type: Date, required: true },

    // Route information
    routeDistance: {
      meters: { type: Number },
      miles: { type: Number },
      text: { type: String }
    },
    routeDuration: {
      seconds: { type: Number },
      minutes: { type: Number },
      text: { type: String }
    },
    estimatedDropoffTime: { type: Date },
    hasTrafficData: { type: Boolean, default: false },

    // Status lifecycle
    status: {
      type: String,
      enum: ["open", "matched", "completed", "failed", "cancelled"],
      default: "open",
      index: true,
    },

    // Automated task tracking fields
    statusNotificationSent: { type: Boolean, default: false },
    reminderSent: { type: Boolean, default: false },

    // Optional metadata
    notes: { type: String, trim: true },
  },
  { timestamps: true }
);

// Geo indexes for matching
RideSchema.index({ pickupLocation: "2dsphere" });
RideSchema.index({ dropLocation: "2dsphere" });

// Common compound index for queries like: open rides by time
RideSchema.index({ status: 1, timeOfRide: 1 });

// Index for rider's active rides lookup (used in /me command)
RideSchema.index({ riderId: 1, status: 1, createdAt: -1 });

// Index for driver's active rides lookup
RideSchema.index({ driverId: 1, status: 1, createdAt: -1 });

module.exports =
  mongoose.models.Ride || mongoose.model("Ride", RideSchema);
