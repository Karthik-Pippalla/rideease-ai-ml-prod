// functions/index.js
// Runtime: Node.js 22 (2nd gen)

// Load environment variables first (includes TZ=America/New_York)
require("dotenv").config();

const functions = require("firebase-functions");
const mongoose = require("mongoose");

// Initialize Admin SDK (needed for Task Queues enqueuing from other modules)
const admin = require("firebase-admin");
try { admin.app(); } catch { admin.initializeApp(); }

// --- Utils for notifications ---
const notifications = require("./utils/notifications");

// Initialize TelegramBot for notifications in scheduled tasks
const TelegramBot = require("node-telegram-bot-api");
const DRIVER_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN_DRIVER;
const RIDER_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

// Create bot instances for notifications if tokens are available
let driverNotificationBot = null;
let riderNotificationBot = null;

if (DRIVER_BOT_TOKEN) {
  driverNotificationBot = new TelegramBot(DRIVER_BOT_TOKEN);
  notifications.setDriverBotInstance(driverNotificationBot);
}

if (RIDER_BOT_TOKEN) {
  riderNotificationBot = new TelegramBot(RIDER_BOT_TOKEN);
  notifications.setRiderBotInstance(riderNotificationBot);
}

// Set bot instances for state timeout notifications
if (driverNotificationBot || riderNotificationBot) {
  try {
    const state = require("./utils/state");
    state.setBotInstances(driverNotificationBot, riderNotificationBot);
    console.log("✅ State timeout notification bots configured");
  } catch (err) {
    console.error("⚠️ Failed to configure state timeout notification bots:", err);
  }
}

// ========== Telegram Bot Webhooks ==========
// Driver Bot Webhook
exports.driverBotWebhook = functions.https.onRequest(async (req, res) => {
  const webhookStartTime = Date.now();
  console.log("🎯 PERF: Driver webhook received at:", new Date().toISOString());
  
  try {
    const botInitStartTime = Date.now();
    const { initDriverBot, ensureMongoConnection } = require('./driverBot');
    
    // Ensure MongoDB connection first
    const mongoStartTime = Date.now();
    await ensureMongoConnection();
    console.log("🎯 PERF: MongoDB connection took:", Date.now() - mongoStartTime, "ms");
    
    const bot = initDriverBot();
    console.log("🎯 PERF: Bot initialization took:", Date.now() - botInitStartTime, "ms");
    
    const processStartTime = Date.now();
    await bot.processUpdate(req.body);
    console.log("🎯 PERF: Update processing took:", Date.now() - processStartTime, "ms");
    console.log("🎯 PERF: Total webhook time:", Date.now() - webhookStartTime, "ms");
    
    res.status(200).send("ok");
  } catch (e) {
    console.error("Driver Bot Webhook Error:", e);
    res.status(500).send("error");
  }
});

// Rider Bot Webhook  
exports.riderBotWebhook = functions.https.onRequest(async (req, res) => {
  const webhookStartTime = Date.now();
  console.log("🎯 PERF: Rider webhook received at:", new Date().toISOString());
  
  try {
    const botInitStartTime = Date.now();
    const { initRiderBot, ensureMongoConnection } = require('./riderBot');
    
    // Ensure MongoDB connection first
    const mongoStartTime = Date.now();
    await ensureMongoConnection();
    console.log("🎯 PERF: MongoDB connection took:", Date.now() - mongoStartTime, "ms");
    
    const bot = initRiderBot();
    console.log("🎯 PERF: Bot initialization took:", Date.now() - botInitStartTime, "ms");
    
    const processStartTime = Date.now();
    await bot.processUpdate(req.body);
    console.log("🎯 PERF: Update processing took:", Date.now() - processStartTime, "ms");
    console.log("🎯 PERF: Total webhook time:", Date.now() - webhookStartTime, "ms");
    
    res.status(200).send("ok");
  } catch (e) {
    console.error("Rider Bot Webhook Error:", e);
    res.status(500).send("error");
  }
});



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

// ========== Scheduled Tasks ==========
const {
  closeAvailabilityTask,
  failRideTask,
  notifyDriverRideStatusTask,
  autoCancelRideTask,
  sendRideTimeReminderTask,
  triggerScheduledTask
} = require('./scheduledTasks');

// Export scheduled tasks
exports.closeAvailabilityTask = closeAvailabilityTask;
exports.failRideTask = failRideTask;
exports.notifyDriverRideStatusTask = notifyDriverRideStatusTask;
exports.autoCancelRideTask = autoCancelRideTask;
exports.sendRideTimeReminderTask = sendRideTimeReminderTask;
exports.triggerScheduledTask = triggerScheduledTask;


