/*
  driverBot.js - Dedicated Driver Bot with Command-based Interface
  Commands:
  - /start - Welcome message and registration
  - /me - Show driver profile information
  - /erase - Delete driver details (requires confirmation)
  - /update - Update driver details
  - /available - Set driver availability (start accepting rides)
  - /unavailable - Stop accepting rides
  - /rides - View active/past rides
  - /help - Show available commands
  
  Natural language processing for non-command messages using OpenAI
*/

const functions = require("firebase-functions");
const TelegramBot = require("node-telegram-bot-api");
const Driver = require("./models/driver");
const Ride = require("./models/ride");

const openai = require("./utils/openai");
const geocode = require("./utils/geocode");
const { distanceMiles } = require("./utils/distance");
const db = require("./utils/database");
const matching = require("./utils/matching");
const notifications = require("./utils/notifications");
const { assertSingleOpen, sanitizeCrudPayload } = require("./utils/guards");
const state = require("./utils/state");
const admin = require("firebase-admin");

// Helper function for typing indicators
async function showTyping(bot, chatId, duration = 5000) {
  try {
    await bot.sendChatAction(chatId, 'typing');
    // Auto-refresh typing indicator every 5 seconds if processing takes longer
    const interval = setInterval(async () => {
      try {
        await bot.sendChatAction(chatId, 'typing');
      } catch (err) {
        clearInterval(interval);
      }
    }, duration);
    
    // Return cleanup function
    return () => clearInterval(interval);
  } catch (err) {
    console.error("Error showing typing indicator:", err);
    return () => {}; // Return no-op cleanup
  }
}

// SAFE CRUD operations for drivers
const DRIVER_CRUD = {
  findUserByTelegramId: db.findUserByTelegramId,
  findDriverByTelegramId: db.findDriverByTelegramId,
  createDriver: db.createDriver,
  updateDriver: db.updateDriver,
  setDriverAvailability: db.setDriverAvailability,
  closeDriverAvailability: db.closeDriverAvailability,
  getOpenAvailabilityByDriver: db.getOpenAvailabilityByDriver,
  listOpenRideRequests: db.listOpenRideRequests,
  setRideMatched: db.setRideMatched,
  acceptRide: db.acceptRide,
  completeRide: db.completeRide,
  cancelRide: db.cancelRide,
  getRidesByUser: db.getRidesByUser,
  deleteDriver: db.deleteDriver,
  getUserStats: db.getUserStats,
  clearUserCache: db.clearUserCache,
};

async function performDriverCrud(action, payload) {
  const fn = DRIVER_CRUD[action];
  if (!fn) throw new Error(`Driver CRUD not permitted: ${action}`);
  const safePayload = sanitizeCrudPayload(action, payload);
  return fn(safePayload);
}

// Utility functions
function safeNumber(n, min = 0) {
  const val = Number(n);
  return Number.isFinite(val) && val >= min ? val : null;
}

async function sendError(chatId, err, hint) {
  console.error("DRIVER_BOT_ERROR", { hint, err: err?.stack || err?.message || err });
  try {
    await driverBot.sendMessage(chatId, `⚠️ Oops. ${hint || "Something went wrong."}`);
  } catch (_) {}
}

// Registration keyboard
const regKb = {
  reply_markup: {
    inline_keyboard: [
      [{ text: "Register as Driver", callback_data: "register_driver" }],
    ],
  },
};

// Main menu keyboard for drivers
function getDriverMainMenu() {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "🟢 Go Available", callback_data: "go_available" },
          { text: "🔴 Go Unavailable", callback_data: "go_unavailable" }
        ],
        [
          { text: "👤 My Profile", callback_data: "view_profile" },
          { text: "🚗 My Rides", callback_data: "view_rides" }
        ],
        [
          { text: "✏️ Update Details", callback_data: "update_details" },
          { text: "❓ Help", callback_data: "show_help" }
        ]
      ],
    },
  };
}

