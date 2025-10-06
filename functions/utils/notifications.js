// utils/notifications.js
// Centralized Telegram notification helpers. Designed to work with separate driver and rider bots.

let driverBot = null;
let riderBot = null;
let legacyBot = null; // For backwards compatibility

function setBotInstance(b) {
  // Legacy support
  legacyBot = b;
}

function setDriverBotInstance(b) {
  driverBot = b;
}

function setRiderBotInstance(b) {
  riderBot = b;
}

function resolveChatId(target) {
  if (!target) return null;
  // Accept plain chatId or full user/driver/rider docs
  if (typeof target === "string" || typeof target === "number") return String(target);
  // Try common fields
  const id = target.telegramId || target.chatId || target.tgId || (target.user && target.user.telegramId);
  return id ? String(id) : null;
}

async function sendTelegramMessage(target, text, opts = {}, botInstance = null) {
  const chatId = resolveChatId(target);
  if (!chatId) throw new Error("No chatId/telegramId provided for notification");
  
  const bot = botInstance || legacyBot;
  if (!bot?.sendMessage) {
    console.warn("notifications: bot instance not set; cannot send message", { chatId, text });
    return { ok: false, warning: "bot_not_set" };
  }
  try {
    return await bot.sendMessage(chatId, text, opts);
  } catch (e) {
    console.error("notifications: sendMessage failed", e?.response?.body || e?.message || e);
    return { ok: false, error: e?.message || String(e) };
  }
}

function notifyDriver(driver, text, opts = {}) {
  // Use driver bot if available, fallback to legacy bot
  const bot = driverBot || legacyBot;
  return sendTelegramMessage(driver, text, opts, bot);
}

function notifyRider(rider, text, opts = {}) {
  // Use rider bot if available, fallback to legacy bot
  const bot = riderBot || legacyBot;
  return sendTelegramMessage(rider, text, opts, bot);
}

// Template messages for common notifications
const templates = {
  rideMatched: (ride, driverInfo) => ({
    rider: `🚗 **Driver Found!**\n\nYour ride has been accepted!\n\n📍 **Pickup:** ${ride.pickupLocationName}\n📍 **Drop:** ${ride.dropLocationName}\n🕐 **Time:** ${new Date(ride.timeOfRide).toLocaleString()}\n\n👤 **Driver Contact:** @${driverInfo.telegramUsername || driverInfo.username || "(no username)"}\n📞 **Phone:** ${driverInfo.phoneNumber || "Contact via Telegram"}`,
    driver: `✅ **Ride Accepted!**\n\nRide details:\n\n📍 **Pickup:** ${ride.pickupLocationName}\n📍 **Drop:** ${ride.dropLocationName}\n🕐 **Time:** ${new Date(ride.timeOfRide).toLocaleString()}\n💰 **Bid:** $${ride.bid || 0}\n\n👤 **Rider Contact:** @${ride.riderInfo?.telegramUsername || ride.riderInfo?.username || "(no username)"}\n📞 **Phone:** ${ride.riderInfo?.phoneNumber || "Contact via Telegram"}`
  }),
  
  newRideRequest: (ride, distance) => 
    `🚗 **New Ride Request**\n\nNear you (~${distance?.toFixed?.(1) || "?"} miles):\n\n📍 **Pickup:** ${ride.pickupLocationName}\n📍 **Drop:** ${ride.dropLocationName}\n🕐 **Time:** ${new Date(ride.timeOfRide).toLocaleString()}${ride.bid ? `\n💰 **Bid:** $${ride.bid}` : ""}\n\nUse /available to start accepting rides!`,
  
  rideCancelled: (ride) =>
    `❌ **Ride Cancelled**\n\n📍 ${ride.pickupLocationName} → ${ride.dropLocationName}\n🕐 ${new Date(ride.timeOfRide).toLocaleString()}\n\nThe ride has been cancelled.`,
    
  rideCompleted: (ride) =>
    `✅ **Ride Completed**\n\n📍 ${ride.pickupLocationName} → ${ride.dropLocationName}\n🕐 ${new Date(ride.timeOfRide).toLocaleString()}\n💰 ${ride.bid ? `$${ride.bid}` : "No bid"}\n\nThanks for using RideEase!`
};

async function notifyRideMatched(ride, driver, rider) {
  const driverMsg = templates.rideMatched(ride, driver).driver;
  const riderMsg = templates.rideMatched(ride, driver).rider;
  
  const results = await Promise.all([
    notifyDriver(driver, driverMsg, { parse_mode: "Markdown" }),
    notifyRider(rider, riderMsg, { parse_mode: "Markdown" })
  ]);
  
  return { driver: results[0], rider: results[1] };
}

async function notifyNewRideRequest(drivers, ride) {
  const message = templates.newRideRequest(ride);
  const results = [];
  
  for (const driverInfo of drivers) {
    try {
      const result = await notifyDriver(driverInfo.driver, message, { parse_mode: "Markdown" });
      results.push({ driver: driverInfo.driver, result });
    } catch (err) {
      console.error("Failed to notify driver:", err);
      results.push({ driver: driverInfo.driver, error: err.message });
    }
  }
  
  return results;
}

async function notifyRideCancelled(ride, recipients) {
  const message = templates.rideCancelled(ride);
  const results = [];
  
  for (const recipient of recipients) {
    try {
      const isDriver = recipient.type === 'driver' || recipient.role === 'driver';
      const result = isDriver 
        ? await notifyDriver(recipient, message, { parse_mode: "Markdown" })
        : await notifyRider(recipient, message, { parse_mode: "Markdown" });
      results.push({ recipient, result });
    } catch (err) {
      console.error("Failed to notify about cancellation:", err);
      results.push({ recipient, error: err.message });
    }
  }
  
  return results;
}

async function notifyRideCompleted(ride, driver, rider) {
  const message = templates.rideCompleted(ride);
  
  const results = await Promise.all([
    notifyDriver(driver, message, { parse_mode: "Markdown" }),
    notifyRider(rider, message, { parse_mode: "Markdown" })
  ]);
  
  return { driver: results[0], rider: results[1] };
}

module.exports = {
  setBotInstance,
  setDriverBotInstance,
  setRiderBotInstance,
  sendTelegramMessage,
  notifyDriver,
  notifyRider,
  notifyRideMatched,
  notifyNewRideRequest,
  notifyRideCancelled,
  notifyRideCompleted,
  templates,
};
