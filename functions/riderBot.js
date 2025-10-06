/*
  riderBot.js - Dedicated Rider Bot with Command-based Interface
  Commands:
  - /start - Welcome message and registration
  - /me - Show rider profile information
  - /erase - Delete rider details (requires confirmation)
  - /update - Update rider details
  - /riderequest - Request a new ride
  - /cancelride - Cancel active ride request
  - /rides - View active/past ride    } catch (err) {
      await sendError(msg.chat.id, err, "Rides command failed.");
    }
  });

  // /clearcache command - Clear user's cache
  bot.onText(/^\/clearcache$/, async (msg) => {
    try {
      const found = await ensureRiderRegistered(msg);
      if (!found) return;

      const result = await performRiderCrud("clearUserCache", msg.from.id.toString());
      if (result.success) {
        await bot.sendMessage(
          msg.chat.id,
          "🧹 **Cache Cleared**\n\nYour session cache has been cleared. This should resolve any stuck states or outdated information.",
          { parse_mode: "Markdown", ...getRiderMainMenu() }
        );
      } else {
        await bot.sendMessage(msg.chat.id, "❌ Failed to clear cache. Please try again.");
      }
    } catch (err) {
      await sendError(msg.chat.id, err, "Cache clearing failed.");
    }
  });
} /help - Show available commands
  
  Natural language processing for non-command messages using OpenAI
*/

const functions = require("firebase-functions");
const TelegramBot = require("node-telegram-bot-api");
const Rider = require("./models/rider");
const Ride = require("./models/ride");

const openai = require("./utils/openai");
const geocode = require("./utils/geocode");
const { distanceMiles } = require("./utils/distance");
const db = require("./utils/database");
const matching = require("./utils/matching");
const notifications = require("./utils/notifications");

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
const { assertSingleOpen, sanitizeCrudPayload } = require("./utils/guards");
const state = require("./utils/state");
const admin = require("firebase-admin");

// SAFE CRUD operations for riders
const RIDER_CRUD = {
  findUserByTelegramId: db.findUserByTelegramId,
  findRiderByTelegramId: db.findRiderByTelegramId,
  createRider: db.createRider,
  updateRider: db.updateRider,
  createRideRequest: db.createRideRequest,
  listOpenRideRequests: db.listOpenRideRequests,
  deleteRideRequest: db.deleteRideRequest,
  updateRideDetails: db.updateRideDetails,
  cancelRide: db.cancelRide,
  completeRide: db.completeRide,
  getRideById: db.getRideById,
  getRidesByUser: db.getRidesByUser,
  deleteRider: db.deleteRider,
  getUserStats: db.getUserStats,
  clearUserCache: db.clearUserCache,
};

async function performRiderCrud(action, payload) {
  const fn = RIDER_CRUD[action];
  if (!fn) throw new Error(`Rider CRUD not permitted: ${action}`);
  const safePayload = sanitizeCrudPayload(action, payload);
  return fn(safePayload);
}

// Utility functions
function safeNumber(n, min = 0) {
  const val = Number(n);
  return Number.isFinite(val) && val >= min ? val : null;
}

async function sendError(chatId, err, hint) {
  console.error("RIDER_BOT_ERROR", { hint, err: err?.stack || err?.message || err });
  try {
    await riderBot.sendMessage(chatId, `⚠️ Oops. ${hint || "Something went wrong."}`);
  } catch (_) {}
}

// Registration keyboard
const regKb = {
  reply_markup: {
    inline_keyboard: [
      [{ text: "Register as Rider", callback_data: "register_rider" }],
    ],
  },
};

// Main menu keyboard for riders
function getRiderMainMenu() {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "🚗 Request Ride", callback_data: "request_ride" },
          { text: "❌ Cancel Ride", callback_data: "cancel_ride" }
        ],
        [
          { text: "👤 My Profile", callback_data: "view_profile" },
          { text: "📋 My Rides", callback_data: "view_rides" }
        ],
        [
          { text: "✏️ Update Details", callback_data: "update_details" },
          { text: "❓ Help", callback_data: "show_help" }
        ]
      ],
    },
  };
}