// Ride menu for available drivers
function getRideMenu(rideCount) {
  const rows = [];
  for (let i = 0; i < rideCount; i++) {
    rows.push([{ text: `🚗 Accept Ride ${i + 1}`, callback_data: `accept_ride_${i + 1}` }]);
  }
  rows.push([{ text: "🔄 Refresh", callback_data: "refresh_rides" }]);
  rows.push([{ text: "🔴 Go Unavailable", callback_data: "go_unavailable" }]);
  return { reply_markup: { inline_keyboard: rows } };
}

// Helper functions
async function ensureDriverRegistered(ctx) {
  const tgId = ctx.from.id.toString();
  const found = await performDriverCrud("findDriverByTelegramId", tgId);
  if (!found || found.type !== "driver") {
    await driverBot.sendMessage(ctx.chat.id, "👋 Welcome to RideEase Driver Bot!\n\nPlease register as a driver to continue.", regKb);
    return null;
  }
  return found;
}

function summarizeRide(ride, distanceMi) {
  const when = new Date(ride.rideTime || ride.timeOfRide).toLocaleString();
  const dist = typeof distanceMi === "number" ? ` • ~${distanceMi.toFixed(1)} mi` : "";
  const bid = ride.bid != null ? `\nBid: $${ride.bid}` : "";
  return `📍 Pickup: ${ride.pickup?.name || ride.pickupLocationName}\n📍 Drop: ${ride.dropoff?.name || ride.dropLocationName}\n🕐 Time: ${when}${dist}${bid}`;
}

async function showDriverRideMenu(ctx, availability) {
  const matches = await matching.findMatchesForDriverAvailability(availability);
  if (!matches.length) {
    await driverBot.sendMessage(ctx.chat.id, "🔍 No rides available right now. I'll notify you when new rides come up!");
    return;
  }
  
  const lines = matches
    .map((m, i) => `🚗 **Ride ${i + 1}:**\n${summarizeRide(m.ride, m.distanceMi)}`)
    .join("\n\n");
    
  await driverBot.sendMessage(ctx.chat.id, `📋 Available Rides:\n\n${lines}`, {
    parse_mode: "Markdown",
    ...getRideMenu(matches.length)
  });
}

