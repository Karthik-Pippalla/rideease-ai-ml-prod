// utils/notifications.js
// Centralized Telegram notification system

// Designed to work with separate driver and rider bots.
const { formatDateTime } = require('./dateParser');

let driverBot = null;
let riderBot = null;
let legacyBot = null; // For backwards compatibility

// Function to set legacy bot instance (for backwards compatibility)
function setBotInstance(bot) {
  legacyBot = bot;
}

// Function to set driver bot instance
function setDriverBotInstance(bot) {
  driverBot = bot;
}

// Function to set rider bot instance  
function setRiderBotInstance(bot) {
  riderBot = bot;
}

async function notifyDriverRideAccepted(driver, ride, rider, buttons = null) {
  const message = `✅ **Ride Accepted!**\n\n` +
    `📍 **Pickup:** ${ride.pickupLocationName || ride.pickup?.name}\n` +
    `📍 **Drop:** ${ride.dropLocationName || ride.dropoff?.name}\n` +
    `🕐 **Time:** ${ride.rideTime ? formatDateTime(new Date(ride.rideTime)) : (ride.timeOfRide ? formatDateTime(new Date(ride.timeOfRide)) : 'ASAP')}\n` +
    `💰 **Bid:** $${ride.bid || 0}\n\n` +
    `👤 **Rider Contact:** @${rider?.telegramUsername || rider?.username || "(no username)"}\n` +
    `📞 **Phone:** ${rider?.phoneNumber || "Contact via Telegram"}\n\n` +
    `⚠️ **Important Notice:**\n` +
    `• You cannot go /available until this ride is completed or canceled\n` +
    `• **MUST** use /completed button after ride is finished\n` +
    `• **MUST** use /canceled button if ride gets cancelled\n` +
    `• Failure to mark completion will result in automatic cancellation\n\n` +
    `📝 **Instructions:**\n` +
    `• Contact rider for coordination\n` +
    `• Use /completed or /canceled when appropriate`;
  
  const options = { parse_mode: "Markdown", ...(buttons || {}) };
  return await notifyDriver(driver, message, options);
}

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

// Notify driver when they accept a ride
async function notifyDriverRideAccepted(driver, ride, rider) {
  const message = `✅ **Ride Accepted!**\n\n` +
    `📍 **Pickup:** ${ride.pickupLocationName || ride.pickup?.name}\n` +
    `📍 **Drop:** ${ride.dropLocationName || ride.dropoff?.name}\n` +
    `� **Time:** ${ride.rideTime ? formatDateTime(new Date(ride.rideTime)) : (ride.timeOfRide ? formatDateTime(new Date(ride.timeOfRide)) : 'ASAP')}\n` +
    `💰 **Bid:** $${ride.bid || 0}\n\n` +
    `👤 **Rider Contact:** @${rider?.telegramUsername || rider?.username || "(no username)"}\n` +
    `📞 **Phone:** ${rider?.phoneNumber || "Contact via Telegram"}\n\n` +
    `📝 **Instructions:**\n` +
    `• After ride completed, use /completed command\n` +
    `• If ride gets cancelled, use /canceled command`;
  
  return await notifyDriver(driver, message, { parse_mode: "Markdown" });
}

// Notify rider when their ride is accepted by a driver
async function notifyRiderDriverAccepted(rider, ride, driver) {
  const message = `✅ **Great News! Your Ride Has Been Accepted!**\n\n` +
    `🚗 **Driver:** ${driver?.name || "Driver"}\n` +
    `⭐ **Rating:** ${driver?.rating ? `${driver.rating}/5` : "New driver"}\n` +
    `📞 **Contact:** @${driver?.telegramUsername || driver?.username || "(no username)"}\n` +
    `📱 **Phone:** ${driver?.phoneNumber || "Contact via Telegram"}\n\n` +
    `📍 **Pickup:** ${ride.pickupLocationName || ride.pickup?.name}\n` +
    `📍 **Drop:** ${ride.dropLocationName || ride.dropoff?.name}\n` +
    `🕐 **Time:** ${ride.rideTime ? formatDateTime(new Date(ride.rideTime)) : (ride.timeOfRide ? formatDateTime(new Date(ride.timeOfRide)) : 'ASAP')}\n` +
    `💰 **Amount:** $${ride.bid || 0}\n\n` +
    `🚀 **Your driver will contact you shortly for pickup!**`;
  
  return await notifyRider(rider, message, { parse_mode: "Markdown" });
}