// Helper functions
async function ensureRiderRegistered(ctx) {
  const tgId = ctx.from.id.toString();
  console.log(`🔍 DEBUG: Looking up rider ${tgId} in ensureRiderRegistered`);
  const found = await performRiderCrud("findRiderByTelegramId", tgId);
  console.log(`🔍 DEBUG: findRiderByTelegramId result:`, JSON.stringify(found, null, 2));
  
  if (!found || found.type !== "rider") {
    console.log(`🔍 DEBUG: Rider not found or not a rider. found=${!!found}, type=${found?.type}`);
    await riderBot.sendMessage(ctx.chat.id, "👋 Welcome to RideEase Rider Bot!\n\nPlease register as a rider to continue.", regKb);
    return null;
  }
  
  console.log(`🔍 DEBUG: Rider found successfully: ${found.user?.name}`);
  return found;
}

function summarizeRide(ride) {
  const when = new Date(ride.rideTime || ride.timeOfRide).toLocaleString();
  const bid = ride.bid != null ? `\n💰 Bid: $${ride.bid}` : "";
  return `📍 **Pickup:** ${ride.pickup?.name || ride.pickupLocationName}\n📍 **Drop:** ${ride.dropoff?.name || ride.dropLocationName}\n🕐 **Time:** ${when}${bid}`;
}