// Command handlers
function setupDriverCommands(bot) {
  // /start command
  bot.onText(/^\/start$/, async (msg) => {
    try {
      const found = await ensureDriverRegistered(msg);
      if (!found) return;
      
      await bot.sendMessage(
        msg.chat.id,
        `🚗 Welcome back, ${found.user.name || 'Driver'}!\n\nWhat would you like to do?`,
        getDriverMainMenu()
      );
    } catch (err) {
      await sendError(msg.chat.id, err, "Start command failed.");
    }
  });

  // /me command - Show profile
  bot.onText(/^\/me$/, async (msg) => {
    try {
      const user = await performDriverCrud("findDriverByTelegramId", msg.from.id.toString());
      if (!user?.user) {
        return bot.sendMessage(msg.chat.id, "❌ Driver profile not found. Please register first.", regKb);
      }

      let profileText = `👤 **Driver Profile**\n\n`;
      profileText += `📝 **Name:** ${user.user.name || "Not set"}\n`;
      profileText += `📞 **Phone:** ${user.user.phoneNumber || "Not set"}\n`;
      profileText += `🌍 **Ride Area:** ${user.user.rideArea || "Not set"}\n`;
      profileText += `🔢 **License Plate:** ${user.user.licensePlateNumber || "Not set"}\n`;
      profileText += `🎨 **Vehicle Color:** ${user.user.vehicleColour || "Not set"}\n`;
      profileText += `⭐ **Rating:** ${user.user.rating || 0}/5\n`;
      profileText += `📊 **Total Rides:** ${user.user.pastRidesIds?.length || 0}\n`;
      
      if (user.user.availability) {
        profileText += `\n🟢 **Status:** Available\n`;
        if (user.user.availableLocation?.coordinates) {
          profileText += `📍 **Current Location:** Set\n`;
        }
        if (user.user.myRadiusOfAvailabilityMiles) {
          profileText += `📏 **Service Radius:** ${user.user.myRadiusOfAvailabilityMiles} miles\n`;
        }
      } else {
        profileText += `\n🔴 **Status:** Not available\n`;
      }

      profileText += `\n📅 **Member since:** ${new Date(user.user.createdAt).toLocaleDateString()}\n`;

      await bot.sendMessage(msg.chat.id, profileText, { 
        parse_mode: "Markdown",
        ...getDriverMainMenu()
      });
    } catch (err) {
      await sendError(msg.chat.id, err, "Couldn't fetch your profile.");
    }
  });

  // /erase command - Delete driver profile
  bot.onText(/^\/erase$/, async (msg) => {
    try {
      const found = await ensureDriverRegistered(msg);
      if (!found) return;

      const confirmKb = {
        reply_markup: {
          inline_keyboard: [
            [
              { text: "✅ Yes, Delete", callback_data: "confirm_delete" },
              { text: "❌ Cancel", callback_data: "cancel_delete" }
            ]
          ],
        },
      };

      await bot.sendMessage(
        msg.chat.id,
        "⚠️ **WARNING**\n\nThis will permanently delete your driver profile and all associated data. This action cannot be undone.\n\nAre you sure you want to continue?",
        { parse_mode: "Markdown", ...confirmKb }
      );
    } catch (err) {
      await sendError(msg.chat.id, err, "Delete command failed.");
    }
  });

  // /update command - Update driver details
  bot.onText(/^\/update$/, async (msg) => {
    try {
      const found = await ensureDriverRegistered(msg);
      if (!found) return;

      state.set(msg.from.id.toString(), { phase: "update_driver" });
      await bot.sendMessage(
        msg.chat.id,
        "✏️ **Update Driver Details**\n\nSend the updated information in this format:\n\n`Name | Phone | Telegram Username | Ride Area | License Plate | Vehicle Color`\n\nOr just tell me what you'd like to update (e.g., \"Update my phone to 555-0123\")",
        { parse_mode: "Markdown" }
      );
    } catch (err) {
      await sendError(msg.chat.id, err, "Update command failed.");
    }
  });

  // /available command - Set availability
  bot.onText(/^\/available$/, async (msg) => {
    try {
      const found = await ensureDriverRegistered(msg);
      if (!found) return;

      // Check if already available
      const currentAvailability = await performDriverCrud("getOpenAvailabilityByDriver", found.user._id);
      if (currentAvailability) {
        return bot.sendMessage(msg.chat.id, "🟢 You're already available! Use /unavailable to stop accepting rides.");
      }

      state.set(msg.from.id.toString(), { phase: "set_availability" });
      await bot.sendMessage(
        msg.chat.id,
        "🟢 **Set Your Availability**\n\nTell me your location and service details:\n\n• Example: \"I'm available at 1251 E Sunrise Blvd, Fort Lauderdale, radius 10 miles, for 3 hours\"\n• Or just send your address and I'll ask for the details",
        { parse_mode: "Markdown" }
      );
    } catch (err) {
      await sendError(msg.chat.id, err, "Available command failed.");
    }
  });

  // /unavailable command - Stop availability
  bot.onText(/^\/unavailable$/, async (msg) => {
    try {
      const found = await ensureDriverRegistered(msg);
      if (!found) return;

      const availability = await performDriverCrud("getOpenAvailabilityByDriver", found.user._id);
      if (!availability) {
        return bot.sendMessage(msg.chat.id, "🔴 You're already unavailable.");
      }

      await performDriverCrud("closeDriverAvailability", availability._id);
      await bot.sendMessage(
        msg.chat.id,
        "🔴 **Availability Closed**\n\nYou're no longer accepting new rides. Use /available when you're ready to drive again!",
        { parse_mode: "Markdown", ...getDriverMainMenu() }
      );
    } catch (err) {
      await sendError(msg.chat.id, err, "Unavailable command failed.");
    }
  });

  // /rides command - View rides
  bot.onText(/^\/rides$/, async (msg) => {
    try {
      const found = await ensureDriverRegistered(msg);
      if (!found) return;

      const rides = await performDriverCrud("getRidesByUser", found.user._id, "driver");
      if (!rides || rides.length === 0) {
        return bot.sendMessage(
          msg.chat.id,
          "🚗 **No Rides Yet**\n\nYou haven't completed any rides. Use /available to start accepting ride requests!",
          { parse_mode: "Markdown", ...getDriverMainMenu() }
        );
      }

      let ridesList = `🚗 **Your Rides (${rides.length})**\n\n`;
      rides.slice(0, 10).forEach((ride, index) => {
        const status = ride.status.toUpperCase();
        const time = ride.timeOfRide ? new Date(ride.timeOfRide).toLocaleString() : 'ASAP';
        const statusEmoji = {
          'COMPLETED': '✅',
          'MATCHED': '🔄',
          'OPEN': '🟡',
          'CANCELLED': '❌',
          'FAILED': '❌'
        }[status] || '❓';
        
        ridesList += `${statusEmoji} **Ride ${index + 1}** (${status})\n`;
        ridesList += `   📍 ${ride.pickupLocationName} → ${ride.dropLocationName}\n`;
        ridesList += `   🕐 ${time}\n`;
        if (ride.bid) ridesList += `   💰 $${ride.bid}\n`;
        ridesList += `\n`;
      });

      if (rides.length > 10) {
        ridesList += `... and ${rides.length - 10} more rides.`;
      }

      await bot.sendMessage(msg.chat.id, ridesList, { 
        parse_mode: "Markdown",
        ...getDriverMainMenu()
      });
    } catch (err) {
      await sendError(msg.chat.id, err, "Rides command failed.");
    }
  });

  // /help command - Show help
  bot.onText(/^\/help$/, async (msg) => {
    try {
      const helpText = `🚗 **Driver Bot Commands**\n\n` +
        `**Basic Commands:**\n` +
        `• /start - Show main menu\n` +
        `• /me - View your profile\n` +
        `• /help - Show this help message\n\n` +
        `**Availability Commands:**\n` +
        `• /available - Start accepting rides\n` +
        `• /unavailable - Stop accepting rides\n\n` +
        `**Profile Management:**\n` +
        `• /update - Update your details\n` +
        `• /erase - Delete your profile\n` +
        `• /rides - View your rides\n\n` +
        `**Natural Language:**\n` +
        `Just tell me what you want to do! For example:\n` +
        `• "I'm available at Main Street, 5 mile radius, for 2 hours"\n` +
        `• "Update my phone number to 555-0123"\n` +
        `• "I'm done for today"\n\n` +
        `I'll understand and help you with the right commands! 🤖`;

      await bot.sendMessage(msg.chat.id, helpText, { 
        parse_mode: "Markdown",
        ...getDriverMainMenu()
      });
    } catch (err) {
      await sendError(msg.chat.id, err, "Help command failed.");
    }
  });

  // /clearcache command - Clear user's cache
  bot.onText(/^\/clearcache$/, async (msg) => {
    try {
      const found = await ensureDriverRegistered(msg);
      if (!found) return;

      const result = await performDriverCrud("clearUserCache", msg.from.id.toString());
      if (result.success) {
        await bot.sendMessage(
          msg.chat.id,
          "🧹 **Cache Cleared**\n\nYour session cache has been cleared. This should resolve any stuck states or outdated information.",
          { parse_mode: "Markdown", ...getDriverMainMenu() }
        );
      } else {
        await bot.sendMessage(msg.chat.id, "❌ Failed to clear cache. Please try again.");
      }
    } catch (err) {
      await sendError(msg.chat.id, err, "Cache clearing failed.");
    }
  });
}

