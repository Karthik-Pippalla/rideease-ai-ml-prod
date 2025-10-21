// functions/index.js
// Runtime: Node.js 22 (2nd gen)

const functions = require("firebase-functions");
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
require("dotenv").config();

// Initialize Admin SDK (needed for Task Queues enqueuing from other modules)
const admin = require("firebase-admin");
try { admin.app(); } catch { admin.initializeApp(); }

// v2 Task Queues
const { onTaskDispatched } = require("firebase-functions/v2/tasks");

// --- Routers ---
const { router: riderRoutes } = require("./routes/riders");
const { router: driverRoutes } = require("./routes/drivers");
const { router: rideRoutes } = require("./routes/rides");

// --- Utils / Models used by tasks ---
const db = require("./utils/database");
const notifications = require("./utils/notifications");
const { handleDatabaseOperation, logError } = require("./utils/errorHandler");
const Driver = require("./models/driver");
const Rider = require("./models/rider");

// --- Kafka Integration ---
const { initializeTopics, initKafka } = require("./utils/kafka");
const { initializeConsumers } = require("./utils/kafkaConsumers");

// ========== Mongo: single lazy connection ==========
let mongoPromise = null;
async function connectDb() {
  if (mongoose.connection.readyState === 1) return mongoose;

  if (!mongoPromise) {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
      const err = new Error("MONGODB_URI not set");
      console.error("❌", err.message);
      throw err;
    }

    mongoPromise = mongoose
      .connect(uri, {
        dbName: process.env.MONGODB_DB || undefined,
        serverSelectionTimeoutMS: 10_000,
        socketTimeoutMS: 45_000,
        bufferCommands: false,
      })
      .then(() => {
        console.log("✅ MongoDB connected");
        return mongoose;
      })
      .catch((err) => {
        console.error("❌ MongoDB connection failed:", err?.message || err);
        mongoPromise = null; // allow retry next request
        throw err;
      });
  }

  return mongoPromise;
}

// ========== Kafka: initialization ==========
let kafkaInitialized = false;
async function initializeKafka() {
  if (kafkaInitialized) return;
  
  try {
    // Only initialize Kafka if KAFKA_BROKERS is configured
    if (process.env.KAFKA_BROKERS) {
      console.log("🚀 Initializing Kafka...");
      await initKafka();
      await initializeTopics();
      await initializeConsumers();
      kafkaInitialized = true;
      console.log("✅ Kafka initialized successfully");
    } else {
      console.log("ℹ️ Kafka not configured (KAFKA_BROKERS not set)");
    }
  } catch (error) {
    console.error("❌ Kafka initialization failed:", error.message);
    // Don't throw - allow app to continue without Kafka
  }
}

// ========== Express app ==========
const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: "10mb" }));

// Health
app.get("/health", (_req, res) => res.json({ ok: true, ts: Date.now() }));

// REST API (ensure DB and Kafka before hitting routers)
app.use(async (_req, _res, next) => {
  try {
    await connectDb();
    await initializeKafka();
    next();
  } catch (e) {
    next(e);
  }
});
app.use("/rider", riderRoutes);
app.use("/driver", driverRoutes);
app.use("/rides", rideRoutes);

// Telegram webhooks (lazy-load bots so they don't auto-run on deploy)

// Driver bot webhook
app.post("/telegram/driver", async (req, res) => {
  console.log("📨 Driver bot webhook received:", {
    method: req.method,
    url: req.url,
    ua: req.headers["user-agent"],
    ct: req.headers["content-type"],
    bodySize: req.body ? JSON.stringify(req.body).length : 0,
  });

  try {
    await connectDb();

    if (!req.body || typeof req.body.update_id === "undefined") {
      console.warn("⚠️ Invalid webhook payload");
      return res.status(400).json({ error: "Invalid webhook payload" });
    }

    const driverBot = require("./driverBot");
    await driverBot.processUpdate(req.body);

    console.log("✅ Driver webhook processed successfully");
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("❌ Driver webhook error:", e?.stack || e);
    return res.status(500).json({ error: e?.message || "Driver webhook error" });
  }
});