// Command handlers
function setupRiderCommands(bot) {
    // /clearcache command - Clear user's cache
  bot.onText(/^\/clearcache$/, async (msg) => {
    try {
      const found = await ensureRiderRegistered(msg);
      if (!found) return;

      const result = await performRiderCrud("clearUserCache", msg.from.id.toString());
      if (result.success) {
        await bot.sendMessage(
          msg.chat.id,
          "🧹 **Cache Cleared**\n\nYour session cache has been cleared. This should resolve any stuck states or outdated information.",
          { parse_mode: "Markdown", ...getRiderMainMenu() }
        );
      } else {
        await bot.sendMessage(msg.chat.id, "❌ Failed to clear cache. Please try again.");
      }
    } catch (err) {
      await sendError(msg.chat.id, err, "Cache clearing failed.");
    }
  });
  // /start command
  bot.onText(/^\/start$/, async (msg) => {
    try {
      const found = await ensureRiderRegistered(msg);
      if (!found) return;
      
      await bot.sendMessage(
        msg.chat.id,
        `🚗 Welcome back, ${found.user.name || 'Rider'}!\n\nWhat would you like to do?`,
        getRiderMainMenu()
      );
    } catch (err) {
      await sendError(msg.chat.id, err, "Start command failed.");
    }
  });

  // /me command - Show profile
  bot.onText(/^\/me$/, async (msg) => {
    try {
      const user = await performRiderCrud("findUserByTelegramId", msg.from.id.toString());
      if (!user?.user) {
        return bot.sendMessage(msg.chat.id, "❌ Rider profile not found. Please register first.", regKb);
      }

      let profileText = `👤 **Rider Profile**\n\n`;
      profileText += `📝 **Name:** ${user.user.name || "Not set"}\n`;
      profileText += `📞 **Phone:** ${user.user.phoneNumber || "Not set"}\n`;
      profileText += `⭐ **Rating:** ${user.user.rating || 0}/5\n`;
      profileText += `📊 **Total Rides:** ${user.user.pastRidesIds?.length || 0}\n`;
      
      if (user.user.homeAddress) {
        profileText += `🏠 **Home:** ${user.user.homeAddress}\n`;
      }
      if (user.user.workAddress) {
        profileText += `🏢 **Work:** ${user.user.workAddress}\n`;
      }
      
      // Check for active ride request
      const rides = await performRiderCrud("listOpenRideRequests");
      const activeRide = rides?.find(r => String(r.riderId) === String(user.user._id));
      
      if (activeRide) {
        profileText += `\n🟡 **Current Status:** Has active ride request\n`;
        profileText += `📍 **Pickup:** ${activeRide.pickupLocationName}\n`;
        profileText += `📍 **Drop:** ${activeRide.dropLocationName}\n`;
        if (activeRide.timeOfRide) {
          profileText += `🕐 **Time:** ${new Date(activeRide.timeOfRide).toLocaleString()}\n`;
        }
        if (activeRide.bid) {
          profileText += `💰 **Bid:** $${activeRide.bid}\n`;
        }
        profileText += `📊 **Status:** ${activeRide.status.toUpperCase()}\n`;
      } else {
        profileText += `\n🟢 **Current Status:** No active requests\n`;
      }

      profileText += `\n📅 **Member since:** ${new Date(user.user.createdAt).toLocaleDateString()}\n`;

      await bot.sendMessage(msg.chat.id, profileText, { 
        parse_mode: "Markdown",
        ...getRiderMainMenu()
      });
    } catch (err) {
      await sendError(msg.chat.id, err, "Couldn't fetch your profile.");
    }
  });

  // /erase command - Delete rider profile
  bot.onText(/^\/erase$/, async (msg) => {
    try {
      const found = await ensureRiderRegistered(msg);
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
        "⚠️ **WARNING**\n\nThis will permanently delete your rider profile and all associated data. This action cannot be undone.\n\nAre you sure you want to continue?",
        { parse_mode: "Markdown", ...confirmKb }
      );
    } catch (err) {
      await sendError(msg.chat.id, err, "Delete command failed.");
    }
  });

  // /update command - Update rider details
  bot.onText(/^\/update$/, async (msg) => {
    try {
      const found = await ensureRiderRegistered(msg);
      if (!found) return;

      state.set(msg.from.id.toString(), { phase: "update_rider" });
      await bot.sendMessage(
        msg.chat.id,
        "✏️ **Update Rider Details**\n\nSend the updated information in this format:\n\n`Name | Phone | Telegram Username | Home Address | Work Address`\n\nOr just tell me what you'd like to update (e.g., \"Update my phone to 555-0123\" or \"Set my home address to 123 Main St Miami\")",
        { parse_mode: "Markdown" }
      );
    } catch (err) {
      await sendError(msg.chat.id, err, "Update command failed.");
    }
  });

  // /riderequest command - Request a ride
  bot.onText(/^\/riderequest$/, async (msg) => {
    try {
      const found = await ensureRiderRegistered(msg);
      if (!found) return;

      // Check for existing active ride
      const rides = await performRiderCrud("listOpenRideRequests");
      const activeRide = rides?.find(r => String(r.riderId) === String(found.user._id));
      
      if (activeRide) {
        return bot.sendMessage(
          msg.chat.id,
          `🟡 **You already have an active ride request!**\n\n${summarizeRide(activeRide)}\n\nUse /cancelride to cancel it first.`,
          { parse_mode: "Markdown" }
        );
      }

      state.set(msg.from.id.toString(), { phase: "request_ride" });
      await bot.sendMessage(
        msg.chat.id,
        "🚗 **Request a Ride**\n\nTell me your ride details:\n\n• Example: \"Pickup: Miami Airport | Drop: Downtown Miami | Bid: $25 | Time: today 6:30 PM\"\n• Or: \"I need a ride from my location to the mall at 3 PM for $15\"\n\nI'll understand and help you book it!",
        { parse_mode: "Markdown" }
      );
    } catch (err) {
      await sendError(msg.chat.id, err, "Ride request command failed.");
    }
  });

  // /cancelride command - Cancel active ride
  bot.onText(/^\/cancelride$/, async (msg) => {
    try {
      const found = await ensureRiderRegistered(msg);
      if (!found) return;

      const rides = await performRiderCrud("listOpenRideRequests");
      const activeRide = rides?.find(r => String(r.riderId) === String(found.user._id));
      
      if (!activeRide) {
        return bot.sendMessage(
          msg.chat.id,
          "🔴 **No Active Ride Request**\n\nYou don't have any active ride requests to cancel.\n\nUse /riderequest to book a new ride!",
          { parse_mode: "Markdown", ...getRiderMainMenu() }
        );
      }

      const confirmKb = {
        reply_markup: {
          inline_keyboard: [
            [
              { text: "✅ Yes, Cancel Ride", callback_data: `confirm_cancel_${activeRide._id}` },
              { text: "❌ Keep Ride", callback_data: "keep_ride" }
            ]
          ],
        },
      };

      await bot.sendMessage(
        msg.chat.id,
        `❓ **Cancel This Ride?**\n\n${summarizeRide(activeRide)}\n\nAre you sure you want to cancel?`,
        { parse_mode: "Markdown", ...confirmKb }
      );
    } catch (err) {
      await sendError(msg.chat.id, err, "Cancel ride command failed.");
    }
  });

  // /rides command - View rides
  bot.onText(/^\/rides$/, async (msg) => {
    try {
      const found = await ensureRiderRegistered(msg);
      if (!found) return;

      const rides = await performRiderCrud("getRidesByUser", found.user._id, "rider");
      if (!rides || rides.length === 0) {
        return bot.sendMessage(
          msg.chat.id,
          "🚗 **No Rides Yet**\n\nYou haven't booked any rides yet. Use /riderequest to book your first ride!",
          { parse_mode: "Markdown", ...getRiderMainMenu() }
        );
      }

      let ridesList = `📋 **Your Rides (${rides.length})**\n\n`;
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

      // Add action buttons for open rides
      const openRides = rides.filter(r => r.status === 'open').slice(0, 3);
      const keyboard = openRides.length > 0 ? {
        inline_keyboard: openRides.map((ride, index) => [
          { text: `📝 Update Ride ${index + 1}`, callback_data: `update_ride_${ride._id}` },
          { text: `❌ Cancel Ride ${index + 1}`, callback_data: `confirm_cancel_${ride._id}` }
        ])
      } : getRiderMainMenu().reply_markup;

      await bot.sendMessage(msg.chat.id, ridesList, { 
        parse_mode: "Markdown",
        reply_markup: keyboard
      });
    } catch (err) {
      await sendError(msg.chat.id, err, "Rides command failed.");
    }
  });

  // /help command - Show help
  bot.onText(/^\/help$/, async (msg) => {
    try {
      const helpText = `🚗 **Rider Bot Commands**\n\n` +
        `**Basic Commands:**\n` +
        `• /start - Show main menu\n` +
        `• /me - View your profile\n` +
        `• /help - Show this help message\n` +
        `• /clearcache - Clear session cache\n\n` +
        `**Ride Commands:**\n` +
        `• /riderequest - Request a new ride\n` +
        `• /cancelride - Cancel active ride request\n` +
        `• /rides - View your rides\n\n` +
        `**Profile Management:**\n` +
        `• /update - Update your details\n` +
        `• /erase - Delete your profile\n\n` +
        `**Troubleshooting:**\n` +
        `If you're experiencing issues, try /clearcache to clear your session state.\n\n` +
        `**Natural Language:**\n` +
        `Just tell me what you want to do! For example:\n` +
        `• "I need a ride from Miami Airport to Downtown at 3 PM for $20"\n` +
        `• "Book me a ride from home to work tomorrow morning"\n` +
        `• "Cancel my current ride"\n` +
        `• "Update my phone number to 555-0123"\n\n` +
        `I'll understand and help you! 🤖`;

      await bot.sendMessage(msg.chat.id, helpText, { 
        parse_mode: "Markdown",
        ...getRiderMainMenu()
      });
    } catch (err) {
      await sendError(msg.chat.id, err, "Help command failed.");
    }
  });
}