// Callback query handlers
function setupDriverCallbacks(bot) {
  bot.on("callback_query", async (cbq) => {
    const data = cbq.data;
    const chatId = cbq.message.chat.id;
    const tgId = cbq.from.id.toString();
    
    try {
      // Registration
      if (data === "register_driver") {
        state.set(tgId, { phase: "register_driver" });
        await bot.sendMessage(
          chatId,
          "🚗 **Driver Registration**\n\nPlease send your details in this format:\n\n`Name | Phone | Telegram Username | Ride Area | License Plate | Vehicle Color`\n\n**Example:**\n`John Smith | 555-0123 | @johnsmith | Fort Lauderdale Area | ABC123 | Blue Honda`",
          { parse_mode: "Markdown" }
        );
        return bot.answerCallbackQuery(cbq.id);
      }

      // Main menu actions
      if (data === "go_available") {
        const found = await ensureDriverRegistered({ from: cbq.from, chat: { id: chatId } });
        if (!found) return bot.answerCallbackQuery(cbq.id);

        state.set(tgId, { phase: "set_availability" });
        await bot.sendMessage(
          chatId,
          "🟢 **Set Your Availability**\n\nTell me your location and service details:\n\n• Example: \"I'm available at 1251 E Sunrise Blvd, Fort Lauderdale, radius 10 miles, for 3 hours\"\n• Or just send your address and I'll ask for the details",
          { parse_mode: "Markdown" }
        );
        return bot.answerCallbackQuery(cbq.id);
      }

      if (data === "go_unavailable") {
        const found = await ensureDriverRegistered({ from: cbq.from, chat: { id: chatId } });
        if (!found) return bot.answerCallbackQuery(cbq.id);

        const availability = await performDriverCrud("getOpenAvailabilityByDriver", found.user._id);
        if (!availability) {
          await bot.sendMessage(chatId, "🔴 You're already unavailable.");
        } else {
          await performDriverCrud("closeDriverAvailability", availability._id);
          await bot.sendMessage(
            chatId,
            "🔴 **Availability Closed**\n\nYou're no longer accepting new rides.",
            { parse_mode: "Markdown" }
          );
        }
        return bot.answerCallbackQuery(cbq.id);
      }

      // Accept ride from menu
      const acceptRide = data.match(/^accept_ride_(\d+)$/);
      if (acceptRide) {
        const idx = parseInt(acceptRide[1], 10);
        const user = await performDriverCrud("findDriverByTelegramId", tgId);
        if (!user?.user || user.type !== "driver") return bot.answerCallbackQuery(cbq.id);
        
        const availability = await performDriverCrud("getOpenAvailabilityByDriver", user.user._id);
        if (!availability) {
          await bot.sendMessage(chatId, "❌ No active availability found.");
          return bot.answerCallbackQuery(cbq.id);
        }

        const matches = await matching.findMatchesForDriverAvailability(availability);
        const selectedMatch = matches[idx - 1];
        if (!selectedMatch) {
          await bot.sendMessage(chatId, "❌ That ride is no longer available.");
          return bot.answerCallbackQuery(cbq.id);
        }

        const ride = selectedMatch.ride;
        await performDriverCrud("setRideMatched", { rideId: ride._id, driverId: user.user._id });
        await performDriverCrud("closeDriverAvailability", availability._id);
        
        // Notify both parties
        const driver = user.user;
        const rider = await db.findById("riders", ride.riderId);
        
        await bot.sendMessage(
          chatId,
          `✅ **Ride Accepted!**\n\n${summarizeRide(ride)}\n\nRider contact: @${rider?.telegramUsername || rider?.username || "(no username)"}`,
          { parse_mode: "Markdown" }
        );

        // Notify rider (assuming we have access to rider notification)
        if (notifications.notifyRider) {
          await notifications.notifyRider(
            rider,
            `🚗 **Driver Found!**\n\nYour ride has been accepted.\nDriver contact: @${driver.telegramUsername || driver.username || "(no username)"}\n\n${summarizeRide(ride)}`
          );
        }

        return bot.answerCallbackQuery(cbq.id);
      }

      // Refresh rides menu
      if (data === "refresh_rides") {
        const user = await performDriverCrud("findDriverByTelegramId", tgId);
        if (user?.type === "driver") {
          const availability = await performDriverCrud("getOpenAvailabilityByDriver", user.user._id);
          if (!availability) {
            await bot.sendMessage(chatId, "❌ No active availability.");
          } else {
            await showDriverRideMenu({ chat: { id: chatId } }, availability);
          }
        }
        return bot.answerCallbackQuery(cbq.id);
      }

      // Delete confirmation
      if (data === "confirm_delete") {
        const user = await performDriverCrud("findDriverByTelegramId", tgId);
        if (user?.user) {
          await performDriverCrud("deleteDriver", user.user._id);
          await bot.sendMessage(
            chatId,
            "✅ **Profile Deleted**\n\nYour driver profile has been permanently deleted. Thank you for using RideEase!\n\nIf you want to drive again, just send /start to register."
          );
        }
        return bot.answerCallbackQuery(cbq.id);
      }

      if (data === "cancel_delete") {
        await bot.sendMessage(chatId, "❌ **Deletion Cancelled**\n\nYour profile is safe!", getDriverMainMenu());
        return bot.answerCallbackQuery(cbq.id);
      }

      return bot.answerCallbackQuery(cbq.id);
    } catch (err) {
      await sendError(chatId, err, "Action failed.");
      try { await bot.answerCallbackQuery(cbq.id); } catch (_) {}
    }
  });
}