// Helper function to create ride completion buttons
function getRideCompletionButtons() {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "✅ Mark Completed", callback_data: "mark_completed" },
          { text: "📋 View Ride Details", callback_data: "view_ride_details" }
        ],
        [
          { text: "🏠 Main Menu", callback_data: "main_menu" }
        ]
      ],
    },
  };
}

// Template messages for common notifications
const templates = {
  newRideRequest: (ride, distance) => 
    `🚗 **Driver: New Ride Request Available**\n\n` +
    `📍 Near you (~${distance?.toFixed?.(1) || "?"} miles):\n\n` +
    `• Pickup: ${ride.pickupLocationName}\n` +
    `• Drop-off: ${ride.dropLocationName}\n` +
    `• Time: ${new Date(ride.timeOfRide).toLocaleString()}${ride.bid ? `\n• Payment: $${ride.bid}` : ""}\n\n` +
    `🚗 **As a DRIVER:** Use /available to start accepting rides!\n\n` +
    `⏱️ *Response time: 3-45 seconds due to AI processing*`,
  
  rideCancelled: (ride) =>
    `❌ **Ride Cancelled**\n\n` +
    `📍 ${ride.pickupLocationName} → ${ride.dropLocationName}\n` +
    `🕐 ${new Date(ride.timeOfRide).toLocaleString()}\n\n` +
    `The ride has been cancelled. You can now request/accept new rides.\n\n` +
    `⏱️ *Response time: 3-45 seconds due to AI processing*`,
    
  rideCompleted: (ride) =>
    `✅ **Ride Completed Successfully**\n\n` +
    `📍 ${ride.pickupLocationName} → ${ride.dropLocationName}\n` +
    `🕐 ${new Date(ride.timeOfRide).toLocaleString()}\n` +
    `💰 ${ride.bid ? `$${ride.bid}` : "No payment amount"}\n\n` +
    `Thank you for using RideEase! You can now request/accept new rides.\n\n` +
    `⏱️ *Response time: 3-45 seconds due to AI processing*`
};

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

// New function to send ride time reminders about restrictions and auto-cancellation
async function notifyRideTimeRestrictions(driver, rider, ride) {
  const reminderMessage = `🕐 **Ride Time Reminder**\n\n` +
    `📍 **Route:** ${ride.pickupLocationName} → ${ride.dropLocationName}\n` +
    `💰 **Amount:** $${ride.bid}\n\n` +
    `⚠️ **Important Reminders:**\n` +
    `• Driver: Cannot go /available until ride completed or canceled\n` +
    `• Rider: Cannot request new rides until this one is finished\n` +
    `• **MUST** use /completed or /canceled buttons when appropriate\n\n` +
    `🤖 **Auto-Cancellation Warning:**\n` +
    `If no action is taken (completed/canceled), this ride will be **automatically canceled by our system** after 24 hours to prevent indefinite blocking.\n\n` +
    `Please coordinate and complete your ride properly!`;

  const results = [];
  
  // Notify driver
  try {
    const driverResult = await notifyDriver(driver, reminderMessage, { parse_mode: "Markdown" });
    results.push({ type: 'driver', result: driverResult });
  } catch (err) {
    console.error("Failed to send ride time reminder to driver:", err);
    results.push({ type: 'driver', error: err.message });
  }
  
  // Notify rider  
  try {
    const riderResult = await notifyRider(rider, reminderMessage, { parse_mode: "Markdown" });
    results.push({ type: 'rider', result: riderResult });
  } catch (err) {
    console.error("Failed to send ride time reminder to rider:", err);
    results.push({ type: 'rider', error: err.message });
  }
  
  return results;
}

function getRiderBotInstance() {
  return riderBot || legacyBot;
}

function getDriverBotInstance() {
  return driverBot || legacyBot;
}

module.exports = {
  setBotInstance,
  setDriverBotInstance,
  setRiderBotInstance,
  getRiderBotInstance,
  getDriverBotInstance,
  sendTelegramMessage,
  notifyDriver,
  notifyRider,
  notifyDriverRideAccepted,
  notifyRiderDriverAccepted,
  notifyNewRideRequest,
  notifyRideCancelled,
  notifyRideCompleted,
  notifyRideTimeRestrictions,
  templates,
  getRideCompletionButtons
};