// Rider bot webhook  
app.post("/telegram/rider", async (req, res) => {
  console.log("📨 Rider bot webhook received:", {
    method: req.method,
    url: req.url,
    ua: req.headers["user-agent"],
    ct: req.headers["content-type"],
    bodySize: req.body ? JSON.stringify(req.body).length : 0,
  });

  try {
    await connectDb();

    if (!req.body || typeof req.body.update_id === "undefined") {
      console.warn("⚠️ Invalid webhook payload");
      return res.status(400).json({ error: "Invalid webhook payload" });
    }

    const riderBot = require("./riderBot");
    await riderBot.processUpdate(req.body);

    console.log("✅ Rider webhook processed successfully");
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("❌ Rider webhook error:", e?.stack || e);
    return res.status(500).json({ error: e?.message || "Rider webhook error" });
  }
});

// Legacy telegram webhook for backwards compatibility
app.post("/telegram", async (req, res) => {
  console.log("📨 Legacy telegram webhook received:", {
    method: req.method,
    url: req.url,
    ua: req.headers["user-agent"],
    ct: req.headers["content-type"],
    bodySize: req.body ? JSON.stringify(req.body).length : 0,
  });

  try {
    await connectDb();

    if (!req.body || typeof req.body.update_id === "undefined") {
      console.warn("⚠️ Invalid webhook payload");
      return res.status(400).json({ error: "Invalid webhook payload" });
    }

    // Redirect to rider bot by default for legacy compatibility
    const riderBot = require("./riderBot");
    await riderBot.processUpdate(req.body);

    console.log("✅ Legacy webhook processed successfully");
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("❌ Legacy webhook error:", e?.stack || e);
    return res.status(500).json({ error: e?.message || "Legacy webhook error" });
  }
});

// Export HTTPS entry
exports.api = functions.https.onRequest(app);

// ========== Telegram Bot Webhooks ==========
// Driver Bot Webhook
exports.driverBotWebhook = functions.https.onRequest(async (req, res) => {
  try {
    // Ensure database connection
    await connectDb();
    
    const { initDriverBot } = require('./driverBot');
    const bot = initDriverBot();
    await bot.processUpdate(req.body);
    res.status(200).send("ok");
  } catch (e) {
    console.error("Driver Bot Webhook Error:", e);
    res.status(500).send("error");
  }
});

// Rider Bot Webhook  
exports.riderBotWebhook = functions.https.onRequest(async (req, res) => {
  try {
    // Ensure database connection
    await connectDb();
    
    const { initRiderBot } = require('./riderBot');
    const bot = initRiderBot();
    await bot.processUpdate(req.body);
    res.status(200).send("ok");
  } catch (e) {
    console.error("Rider Bot Webhook Error:", e);
    res.status(500).send("error");
  }
});

// ========== Task Queue handlers (no cron) ==========
exports.closeAvailabilityTask = onTaskDispatched({ region: "us-central1", retryConfig: { maxAttempts: 3 } }, async (req) => {
  try {
    await connectDb();
  } catch (e) {
    console.error("TASK closeAvailability: DB connect failed:", e?.message || e);
    return null;
  }
  const { driverId } = req.data || {};
  if (!driverId) return null;

  try {
    const open = await db.getOpenAvailabilityByDriver(driverId);
    if (open) {
      await db.closeDriverAvailability(driverId);
      try {
        const drv = await Driver.findById(driverId);
        if (drv) await notifications.notifyDriver?.(drv, "Your availability window ended. I’ve closed it.");
      } catch (_) {}
    }
  } catch (e) {
    console.error("TASK closeAvailability error:", e?.message || e);
  }
  return null;
});

exports.failRideTask = onTaskDispatched({ region: "us-central1", retryConfig: { maxAttempts: 3 } }, async (req) => {
  try {
    await connectDb();
  } catch (e) {
    console.error("TASK failRide: DB connect failed:", e?.message || e);
    return null;
  }
  const { rideId } = req.data || {};
  if (!rideId) return null;

  try {
    const Ride = require("./models/ride");
    const ride = await Ride.findById(rideId).lean();
    if (!ride) return null;
    if (ride.status !== "open") return null; // already handled

    const rideTime = ride.rideTime || ride.timeOfRide;
    const now = new Date();
    if (rideTime && new Date(rideTime).getTime() + 20 * 60 * 1000 > now.getTime()) {
      // triggered too early; ignore
      return null;
    }

    await db.markRideFailed({ rideId, reason: "timeout" });
    try {
      const rd = await Rider.findById(ride.riderId);
      if (rd) await notifications.notifyRider?.(rd, "No driver accepted in time. Your ride has been marked as failed.");
    } catch (_) {}
  } catch (e) {
    console.error("TASK failRide error:", e?.message || e);
  }
  return null;
});