// Message handlers for natural language processing
function setupDriverMessageHandlers(bot) {
  bot.on("message", async (msg) => {
    try {
      if (!msg.text || msg.via_bot || msg.edit_date) return;
      if (msg.text.startsWith('/')) return; // Skip commands
      
      const tgId = msg.from.id.toString();
      const text = openai.sanitizeInput(msg.text.trim());
      const st = state.get(tgId);

      // Handle registration
      if (st?.phase === "register_driver") {
        const parts = text.split("|").map(s => s.trim());
        if (parts.length < 6) {
          return bot.sendMessage(
            msg.chat.id,
            "❌ Please send all 6 required fields:\n`Name | Phone | Telegram Username | Ride Area | License Plate | Vehicle Color`",
            { parse_mode: "Markdown" }
          );
        }
        
        const [name, phoneNumber, telegramUsername, rideArea, licensePlateNumber, vehicleColour] = parts;
        
        const result = await performDriverCrud("createDriver", {
          name,
          phoneNumber, 
          telegramId: tgId, 
          telegramUsername, 
          rideArea, 
          licensePlateNumber, 
          vehicleColour
        });
        
        if (!result?.success) {
          return bot.sendMessage(msg.chat.id, `❌ Registration failed: ${result?.error || "unknown error"}`);
        }
        
        state.clear(tgId);
        await bot.sendMessage(
          msg.chat.id,
          `✅ **Welcome to RideEase, ${name}!**\n\nYou're all set as a driver. Use /available when you're ready to start accepting rides!`,
          { parse_mode: "Markdown", ...getDriverMainMenu() }
        );
        return;
      }

      // Handle availability setting
      if (st?.phase === "set_availability") {
        await handleAvailabilitySetting(bot, msg, text);
        return;
      }

      // Handle update phase
      if (st?.phase === "update_driver") {
        await handleDriverUpdate(bot, msg, text);
        return;
      }

      // Ensure registered for other messages
      const found = await ensureDriverRegistered(msg);
      if (!found) return;

      // Show typing indicator while processing
      const clearTyping = await showTyping(bot, msg.chat.id);

      try {
        // Process with OpenAI for intent detection
        const intent = await openai.detectIntent(text, "driver");
        clearTyping();
        await handleDriverIntent(bot, msg, intent, found);
      } catch (err) {
        clearTyping();
        throw err;
      }

    } catch (err) {
      await sendError(msg.chat.id, err, "Message processing failed.");
    }
  });
}