// Callback query handlers
function setupRiderCallbacks(bot) {
  bot.on("callback_query", async (cbq) => {
    const data = cbq.data;
    const chatId = cbq.message.chat.id;
    const tgId = cbq.from.id.toString();
    
    try {
      // Registration
      if (data === "register_rider") {
        state.set(tgId, { phase: "register_rider" });
        await bot.sendMessage(
          chatId,
          "🚗 **Rider Registration**\n\nPlease send your details in this format:\n\n`Name | Phone | Telegram Username | Home Address | Work Address`\n\n**Example:**\n`Jane Doe | 555-0123 | @janedoe | 123 Main St Miami FL | Downtown Miami Business District`\n\n**Note:** Home and work addresses are optional but help with location-based features. Leave blank if not needed:\n`Jane Doe | 555-0123 | @janedoe | | `",
          { parse_mode: "Markdown" }
        );
        return bot.answerCallbackQuery(cbq.id);
      }

      // Main menu actions
      if (data === "request_ride") {
        const found = await ensureRiderRegistered({ from: cbq.from, chat: { id: chatId } });
        if (!found) return bot.answerCallbackQuery(cbq.id);

        // Check for existing active ride
        const rides = await performRiderCrud("listOpenRideRequests");
        const activeRide = rides?.find(r => String(r.riderId) === String(found.user._id));
        
        if (activeRide) {
          await bot.sendMessage(
            chatId,
            `🟡 **You already have an active ride request!**\n\n${summarizeRide(activeRide)}\n\nCancel it first to request a new ride.`,
            { parse_mode: "Markdown" }
          );
          return bot.answerCallbackQuery(cbq.id);
        }

        state.set(tgId, { phase: "request_ride" });
        await bot.sendMessage(
          chatId,
          "🚗 **Request a Ride**\n\nTell me your ride details:\n\n• Example: \"Pickup: Miami Airport | Drop: Downtown Miami | Bid: $25 | Time: today 6:30 PM\"\n• Or just describe what you need naturally!",
          { parse_mode: "Markdown" }
        );
        return bot.answerCallbackQuery(cbq.id);
      }

      if (data === "cancel_ride") {
        const found = await ensureRiderRegistered({ from: cbq.from, chat: { id: chatId } });
        if (!found) return bot.answerCallbackQuery(cbq.id);

        const rides = await performRiderCrud("listOpenRideRequests");
        const activeRide = rides?.find(r => String(r.riderId) === String(found.user._id));
        
        if (!activeRide) {
          await bot.sendMessage(chatId, "🔴 No active ride request to cancel.");
        } else {
          await performRiderCrud("deleteRideRequest", activeRide._id);
          await bot.sendMessage(
            chatId,
            "❌ **Ride Cancelled**\n\nYour ride request has been cancelled.",
            { parse_mode: "Markdown" }
          );
        }
        return bot.answerCallbackQuery(cbq.id);
      }

      // Ride cancellation confirmation
      const confirmCancel = data.match(/^confirm_cancel_(.+)$/);
      if (confirmCancel) {
        const rideId = confirmCancel[1];
        await performRiderCrud("deleteRideRequest", rideId);
        await bot.sendMessage(
          chatId,
          "❌ **Ride Cancelled**\n\nYour ride request has been cancelled successfully.",
          { parse_mode: "Markdown", ...getRiderMainMenu() }
        );
        return bot.answerCallbackQuery(cbq.id);
      }

      if (data === "keep_ride") {
        await bot.sendMessage(
          chatId,
          "✅ **Ride Kept**\n\nYour ride request is still active.",
          { parse_mode: "Markdown", ...getRiderMainMenu() }
        );
        return bot.answerCallbackQuery(cbq.id);
      }

      // Ride update
      const updateRide = data.match(/^update_ride_(.+)$/);
      if (updateRide) {
        const rideId = updateRide[1];
        state.set(tgId, { phase: "update_ride", rideId });
        await bot.sendMessage(
          chatId,
          "✏️ **Update Ride Details**\n\nSend the updated ride information:\n\n`Pickup: <address> | Drop: <address> | Bid: <amount> | Time: <when>`\n\nOr just tell me what you want to change!",
          { parse_mode: "Markdown" }
        );
        return bot.answerCallbackQuery(cbq.id);
      }

      // Delete confirmation
      if (data === "confirm_delete") {
        const user = await performRiderCrud("findUserByTelegramId", tgId);
        if (user?.user) {
          await performRiderCrud("deleteRider", user.user._id);
          await bot.sendMessage(
            chatId,
            "✅ **Profile Deleted**\n\nYour rider profile has been permanently deleted. Thank you for using RideEase!\n\nIf you want to use our service again, just send /start to register."
          );
        }
        return bot.answerCallbackQuery(cbq.id);
      }

      if (data === "cancel_delete") {
        await bot.sendMessage(chatId, "❌ **Deletion Cancelled**\n\nYour profile is safe!", getRiderMainMenu());
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
function setupRiderMessageHandlers(bot) {
  bot.on("message", async (msg) => {
    try {
      if (!msg.text || msg.via_bot || msg.edit_date) return;
      if (msg.text.startsWith('/')) return; // Skip commands
      
      const tgId = msg.from.id.toString();
      const text = openai.sanitizeInput(msg.text.trim());
      const st = state.get(tgId);

      // Handle registration
      if (st?.phase === "register_rider") {
        const parts = text.split("|").map(s => s.trim());
        if (parts.length < 3) {
          return bot.sendMessage(
            msg.chat.id,
            "❌ Please send at least the first 3 required fields:\n`Name | Phone | Telegram Username | Home Address | Work Address`\n\nHome and work addresses are optional - you can leave them empty:\n`Name | Phone | Username | | `",
            { parse_mode: "Markdown" }
          );
        }
        
        const [name, phoneNumber, telegramUsername, homeAddress = "", workAddress = ""] = parts;
        
        // Prepare the data for creation
        const riderData = {
          name,
          phoneNumber, 
          telegramId: tgId, 
          telegramUsername
        };
        
        // Add addresses if provided
        if (homeAddress && homeAddress.trim()) {
          riderData.homeAddress = homeAddress.trim();
        }
        if (workAddress && workAddress.trim()) {
          riderData.workAddress = workAddress.trim();
        }
        
        const result = await performRiderCrud("createRider", riderData);
        
        if (!result?.success) {
          return bot.sendMessage(msg.chat.id, `❌ Registration failed: ${result?.error || "unknown error"}`);
        }
        
        state.clear(tgId);
        await bot.sendMessage(
          msg.chat.id,
          `✅ **Welcome to RideEase, ${name}!**\n\nYou're all set as a rider. Use /riderequest when you need a ride!`,
          { parse_mode: "Markdown", ...getRiderMainMenu() }
        );
        return;
      }

      // Handle ride request
      if (st?.phase === "request_ride") {
        await handleRideRequest(bot, msg, text);
        return;
      }

      // Handle ride update
      if (st?.phase === "update_ride") {
        await handleRideUpdate(bot, msg, text, st.rideId);
        return;
      }

      // Handle profile update
      if (st?.phase === "update_rider") {
        await handleRiderUpdate(bot, msg, text);
        return;
      }

      // Ensure registered for other messages
      const found = await ensureRiderRegistered(msg);
      if (!found) return;

      // Show typing indicator while processing
      const clearTyping = await showTyping(bot, msg.chat.id);

      try {
        // Process with OpenAI for intent detection
        const intent = await openai.detectIntent(text, "rider");
        clearTyping();
        await handleRiderIntent(bot, msg, intent, found);
      } catch (err) {
        clearTyping();
        throw err;
      }

    } catch (err) {
      await sendError(msg.chat.id, err, "Message processing failed.");
    }
  });
}

async function handleRideRequest(bot, msg, text) {
  const tgId = msg.from.id.toString();
  
  try {
    // Show typing indicator while processing intent
    const clearTyping = await showTyping(bot, msg.chat.id);
    
    const intent = await openai.detectIntent(text, "rider");
    clearTyping();
    
    if (intent?.type === "rider_ride") {
      const { pickup, dropoff, bid, rideTimeISO } = intent.fields || {};
      
      if (!pickup || !dropoff || !rideTimeISO) {
        return bot.sendMessage(
          msg.chat.id,
          "❌ I need pickup location, drop-off location, and ride time. Try:\n\"Pickup: [address] | Drop: [address] | Time: [when] | Bid: [amount]\""
        );
      }

      // Geocode addresses
      let gp, gd;
      const clearGeoTyping = await showTyping(bot, msg.chat.id);
      try {
        gp = await geocode.geocodeAddress(pickup);
        gd = await geocode.geocodeAddress(dropoff);
        clearGeoTyping();
      } catch (err) {
        clearGeoTyping();
        return bot.sendMessage(msg.chat.id, "❌ Couldn't find one of the addresses. Please try more specific addresses.");
      }

      if (!gp || !gd) {
        clearGeoTyping();
        return bot.sendMessage(msg.chat.id, "❌ Couldn't locate the addresses. Please try again.");
      }

      const rideTime = new Date(rideTimeISO);
      if (rideTime.getTime() - Date.now() < 30 * 60 * 1000) {
        return bot.sendMessage(msg.chat.id, "❌ Ride time must be at least 30 minutes from now.");
      }

      const user = await performRiderCrud("findUserByTelegramId", tgId);
      const ride = await performRiderCrud("createRideRequest", {
        riderId: user.user._id,
        pickupLocationName: gp.name,
        pickupLocation: { type: "Point", coordinates: [gp.lon, gp.lat] },
        dropLocationName: gd.name,
        dropLocation: { type: "Point", coordinates: [gd.lon, gd.lat] },
        bid: Number(bid) || 0,
        timeOfRide: rideTime,
        status: "open",
      });

      if (!ride?.success && !ride?._id) {
        return bot.sendMessage(msg.chat.id, `❌ Failed to create ride request: ${ride?.error || "unknown error"}`);
      }

      state.clear(tgId);
      await bot.sendMessage(
        msg.chat.id,
        `✅ **Ride Request Created!**\n\n${summarizeRide({
          pickupLocationName: gp.name,
          dropLocationName: gd.name,
          timeOfRide: rideTime,
          bid: bid
        })}\n\nI'll notify you when a driver accepts your ride!`,
        { parse_mode: "Markdown", ...getRiderMainMenu() }
      );

      // Notify nearby drivers
      try {
        if (typeof matching.findDriversForRide === "function") {
          const drivers = await matching.findDriversForRide(ride);
          for (const { availability, distanceMi } of drivers) {
            const driver = await db.findById("drivers", availability.driverId);
            if (notifications.notifyDriver) {
              await notifications.notifyDriver(
                driver,
                `🚗 **New Ride Request**\n\nNear you (~${distanceMi?.toFixed?.(1) || "?"} mi):\n\n📍 ${gp.name}\n📍 ${gd.name}\n🕐 ${rideTime.toLocaleString()}${bid ? `\n💰 $${bid}` : ""}`
              );
            }
          }
        }
      } catch (err) {
        console.log("Failed to notify drivers:", err);
      }
      
    } else {
      await bot.sendMessage(
        msg.chat.id,
        "❌ I didn't understand that ride request. Please include:\n• Pickup location\n• Drop-off location\n• Time (at least 30 minutes from now)\n• Optional: bid amount\n\nExample: \"Pickup: Miami Airport | Drop: Downtown Miami | Time: today 6 PM | Bid: $25\""
      );
    }
  } catch (err) {
    await sendError(msg.chat.id, err, "Ride request failed.");
    state.clear(tgId);
  }
}

async function handleRideUpdate(bot, msg, text, rideId) {
  const tgId = msg.from.id.toString();
  
  try {
    // Show typing indicator while processing
    const clearTyping = await showTyping(bot, msg.chat.id);
    
    const intent = await openai.detectIntent(text, "rider_update");
    clearTyping();
    
    if (intent?.fields) {
      const result = await performRiderCrud("updateRideDetails", {
        rideId: rideId,
        updates: intent.fields
      });
      
      if (result?.success) {
        state.clear(tgId);
        await bot.sendMessage(
          msg.chat.id,
          "✅ **Ride Updated!**\n\nYour ride details have been updated successfully.",
          { parse_mode: "Markdown", ...getRiderMainMenu() }
        );
      } else {
        await bot.sendMessage(msg.chat.id, `❌ Update failed: ${result?.error || "unknown error"}`);
      }
    } else {
      await bot.sendMessage(
        msg.chat.id,
        "❌ I didn't understand what you want to update. Try:\n• \"Change pickup to Miami Beach\"\n• \"Update time to 7 PM\"\n• \"Set bid to $30\"\n\nOr send: `Pickup: <new address> | Drop: <new address> | Time: <new time> | Bid: <new amount>`"
      );
    }
  } catch (err) {
    await sendError(msg.chat.id, err, "Ride update failed.");
    state.clear(tgId);
  }
}

async function handleRiderUpdate(bot, msg, text) {
  const tgId = msg.from.id.toString();
  
  try {
    // Show typing indicator while processing
    const clearTyping = await showTyping(bot, msg.chat.id);
    
    // Check if it's pipe-delimited format
    if (text.includes('|')) {
      clearTyping();
      const parts = text.split("|").map(s => s.trim());
      if (parts.length >= 3) {
        const [name, phoneNumber, telegramUsername, homeAddress = "", workAddress = ""] = parts;
        
        const updates = { name, phoneNumber, telegramUsername };
        
        // Add addresses if provided (empty string means remove)
        if (homeAddress !== undefined) {
          updates.homeAddress = homeAddress || null;
        }
        if (workAddress !== undefined) {
          updates.workAddress = workAddress || null;
        }
        
        const result = await performRiderCrud("updateRider", {
          telegramId: tgId,
          updates
        });
        
        if (result?.success) {
          state.clear(tgId);
          await bot.sendMessage(
            msg.chat.id,
            "✅ **Profile Updated!**\n\nAll your details have been updated successfully.",
            { parse_mode: "Markdown", ...getRiderMainMenu() }
          );
        } else {
          await bot.sendMessage(msg.chat.id, `❌ Update failed: ${result?.error || "unknown error"}`);
        }
        return;
      }
    }

    // Use OpenAI to understand the update request
    const clearTyping2 = await showTyping(bot, msg.chat.id);
    const updateIntent = await openai.detectIntent(text, "rider_update");
    clearTyping2();
    
    if (updateIntent?.fields) {
      const result = await performRiderCrud("updateRider", {
        telegramId: tgId,
        updates: updateIntent.fields
      });
      
      if (result?.success) {
        state.clear(tgId);
        await bot.sendMessage(
          msg.chat.id,
          "✅ **Profile Updated!**\n\nYour details have been updated successfully.",
          { parse_mode: "Markdown", ...getRiderMainMenu() }
        );
      } else {
        await bot.sendMessage(msg.chat.id, `❌ Update failed: ${result?.error || "unknown error"}`);
      }
    } else {
      await bot.sendMessage(
        msg.chat.id,
        "❌ I didn't understand what you want to update. Try:\n• \"Update my phone to 555-0123\"\n• \"Change my name to John Smith\"\n\nOr send all details: `Name | Phone | Username`"
      );
    }
  } catch (err) {
    await sendError(msg.chat.id, err, "Update failed.");
    state.clear(tgId);
  }
}

async function handleRiderIntent(bot, msg, intent, found) {
  switch (intent?.type) {
    case "rider_ride":
      // Request a ride
      // Note: Removed assertSingleOpen for now - should be implemented if needed
      
      const { pickup, dropoff, bid, rideTimeISO } = intent.fields || {};
      if (!pickup || !dropoff || !rideTimeISO) {
        return bot.sendMessage(
          msg.chat.id,
          "❌ I need pickup location, drop-off location, and ride time. Try:\n\"I need a ride from [pickup] to [dropoff] at [time]\""
        );
      }

      // Geocode addresses
      let gp, gd;
      try {
        gp = await geocode.geocodeAddress(pickup);
        gd = await geocode.geocodeAddress(dropoff);
      } catch (err) {
        return bot.sendMessage(msg.chat.id, "❌ Couldn't find one of the addresses. Please try more specific addresses.");
      }

      const rideTime = new Date(rideTimeISO);
      if (rideTime.getTime() - Date.now() < 30 * 60 * 1000) {
        return bot.sendMessage(msg.chat.id, "❌ Ride time must be at least 30 minutes from now.");
      }

      const ride = await performRiderCrud("createRideRequest", {
        riderId: found.user._id,
        pickupLocationName: gp.name,
        pickupLocation: { type: "Point", coordinates: [gp.lon, gp.lat] },
        dropLocationName: gd.name,
        dropLocation: { type: "Point", coordinates: [gd.lon, gd.lat] },
        bid: Number(bid) || 0,
        timeOfRide: rideTime,
        status: "open",
      });

      await bot.sendMessage(
        msg.chat.id,
        `✅ **Ride Request Created!**\n\n${summarizeRide({
          pickupLocationName: gp.name,
          dropLocationName: gd.name,
          timeOfRide: rideTime,
          bid: bid
        })}\n\nI'll notify you when a driver accepts!`,
        { parse_mode: "Markdown", ...getRiderMainMenu() }
      );
      return;

    case "delete_ride":
      const rides = await performRiderCrud("listOpenRideRequests");
      const activeRide = rides?.find(r => String(r.riderId) === String(found.user._id));
      if (!activeRide) {
        return bot.sendMessage(msg.chat.id, "🔴 No active ride request to cancel.");
      }
      await performRiderCrud("deleteRideRequest", activeRide._id);
      return bot.sendMessage(
        msg.chat.id,
        "❌ **Ride Cancelled**\n\nYour ride request has been cancelled.",
        { parse_mode: "Markdown", ...getRiderMainMenu() }
      );

    case "help":
    default:
      const helpText = intent?.helpText || openai.getHelpText?.("rider") || 
        "🤖 **I'm here to help!**\n\n" +
        "You can:\n" +
        "• Request rides by telling me where you want to go\n" +
        "• Ask me to update your details\n" +
        "• Check your rides\n" +
        "• Use commands like /riderequest, /me, /rides\n\n" +
        "Just talk to me naturally! I'll understand what you need.";
      
      return bot.sendMessage(msg.chat.id, helpText, {
        parse_mode: "Markdown",
        ...getRiderMainMenu()
      });
  }
}

// Initialize rider bot
let riderBot;
let riderWired = false;

function initRiderBot() {
  if (riderBot) return riderBot;
  
  const token = process.env.TELEGRAM_BOT_TOKEN; // Using original token for riders
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN not set");

  const usePolling = !process.env.FUNCTIONS_EMULATOR && process.env.NODE_ENV !== "production";
  riderBot = new TelegramBot(token, { polling: usePolling });

  // Set bot instance for notifications
  try {
    require("./utils/notifications").setRiderBotInstance(riderBot);
  } catch (_) {}

  if (!riderWired) {
    setupRiderCommands(riderBot);
    setupRiderCallbacks(riderBot);
    setupRiderMessageHandlers(riderBot);
    riderWired = true;
  }

  return riderBot;
}

// Export for webhook
module.exports = {
  processUpdate: async (update) => {
    const bot = initRiderBot();
    return bot.processUpdate(update);
  },
  initRiderBot
};