async function handleAvailabilitySetting(bot, msg, text) {
  const tgId = msg.from.id.toString();
  
  try {
    // Show typing indicator while processing intent
    const clearTyping = await showTyping(bot, msg.chat.id);
    
    const intent = await openai.detectIntent(text, "driver");
    clearTyping();
    
    if (intent?.type === "driver_availability") {
      const { address, radiusMiles, hours } = intent.fields || {};
      
      if (!address || !radiusMiles) {
        return bot.sendMessage(
          msg.chat.id,
          "❌ I need your address and service radius. Try:\n\"I'm available at [your address], radius [X] miles, for [Y] hours\""
        );
      }

      // Geocode address
      let center;
      const clearGeoTyping = await showTyping(bot, msg.chat.id);
      try {
        center = await geocode.geocodeAddress(address);
        clearGeoTyping();
      } catch (err) {
        clearGeoTyping();
        return bot.sendMessage(msg.chat.id, "❌ Couldn't find that address. Please try a more specific address.");
      }

      if (!center) {
        return bot.sendMessage(msg.chat.id, "❌ Couldn't locate that address. Please try again.");
      }

      const user = await performDriverCrud("findDriverByTelegramId", tgId);
      const availability = await performDriverCrud("setDriverAvailability", {
        telegramId: tgId,
        isAvailable: true,
        currentLocation: { type: "Point", coordinates: [center.lon, center.lat] },
        radiusMiles: radiusMiles
      });

      if (!availability?.success) {
        return bot.sendMessage(msg.chat.id, `❌ Failed to set availability: ${availability?.error || "unknown error"}`);
      }

      state.clear(tgId);
      await bot.sendMessage(
        msg.chat.id,
        `🟢 **You're Now Available!**\n\n📍 Location: ${center.name}\n📏 Radius: ${radiusMiles} miles\n⏰ Duration: ${hours || 'until you go unavailable'} hours\n\nLooking for rides nearby...`,
        { parse_mode: "Markdown" }
      );

      // Show available rides
      setTimeout(() => showDriverRideMenu(msg, availability.data), 1000);
      
      // TODO: Schedule closeAvailabilityTask at endsAt when task system is ready
      // const endsAt = Date.now() + (hours || 1) * 60 * 60 * 1000;
      // await enqueueTask("closeAvailabilityTask", { driverId: availability.data._id.toString() }, endsAt);
      
    } else {
      await bot.sendMessage(
        msg.chat.id,
        "❌ I didn't understand that. Please tell me:\n• Your location/address\n• Service radius in miles\n• How long you'll be available\n\nExample: \"I'm available at Downtown Miami, 10 miles radius, for 4 hours\""
      );
    }
  } catch (err) {
    await sendError(msg.chat.id, err, "Availability setting failed.");
    state.clear(tgId);
  }
}

async function handleDriverUpdate(bot, msg, text) {
  const tgId = msg.from.id.toString();
  
  try {
    // Show typing indicator while processing
    const clearTyping = await showTyping(bot, msg.chat.id);
    
    // Check if it's pipe-delimited format
    if (text.includes('|')) {
      clearTyping();
      const parts = text.split("|").map(s => s.trim());
      if (parts.length >= 6) {
        const [name, phoneNumber, telegramUsername, rideArea, licensePlateNumber, vehicleColour] = parts;
        const result = await performDriverCrud("updateDriver", {
          telegramId: tgId,
          updates: { name, phoneNumber, telegramUsername, rideArea, licensePlateNumber, vehicleColour }
        });
        
        if (result?.success) {
          state.clear(tgId);
          await bot.sendMessage(
            msg.chat.id,
            "✅ **Profile Updated!**\n\nAll your details have been updated successfully.",
            { parse_mode: "Markdown", ...getDriverMainMenu() }
          );
        } else {
          await bot.sendMessage(msg.chat.id, `❌ Update failed: ${result?.error || "unknown error"}`);
        }
        return;
      }
    }

    // Use OpenAI to understand the update request
    const clearTyping2 = await showTyping(bot, msg.chat.id);
    const updateIntent = await openai.detectIntent(text, "driver_update");
    clearTyping2();
    
    if (updateIntent?.fields) {
      const result = await performDriverCrud("updateDriver", {
        telegramId: tgId,
        updates: updateIntent.fields
      });
      
      if (result?.success) {
        state.clear(tgId);
        await bot.sendMessage(
          msg.chat.id,
          "✅ **Profile Updated!**\n\nYour details have been updated successfully.",
          { parse_mode: "Markdown", ...getDriverMainMenu() }
        );
      } else {
        await bot.sendMessage(msg.chat.id, `❌ Update failed: ${result?.error || "unknown error"}`);
      }
    } else {
      await bot.sendMessage(
        msg.chat.id,
        "❌ I didn't understand what you want to update. Try:\n• \"Update my phone to 555-0123\"\n• \"Change my ride area to Miami-Dade\"\n\nOr send all details: `Name | Phone | Username | Area | License | Color`"
      );
    }
  } catch (err) {
    await sendError(msg.chat.id, err, "Update failed.");
    state.clear(tgId);
  }
}

async function handleDriverIntent(bot, msg, intent, found) {
  switch (intent?.type) {
    case "driver_availability":
    case "driver_availability":
      // Set availability
      const { address, radiusMiles, hours } = intent.fields || {};
      if (!address || !radiusMiles) {
        return bot.sendMessage(
          msg.chat.id,
          "❌ I need your address and service radius. Try:\n\"I'm available at [address], radius [X] miles, for [Y] hours\""
        );
      }
      
      // Note: Removed assertSingleOpen for now - should be implemented if needed
      
      let center;
      try {
        center = await geocode.geocodeAddress(address);
      } catch (err) {
        return bot.sendMessage(msg.chat.id, "❌ Couldn't find that address. Please try a more specific address.");
      }

      const availability = await performDriverCrud("setDriverAvailability", {
        telegramId: msg.from.id.toString(),
        isAvailable: true,
        currentLocation: { type: "Point", coordinates: [center.lon, center.lat] },
        radiusMiles: radiusMiles
      });

      if (!availability?.success) {
        return bot.sendMessage(msg.chat.id, `❌ Failed to set availability: ${availability?.error || "unknown error"}`);
      }

      await bot.sendMessage(
        msg.chat.id,
        `🟢 **You're Now Available!**\n\n📍 ${center.name}\n📏 ${radiusMiles} miles radius\n⏰ ${hours || 'Until you go unavailable'} hours`,
        { parse_mode: "Markdown" }
      );

      return showDriverRideMenu(msg, availability.data);

    case "availability_off":
      const av = await performDriverCrud("getOpenAvailabilityByDriver", found.user._id);
      if (!av) {
        return bot.sendMessage(msg.chat.id, "🔴 You're already unavailable.");
      }
      await performDriverCrud("closeDriverAvailability", av._id);
      return bot.sendMessage(
        msg.chat.id,
        "🔴 **Availability Closed**\n\nYou're no longer accepting new rides.",
        { parse_mode: "Markdown", ...getDriverMainMenu() }
      );

    case "help":
    default:
      const helpText = intent?.helpText || openai.getHelpText?.("driver") || 
        "🤖 **I'm here to help!**\n\n" +
        "You can:\n" +
        "• Tell me when you want to be available\n" +
        "• Ask me to update your details\n" +
        "• Ask about your rides\n" +
        "• Use commands like /available, /me, /rides\n\n" +
        "Just talk to me naturally! I'll understand what you need.";
      
      return bot.sendMessage(msg.chat.id, helpText, {
        parse_mode: "Markdown",
        ...getDriverMainMenu()
      });
  }
}

// Initialize driver bot
let driverBot;
let driverWired = false;

function initDriverBot() {
  if (driverBot) return driverBot;
  
  const token = process.env.TELEGRAM_BOT_TOKEN_DRIVER;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN_DRIVER not set");

  const usePolling = !process.env.FUNCTIONS_EMULATOR && process.env.NODE_ENV !== "production";
  driverBot = new TelegramBot(token, { polling: usePolling });

  // Set bot instance for notifications
  try {
    require("./utils/notifications").setDriverBotInstance(driverBot);
  } catch (_) {}

  if (!driverWired) {
    setupDriverCommands(driverBot);
    setupDriverCallbacks(driverBot);
    setupDriverMessageHandlers(driverBot);
    driverWired = true;
  }

  return driverBot;
}

// Export for webhook
module.exports = {
  processUpdate: async (update) => {
    const bot = initDriverBot();
    return bot.processUpdate(update);
  },
  initDriverBot
};
