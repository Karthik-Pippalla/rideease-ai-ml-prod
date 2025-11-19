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

// Load environment variables first (includes TZ=America/New_York)
require("dotenv").config();

const TelegramBot = require("node-telegram-bot-api");
const mongoose = require("mongoose");
const Driver = require("./models/driver");
const Ride = require("./models/ride");
const Rider = require("./models/rider");
const { CloudTasksClient } = require('@google-cloud/tasks');

// ========== MongoDB Connection Setup ==========
let mongoInitialized = false;
async function ensureMongoConnection() {
  if (mongoInitialized && mongoose.connection.readyState === 1) {
    return;
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("❌ MONGODB_URI not set in environment variables");
    throw new Error("MONGODB_URI not set");
  }

  try {
    console.log("🔗 Connecting to MongoDB...");
    await mongoose.connect(uri, {
      dbName: process.env.MONGODB_DB || undefined,
      serverSelectionTimeoutMS: 30_000, // Increased timeout
      socketTimeoutMS: 45_000,
      bufferCommands: false,
      maxPoolSize: 10, // Maintain up to 10 socket connections
      serverApi: { version: '1', strict: true, deprecationErrors: true }
    });
    
    mongoInitialized = true;
    console.log("✅ MongoDB connected successfully");
  } catch (error) {
    console.error("❌ MongoDB connection failed:", error.message);
    mongoInitialized = false;
    throw error;
  }
}

const openai = require("./utils/openai");
const geocode = require("./utils/geocode");
const db = require("./utils/database");
const matching = require("./utils/matching");
const notifications = require("./utils/notifications");
const { formatDateTime } = require("./utils/dateParser");
const { assertSingleOpen, sanitizeCrudPayload, checkRateLimit, logSecurityEvent } = require("./utils/guards");
const state = require("./utils/state");
const validation = require("./utils/validation");

// Initialize Cloud Tasks client with timeout configuration
const cloudTasksClient = new CloudTasksClient({
  // Configure timeouts to prevent hanging
  timeout: 30000, // 30 seconds max
  retry: {
    retryCodes: [4, 14], // DEADLINE_EXCEEDED, UNAVAILABLE
    backoffSettings: {
      initialRetryDelayMillis: 1000,
      retryDelayMultiplier: 2,
      maxRetryDelayMillis: 10000,
      maxRetries: 3
    }
  }
});
const projectId = process.env.GCLOUD_PROJECT || "rideease-1a4d6";

// Debug logging function
const DEBUG = process.env.DEBUG === "true" || process.env.NODE_ENV === "development";
const SHOW_PROGRESS_TO_USER = process.env.SHOW_PROGRESS_TO_USER === "true" || DEBUG;

// Store temporary messages to delete them later
const tempMessages = new Map();

// Enhanced debug function that sends status to user instead of console logging
const debug = async (message, data = null, bot = null, chatId = null) => {
  const timestamp = new Date().toISOString();
  
  // Always log critical errors to console
  if (message.includes('ERROR') || message.includes('FAILED')) {
    console.log(`[${timestamp}] 🤖 DRIVER DEBUG: ${message}`);
    if (data) console.log(`[${timestamp}] 🤖 DRIVER DEBUG DATA:`, JSON.stringify(data, null, 2));
  }
  
  // Send status updates to user if bot and chatId are provided
  if (SHOW_PROGRESS_TO_USER && bot && chatId) {
    try {
      // Delete previous temp message if exists
      const prevMessageId = tempMessages.get(chatId);
      if (prevMessageId) {
        try {
          await bot.deleteMessage(chatId, prevMessageId);
        } catch (deleteErr) {
          // Ignore delete errors (message might be too old)
        }
      }
      
      // Send new status message
      const statusMessage = `🔄 Processing: ${message.replace(/🤖 DRIVER DEBUG: /, '')}`;
      const sentMessage = await bot.sendMessage(chatId, statusMessage);
      tempMessages.set(chatId, sentMessage.message_id);
      
      // Auto-delete after 20 seconds if not replaced
      setTimeout(async () => {
        const currentMessageId = tempMessages.get(chatId);
        if (currentMessageId === sentMessage.message_id) {
          try {
            await bot.deleteMessage(chatId, sentMessage.message_id);
            tempMessages.delete(chatId);
          } catch (deleteErr) {
            // Ignore delete errors
          }
        }
      }, 20000);
      
    } catch (err) {
      // Fallback to console logging if messaging fails
      console.log(`[${timestamp}] 🤖 DRIVER DEBUG: ${message}`);
      if (data) console.log(`[${timestamp}] 🤖 DRIVER DEBUG DATA:`, JSON.stringify(data, null, 2));
    }
  } else if (DEBUG) {
    // Standard console logging when no bot/chatId provided
    console.log(`[${timestamp}] 🤖 DRIVER DEBUG: ${message}`);
    if (data) console.log(`[${timestamp}] 🤖 DRIVER DEBUG DATA:`, JSON.stringify(data, null, 2));
  }
};

// Function to clear temporary status message when final response is sent
const clearTempMessage = async (bot, chatId) => {
  const messageId = tempMessages.get(chatId);
  if (messageId) {
    try {
      await bot.deleteMessage(chatId, messageId);
      tempMessages.delete(chatId);
    } catch (err) {
      // Ignore delete errors
    }
  }
};

// Wrapper function to send messages and automatically clear temp messages
const sendFinalMessage = async (bot, chatId, text, options = {}) => {
  await clearTempMessage(bot, chatId);
  return await bot.sendMessage(chatId, text, options);
};

// Helper function to create tasks with error handling and timeout
async function createTaskSafely(parent, task, taskName = 'task') {
  try {
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Task creation timeout')), 10000)
    );
    
    const createPromise = cloudTasksClient.createTask({ parent, task });
    
    await Promise.race([createPromise, timeoutPromise]);
    debug(`Task ${taskName} created successfully`);
    return true;
  } catch (error) {
    debug(`Failed to create task ${taskName}`, { error: error.message });
    return false;
  }
}

// Helper function to get rider bot instance
function getRiderBot() {
  return notifications.getRiderBotInstance();
}

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
  findDriverByTelegramId: db.findDriverByTelegramId,
  createDriver: db.createDriver,
  updateDriver: db.updateDriver,
  setDriverAvailability: db.setDriverAvailability,
  closeDriverAvailability: db.closeDriverAvailability,
  getOpenAvailabilityByDriver: db.getOpenAvailabilityByDriver,
  listOpenRideRequests: db.listOpenRideRequests,
  acceptRide: db.acceptRide,
  completeRide: db.completeRide,
  cancelRide: db.cancelRide,
  getRidesByDriver: db.getRidesByDriver,
  deleteDriver: db.deleteDriver,
  getDriverStats: db.getDriverStats,
  clearUserCache: db.clearUserCache,
};

async function performDriverCrud(action, payload) {
  const fn = DRIVER_CRUD[action];
  if (!fn) throw new Error(`Driver CRUD not permitted: ${action}`);
  
  // Special handling for setDriverAvailability to pass parameters correctly
  if (action === "setDriverAvailability") {
    const { telegramId, isAvailable, currentLocation, radiusMiles, durationHours } = payload;
    return fn(telegramId, isAvailable, currentLocation, radiusMiles, durationHours);
  }
  
  // Special handling for acceptRide to pass parameters correctly
  if (action === "acceptRide") {
    const { rideId, driverId } = payload;
    return fn(rideId, driverId);
  }
  
  // Special handling for updateDriver to pass payload directly
  if (action === "updateDriver") {
    return fn(payload);
  }
  
  const safePayload = sanitizeCrudPayload(action, payload);
  return fn(safePayload);
}

// Utility functions
async function sendError(chatId, err, hint) {
  const errorDetails = {
    hint,
    message: err?.message,
    stack: err?.stack,
    type: err?.constructor?.name
  };
  
  console.error("DRIVER_BOT_ERROR", errorDetails);
  
  try {
    const bot = initDriverBot(); // Get the bot instance
    const userFriendlyMessage = hint || "Something went wrong. Please try again.";
    
    // In development, show more details
    if (process.env.NODE_ENV === "development" && err?.message) {
      await bot.sendMessage(chatId, `⚠️ ${userFriendlyMessage}\n\nDebug: ${err.message}`, getErrorButtons());
    } else {
      await bot.sendMessage(chatId, `⚠️ ${userFriendlyMessage}`, getErrorButtons());
    }
  } catch (sendError) {
    console.error("Failed to send error message:", sendError);
  }
}

// Registration keyboard
const regKb = {
  reply_markup: {
    inline_keyboard: [
      [{ text: "Register as Driver", callback_data: "register_driver" }],
    ],
  },
};

// Main menu keyboard for drivers - context-aware based on driver state
function getDriverMainMenu(isAvailable = false, hasActiveRide = false) {
  const availabilityRow = isAvailable ? 
    [{ text: "🔴 Go Unavailable", callback_data: "go_unavailable" }] :
    [{ text: "🟢 Go Available", callback_data: "go_available" }];

  // If driver has an active ride, show ride management options
  if (hasActiveRide) {
    return {
      reply_markup: {
        inline_keyboard: [
          [{ text: "✅ Complete Ride", callback_data: "mark_completed" }],
          [{ text: "❌ Cancel Ride", callback_data: "cancel_current_ride" }],
          [
            { text: "� My Profile", callback_data: "view_profile" },
            { text: "🚗 My Rides", callback_data: "view_rides" }
          ],
          [
            { text: "📊 My Stats", callback_data: "view_stats" },
            { text: "📋 Ride Details", callback_data: "view_ride_details" }
          ],
          [
            { text: "✏️ Update Details", callback_data: "update_details" },
            { text: "❓ Help", callback_data: "show_help" }
          ]
        ],
      },
    };
  }

  // Normal menu with availability toggle
  return {
    reply_markup: {
      inline_keyboard: [
        availabilityRow,
        [
          { text: "👤 My Profile", callback_data: "view_profile" },
          { text: "🚗 My Rides", callback_data: "view_rides" }
        ],
        [
          { text: "📊 My Stats", callback_data: "view_stats" },
          { text: "✏️ Update Details", callback_data: "update_details" }
        ],
        [
          { text: "❓ Help", callback_data: "show_help" }
        ]
      ],
    },
  };
}

// Helper function to get context-aware main menu for a driver
async function getContextAwareDriverMainMenu(driverId) {
  try {
    // Check if driver is available
    const availability = await performDriverCrud("getOpenAvailabilityByDriver", driverId);
    const isAvailable = !!availability;

    // Check for active rides (matched or in_progress)
    const mongoose = require('mongoose');
    const driverObjectId = mongoose.Types.ObjectId.isValid(driverId) ? 
      new mongoose.Types.ObjectId(driverId) : driverId;
    
    const activeRide = await Ride.findOne({
      driverId: driverObjectId,
      status: { $in: ["matched", "in_progress"] }
    });
    const hasActiveRide = !!activeRide;

    return getDriverMainMenu(isAvailable, hasActiveRide);
  } catch (error) {
    console.error("Error getting context-aware driver main menu:", error);
    return getDriverMainMenu(false, false); // Default to basic menu on error
  }
}

// Error/info buttons
function getErrorButtons() {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "🏠 Main Menu", callback_data: "main_menu" },
          { text: "🔄 Try Again", callback_data: "retry" }
        ],
        [
          { text: "❓ Help", callback_data: "show_help" }
        ]
      ],
    },
  };
}

// Registration process buttons
function getRegistrationButtons() {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "📝 Register Now", callback_data: "register_driver" }
        ],
        [
          { text: "❓ Help", callback_data: "show_help" }
        ]
      ],
    },
  };
}

// Availability buttons
function getAvailabilityButtons() {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "🟢 Set Available", callback_data: "go_available" },
          { text: "🔴 Set Unavailable", callback_data: "go_unavailable" }
        ],
        [
          { text: "🏠 Main Menu", callback_data: "main_menu" }
        ]
      ],
    },
  };
}

// Quick action buttons
function getQuickActionButtons() {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "🏠 Main Menu", callback_data: "main_menu" },
          { text: "🔄 Refresh", callback_data: "refresh" }
        ]
      ],
    },
  };
}

// Ride completion buttons for matched rides
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
  try {
    const tgId = ctx.from.id.toString();
    console.log(`Checking driver registration for Telegram ID: ${tgId}`);
    
    const found = await performDriverCrud("findDriverByTelegramId", tgId);
    console.log(`Driver lookup result:`, { found: !!found, type: found?.type });
    
    if (!found || found.type !== "driver") {
      console.log(`Driver not found or not a driver type, sending registration message`);
      await driverBot.sendMessage(ctx.chat.id, "👋 **Welcome to RideEase - Driver Portal!**\n\n🚗 **You are in the DRIVER app** - for accepting rides\n\nPlease register as a driver to continue.\n\n⏱️ *Response time: 3-45 seconds due to AI processing*", regKb);
      return null;
    }
    
    console.log(`Driver found and verified: ${found.user?.name || 'Unknown'}`);
    return found;
  } catch (err) {
    console.error("Error in ensureDriverRegistered:", err);
    throw err;
  }
}

function summarizeRide(ride, distanceMi) {
  const when = formatDateTime(new Date(ride.rideTime || ride.timeOfRide));
  const dist = typeof distanceMi === "number" ? ` • ~${distanceMi.toFixed(1)} mi` : "";
  const bid = ride.bid != null ? `\nBid: $${ride.bid}` : "";
  return `📍 Pickup: ${ride.pickup?.name || ride.pickupLocationName}\n📍 Drop: ${ride.dropoff?.name || ride.dropLocationName}\n🕐 Time: ${when}${dist}${bid}`;
}

async function showDriverRideMenu(ctx, availability) {
  const matches = await matching.findMatchesForDriverAvailability(availability);
  if (!matches.length) {
    await driverBot.sendMessage(ctx.chat.id, "🔍 **No Rides Available**\n\nNo ride requests match your current availability. You will be notified when new rides become available.", { parse_mode: "Markdown", ...getQuickActionButtons() });
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
  // Remove any existing command listeners to prevent duplicates
  bot.removeAllListeners('text');
  
  // Session timeout checking is now handled selectively in callback and message handlers

  // /start command
  bot.onText(/^\/start$/, async (msg) => {
    await debug("Processing /start command", { userId: msg.from.id }, bot, msg.chat.id);
    
    try {
      await ensureMongoConnection();
      await debug("Checking driver registration", null, bot, msg.chat.id);
      const found = await ensureDriverRegistered(msg);
      if (!found) {
        await clearTempMessage(bot, msg.chat.id);
        return;
      }
      
      await debug("Loading main menu", null, bot, msg.chat.id);
      const menu = await getContextAwareDriverMainMenu(found.user._id.toString());
      await sendFinalMessage(
        bot,
        msg.chat.id,
        `🚗 Welcome back, ${found.user.name || 'Driver'}!\n\nWhat would you like to do?`,
        menu
      );
    } catch (err) {
      await sendError(msg.chat.id, err, "Start command failed.");
    }
  });

  // /me command - Show profile
  bot.onText(/^\/me$/, async (msg) => {
    await debug("Processing /me command", { userId: msg.from.id }, bot, msg.chat.id);
    
    try {
      await debug("Loading your profile data", null, bot, msg.chat.id);
      const user = await performDriverCrud("findDriverByTelegramId", msg.from.id.toString());
      
      if (!user?.user) {
        return sendFinalMessage(bot, msg.chat.id, "❌ **Driver Profile Not Found**\n\n🚗 **DRIVER:** You need to register first to access your profile.\n\n⏱️ *Response time: 3-45 seconds due to AI processing*", getRegistrationButtons());
      }

      const profileBuildStartTime = Date.now();
      let profileText = `👤 **Driver Profile**\n\n`;
      profileText += `📝 **Name:** ${user.user.name || "Not set"}\n`;
      profileText += `📞 **Phone:** ${user.user.phoneNumber || "Not set"}\n`;
      profileText += `🔢 **License Plate:** ${user.user.licensePlateNumber || "Not set"}\n`;
      profileText += `🎨 **Vehicle Color:** ${user.user.vehicleColour || "Not set"}\n`;
      profileText += `⭐ **Rating:** ${user.user.rating || 0}/5\n`;
      
      // Count completed rides dynamically
      const totalRides = await db.countCompletedRides(user.user._id, 'driver');
      profileText += `📊 **Total Rides:** ${totalRides}\n`;
      
      // Check actual availability including time expiration
      const isActuallyAvailable = user.user.availability && 
                                   user.user.availableLocation &&
                                   (!user.user.timeTillAvailable || new Date(user.user.timeTillAvailable) > new Date());
      
      if (isActuallyAvailable) {
        profileText += `\n🟢 **Status:** Available\n`;
        if (user.user.availableLocation?.coordinates) {
          profileText += `📍 **Current Location:** Set\n`;
        }
        if (user.user.myRadiusOfAvailabilityMiles) {
          profileText += `📏 **Pickup Distance:** Up to ${user.user.myRadiusOfAvailabilityMiles} miles from your location\n`;
        }
        if (user.user.timeTillAvailable) {
          profileText += `⏰ **Available until:** ${formatDateTime(new Date(user.user.timeTillAvailable))}\n`;
        }
      } else {
        profileText += `\n🔴 **Status:** Not available\n`;
        if (user.user.timeTillAvailable && new Date(user.user.timeTillAvailable) <= new Date()) {
          profileText += `⏰ **Availability expired:** ${formatDateTime(new Date(user.user.timeTillAvailable))}\n`;
        }
      }

      profileText += `\n📅 **Member since:** ${new Date(user.user.createdAt).toLocaleDateString()}\n`;
      
      await debug("Building profile display", null, bot, msg.chat.id);
      await sendFinalMessage(bot, msg.chat.id, profileText, { 
        parse_mode: "Markdown",
        ...getDriverMainMenu()
      });
    } catch (err) {
      console.log("👤 PERF: Driver /me command failed after:", Date.now() - startTime, "ms");
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

      const updateButtons = {
        reply_markup: {
          inline_keyboard: [
            [
              { text: "📱 Phone Number", callback_data: "update_phone" },
              { text: "👤 Name", callback_data: "update_name" }
            ],
            [
              { text: "🚗 Vehicle Model", callback_data: "update_vehicle_model" },
              { text: "🎨 Vehicle Color", callback_data: "update_vehicle_color" }
            ],
            [
              { text: "🔢 License Plate", callback_data: "update_license_plate" }
            ],
            [
              { text: "@️⃣ Username", callback_data: "update_username" }
            ],
            [
              { text: "❌ Cancel", callback_data: "cancel_update" }
            ]
          ]
        }
      };

      await bot.sendMessage(
        msg.chat.id,
        "✏️ **Update Driver Profile**\n\nPlease select which field you want to update:",
        { parse_mode: "Markdown", ...updateButtons }
      );
    } catch (err) {
      await sendError(msg.chat.id, err, "Update command failed.");
    }
  });

  // /available command - Set availability
  bot.onText(/^\/available$/, async (msg) => {
    await debug("Processing /available command", { userId: msg.from.id }, bot, msg.chat.id);
    
    try {
      await debug("Checking driver registration", null, bot, msg.chat.id);
      const found = await ensureDriverRegistered(msg);
      if (!found) {
        await clearTempMessage(bot, msg.chat.id);
        return;
      }

      // Check if already in set_availability phase to prevent duplicates
      const tgId = msg.from.id.toString();
      const currentState = state.get(tgId) || {};
      if (currentState.phase === "set_availability") {
        await clearTempMessage(bot, msg.chat.id);
        return; // Silently ignore to prevent duplicate messages
      }

      // Check if already available
      await debug("Checking current availability status", null, bot, msg.chat.id);
      const driverId = found.user._id.toString();
      const currentAvailability = await performDriverCrud("getOpenAvailabilityByDriver", driverId);
      if (currentAvailability) {
        return sendFinalMessage(bot, msg.chat.id, "🟢 **Driver: Already Available**\n\n🚗 **DRIVER:** You are currently available for rides. Use /unavailable to stop accepting ride requests.\n\n⏱️ *Response time: 3-45 seconds due to AI processing*", { parse_mode: "Markdown", ...getAvailabilityButtons() });
      }

      // Check for active rides that prevent going available
      const mongoose = require('mongoose');
      const driverObjectId = mongoose.Types.ObjectId.isValid(found.user._id) ? 
        new mongoose.Types.ObjectId(found.user._id) : found.user._id;
      
      const activeRide = await Ride.findOne({
        driverId: driverObjectId,
        status: { $in: ["matched", "in_progress"] }
      });

      if (activeRide) {
        return bot.sendMessage(
          msg.chat.id,
          `⚠️ **Cannot Go Available**\n\nYou have an active ride that must be completed first:\n\n📍 ${activeRide.pickupLocationName} → ${activeRide.dropLocationName}\n💰 $${activeRide.bid}\n📊 Status: ${activeRide.status.toUpperCase()}\n\n**Please use /completed or /canceled to finish this ride before going available again.**\n\nThis prevents conflicts and ensures proper ride management.`,
          { parse_mode: "Markdown", ...getRideCompletionButtons() }
        );
      }

      state.set(msg.from.id.toString(), { phase: "set_availability" });
      
      const locationButtons = {
        reply_markup: {
          keyboard: [
            [{ text: "📍 Share My Location", request_location: true }]
          ],
          resize_keyboard: true,
          one_time_keyboard: true
        }
      };

      await bot.sendMessage(
        msg.chat.id,
        "🟢 **Set Your Availability**\n\n📍 **Share Your GPS Location**\n\nTap the \"Share My Location\" button below to set your availability with precise GPS coordinates.\n\n⚠️ **Note:** Maximum driving distance for ride pickup is 50 miles",
        { parse_mode: "Markdown", ...locationButtons }
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

      // Convert _id to string to ensure proper ObjectId handling
      const driverId = found.user._id.toString();
      
      const availability = await performDriverCrud("getOpenAvailabilityByDriver", driverId);
      if (!availability) {
        return bot.sendMessage(msg.chat.id, "🔴 **Driver: Already Unavailable**\n\n🚗 **DRIVER:** You are currently unavailable for rides. Use /available to start accepting ride requests.\n\n⏱️ *Response time: 3-45 seconds due to AI processing*", { parse_mode: "Markdown", ...getAvailabilityButtons() });
      }

      // Pass the driver ID string
      await performDriverCrud("closeDriverAvailability", driverId);
      const menu = await getContextAwareDriverMainMenu(found.user._id.toString());
      await bot.sendMessage(
        msg.chat.id,
        "🔴 **Driver: Availability Closed**\n\n🚗 **DRIVER:** You're no longer accepting new rides. Use /available when you're ready to drive again!\n\n⏱️ *Response time: 3-45 seconds due to AI processing*",
        { parse_mode: "Markdown", ...menu }
      );
    } catch (err) {
      console.error("Unavailable command error:", err);
      await sendError(msg.chat.id, err, "Unavailable command failed.");
    }
  });

  // /rides command - View rides
  bot.onText(/^\/rides$/, async (msg) => {
    try {
      const found = await ensureDriverRegistered(msg);
      if (!found) return;

      // Use db.getRidesByDriver directly to get the proper response structure
      const result = await db.getRidesByDriver(found.user._id);
      
      // Handle the response structure { success: true, data: rides }
      if (!result?.success || !result?.data || result.data.length === 0) {
        return bot.sendMessage(
          msg.chat.id,
          "🚗 **No Rides Yet**\n\nYou haven't completed any rides. Use /available to start accepting ride requests!",
          { parse_mode: "Markdown", ...getDriverMainMenu() }
        );
      }

      const rides = result.data; // Extract the actual rides array
      let ridesList = `🚗 **Your Rides (${rides.length})**\n\n`;
      rides.slice(0, 10).forEach((ride, index) => {
        const status = ride.status.toUpperCase();
        const time = ride.timeOfRide ? formatDateTime(new Date(ride.timeOfRide)) : 'ASAP';
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
        `**Ride Management:**\n` +
        `• /completed - Mark current ride as completed\n` +
        `• /canceled - Cancel current matched ride\n\n` +
        `**Profile Management:**\n` +
        `• /update - Update your details\n` +
        `• /erase - Delete your profile\n` +
        `• /rides - View your rides\n` +
        `• /stats - View your statistics\n` +
        `• /natural - Toggle natural language mode (save tokens)\n\n` +
        `**Setting Availability:**\n` +
        `• Use /available and share your GPS location for precise accuracy\n\n` +
        `**Natural Language:**\n` +
        `Use /natural to enable AI chat mode. When enabled, I understand:\n` +
        `• "Update my phone number to 555-0123"\n` +
        `• "I completed the ride"\n` +
        `• "I'm done for today"\n\n` +
        `**Note:** Availability setting requires GPS location sharing only.\n\n` +
        `⚠️ **Note:** Maximum driving distance for ride pickup is 50 miles\n\n` +
        `When disabled (default), use commands and buttons only to save tokens! 🤖`;

      const found = await ensureDriverRegistered(msg);
      const menu = found ? await getContextAwareDriverMainMenu(found.user._id.toString()) : getDriverMainMenu();
      await bot.sendMessage(msg.chat.id, helpText, { 
        parse_mode: "Markdown",
        ...menu
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
        await bot.sendMessage(msg.chat.id, "❌ **Cache Clear Failed**\n\nUnable to clear cache. Please try again later.", { parse_mode: "Markdown", ...getErrorButtons() });
      }
    } catch (err) {
      await sendError(msg.chat.id, err, "Cache clearing failed.");
    }
  });

  // /completed command - Mark current ride as completed
  bot.onText(/^\/completed$/, async (msg) => {
    try {
      const found = await ensureDriverRegistered(msg);
      if (!found) return;

      // Find the driver's current matched ride directly using Mongoose model
      const driverId = found.user._id;
      
      // Convert to ObjectId for proper MongoDB comparison
      const mongoose = require('mongoose');
      const driverObjectId = mongoose.Types.ObjectId.isValid(driverId) ? 
        new mongoose.Types.ObjectId(driverId) : driverId;
      
      console.log(`Driver ID Debug:`, {
        original: driverId,
        originalString: driverId.toString(),
        converted: driverObjectId,
        originalType: typeof driverId,
        isValidObjectId: mongoose.Types.ObjectId.isValid(driverId),
        isObjectId: driverId instanceof mongoose.Types.ObjectId
      });
      
      // Try multiple query approaches to debug the issue
      const matchedRideDirectId = await Ride.findOne({
        driverId: driverId, // Original ID
        status: { $in: ["matched", "in_progress"] }
      });
      
      const matchedRideStringId = await Ride.findOne({
        driverId: driverId.toString(), // String version
        status: { $in: ["matched", "in_progress"] }
      });
      
      const matchedRideObjectId = await Ride.findOne({
        driverId: driverObjectId, // ObjectId version
        status: { $in: ["matched", "in_progress"] }
      });
      
      console.log(`Query results:`, {
        directId: matchedRideDirectId ? 'Found' : 'Not found',
        stringId: matchedRideStringId ? 'Found' : 'Not found', 
        objectId: matchedRideObjectId ? 'Found' : 'Not found'
      });
      
      const matchedRide = matchedRideDirectId || matchedRideStringId || matchedRideObjectId;

      console.log(`Final result for driver ${driverId}:`, matchedRide ? 'Found' : 'Not found');

      if (!matchedRide) {
        const menu = await getContextAwareDriverMainMenu(found.user._id.toString());
        return bot.sendMessage(
          msg.chat.id,
          "❌ **No Active Ride**\n\nYou don't have any active rides to complete.\n\nUse /available to start accepting rides!",
          { parse_mode: "Markdown", ...menu }
        );
      }

      // Complete the ride by updating status
      const updateResult = await Ride.findOneAndUpdate(
        { _id: matchedRide._id },
        { 
          status: "completed",
          completedAt: new Date()
        }
      );

      console.log(`Ride completion update result:`, updateResult ? 'Success' : 'Failed');

      if (!updateResult) {
        const menu = await getContextAwareDriverMainMenu(found.user._id.toString());
        return bot.sendMessage(
          msg.chat.id,
          "❌ **Failed to Complete Ride**\n\nCould not update ride status. Please try again.",
          { parse_mode: "Markdown", ...menu }
        );
      }

      const menu = await getContextAwareDriverMainMenu(found.user._id.toString());
      await bot.sendMessage(
        msg.chat.id,
        `✅ **Ride Completed!**\n\n📍 From: ${matchedRide.pickupLocationName}\n📍 To: ${matchedRide.dropLocationName}\n� Time: ${matchedRide.timeOfRide ? new Date(matchedRide.timeOfRide).toLocaleString() : 'ASAP'}\n�💰 Amount: $${matchedRide.bid}\n\nThank you for using RideEase! 🚗`,
        { parse_mode: "Markdown", ...menu }
      );

      // Notify the rider
      try {
        const rider = await Rider.findOne({ _id: matchedRide.riderId });
        if (rider && rider.telegramId && rider.telegramId !== "1") {
          await notifications.notifyRider(
            rider,
            `✅ **Ride Completed!**\n\n📍 From: ${matchedRide.pickupLocationName}\n📍 To: ${matchedRide.dropLocationName}\n� Time: ${matchedRide.timeOfRide ? new Date(matchedRide.timeOfRide).toLocaleString() : 'ASAP'}\n�👤 Driver: ${found.user.name}\n💰 Amount: $${matchedRide.bid}\n\nThank you for using RideEase!`,
            { parse_mode: "Markdown" }
          );
        }
      } catch (err) {
        console.error("Failed to notify rider of ride completion:", err);
      }
    } catch (err) {
      await sendError(msg.chat.id, err, "Complete ride command failed.");
    }
  });

  // /canceled command - Cancel current ride
  bot.onText(/^\/canceled$/, async (msg) => {
    try {
      const found = await ensureDriverRegistered(msg);
      if (!found) return;

      // Find the driver's current matched ride directly using Mongoose model
      const driverId = found.user._id;
      
      // Convert to ObjectId for proper MongoDB comparison
      const mongoose = require('mongoose');
      const driverObjectId = mongoose.Types.ObjectId.isValid(driverId) ? 
        new mongoose.Types.ObjectId(driverId) : driverId;
      
      const matchedRide = await Ride.findOne({
        driverId: driverObjectId,
        status: { $in: ["matched", "in_progress"] }
      });

      if (!matchedRide) {
        return bot.sendMessage(
          msg.chat.id,
          "❌ **No Active Ride**\n\nYou don't have any active rides to cancel.",
          { parse_mode: "Markdown", ...getDriverMainMenu() }
        );
      }

      const confirmKb = {
        reply_markup: {
          inline_keyboard: [
            [
              { text: "✅ Yes, Cancel Ride", callback_data: `cancel_matched_ride_${matchedRide._id}` },
              { text: "❌ Keep Ride", callback_data: "keep_matched_ride" }
            ]
          ],
        },
      };

      await bot.sendMessage(
        msg.chat.id,
        `❓ **Cancel This Ride?**\n\n📍 From: ${matchedRide.pickupLocationName}\n📍 To: ${matchedRide.dropLocationName}\n💰 Amount: $${matchedRide.bid}\n\nAre you sure you want to cancel? This will notify the rider.`,
        { parse_mode: "Markdown", ...confirmKb }
      );
    } catch (err) {
      await sendError(msg.chat.id, err, "Cancel ride command failed.");
    }
  });

  // /stats command - View driver statistics
  bot.onText(/^\/stats$/, async (msg) => {
    try {
      const found = await ensureDriverRegistered(msg);
      if (!found) return;

      // Get driver stats using the dedicated function
      const statsResult = await db.getDriverStats(found.user._id);
      
      if (!statsResult?.success) {
        return bot.sendMessage(
          msg.chat.id,
          "❌ **Stats Not Available**\n\nUnable to fetch your statistics at the moment. Please try again later.",
          { parse_mode: "Markdown", ...getDriverMainMenu() }
        );
      }

      const stats = statsResult.data;
      let statsText = `📊 **Driver Statistics**\n\n`;
      statsText += `👤 **Driver:** ${found.user.name || 'Unknown'}\n`;
      statsText += `⭐ **Rating:** ${stats.rating || 0}/5\n\n`;
      
      statsText += `🚗 **Ride Summary:**\n`;
      statsText += `📈 **Total Rides:** ${stats.totalRides || 0}\n`;
      statsText += `✅ **Completed:** ${stats.completedRides || 0}\n`;
      statsText += `🔄 **Matched:** ${stats.matchedRides || 0}\n`;
      statsText += `❌ **Cancelled:** ${stats.cancelledRides || 0}\n\n`;
      
      if (stats.totalRides > 0) {
        statsText += `📊 **Performance:**\n`;
        statsText += `✅ **Success Rate:** ${(stats.successRate || 0).toFixed(1)}%\n`;
        statsText += `💰 **Total Earned:** $${stats.totalEarned || 0}\n`;
        statsText += `📈 **Avg Per Ride:** $${(stats.avgEarningsPerRide || 0).toFixed(2)}\n`;
      } else {
        statsText += `💡 **Ready to Start?**\nGo available to accept your first ride!`;
      }
      
      statsText += `\n\n📅 **Driver since:** ${new Date(found.user.createdAt).toLocaleDateString()}`;

      await bot.sendMessage(msg.chat.id, statsText, { 
        parse_mode: "Markdown",
        ...getDriverMainMenu()
      });
    } catch (err) {
      await sendError(msg.chat.id, err, "Stats command failed.");
    }
  });

  // /natural command - Toggle natural language mode
  bot.onText(/^\/natural$/, async (msg) => {
    try {
      const tgId = msg.from.id.toString();
      const currentState = state.get(tgId) || {};
      
      // Toggle natural language mode
      const isCurrentlyEnabled = currentState.naturalLanguageMode === true;
      
      if (isCurrentlyEnabled) {
        // Disable natural language mode
        state.set(tgId, { ...currentState, naturalLanguageMode: false });
        await bot.sendMessage(
          msg.chat.id,
          `🤖 **Natural Language Mode: OFF**\n\n` +
          `I will now only respond to:\n` +
          `• Commands (like /start, /me, /help)\n` +
          `• Button clicks\n\n` +
          `💡 Use /natural again to turn natural language back on.\n\n` +
          `📝 **Available Commands:**\n` +
          `• /start - Main menu\n` +
          `• /me - Profile\n` +
          `• /available - Start accepting rides\n` +
          `• /unavailable - Stop accepting rides\n` +
          `• /rides - View rides\n` +
          `• /stats - View statistics\n` +
          `• /help - Help menu\n` +
          `• /natural - Toggle natural language`,
          { parse_mode: "Markdown", ...getDriverMainMenu() }
        );
      } else {
        // Enable natural language mode
        state.set(tgId, { ...currentState, naturalLanguageMode: true });
        await bot.sendMessage(
          msg.chat.id,
          `🧠 **Driver: Natural Language Mode - ON**\n\n` +
          `🚗 **DRIVER MODE:** I can now understand natural messages like:\n` +
          `• "I'm available at downtown, 5 miles, for 3 hours"\n` +
          `• "Mark my current ride as completed"\n` +
          `• "I'm done for the day"\n` +
          `• "Update my phone number to 555-0123"\n\n` +
          `⚠️ **Note:** Maximum driving distance for ride pickup is 50 miles\n\n` +
          `💡 Use /natural again to turn off natural language mode and save tokens.\n\n` +
          `🎯 **This mode uses AI processing and may cost more tokens.**\n\n` +
          `⏱️ *Response time: 3-45 seconds due to AI processing*`,
          { parse_mode: "Markdown", ...getDriverMainMenu() }
        );
      }
    } catch (err) {
      await sendError(msg.chat.id, err, "Natural command failed.");
    }
  });
}

// Callback query handlers
function setupDriverCallbacks(bot) {
  // Remove any existing callback_query listeners to prevent duplicates
  bot.removeAllListeners('callback_query');
  
  bot.on("callback_query", async (cbq) => {
    const data = cbq.data;
    const chatId = cbq.message.chat.id;
    const tgId = cbq.from.id.toString();
    
    try {
      // Ensure MongoDB connection first
      await ensureMongoConnection();
      
      // Only check for session timeout on actions that require active state management
      // Skip timeout checks for simple menu navigation and read-only actions
      const readOnlyActions = [
        'view_rides', 'view_profile', 'show_help', 'main_menu', 
        'refresh', 'retry', 'cancel_delete', 'cancel_update', 'view_availability',
        'view_stats', 'view_ride_details'
      ];
      
      if (!readOnlyActions.includes(data)) {
        try {
          const state = require("./utils/state");
          await state.checkUserTimeout(tgId);
        } catch (timeoutErr) {
          console.error("⏰ Session timeout check failed:", timeoutErr);
        }
      }
      
      // Registration
      if (data === "register_driver") {
        state.set(tgId, { phase: "register_driver" });
        await bot.sendMessage(
          chatId,
          "🚗 **Driver Registration**\n\n🚗 **DRIVER:** Please send your details in this format:\n\n`Name, Phone, License Plate, Vehicle Color`\n\n**Example:**\n`John Smith, 555-0123, ABC123, Blue Honda`\n\n*Your Telegram username will be automatically detected.*\n\n⏱️ *Response time: 3-45 seconds due to AI processing*",
          { parse_mode: "Markdown" }
        );
        return bot.answerCallbackQuery(cbq.id);
      }

      // Privacy Policy - Driver Accept
      if (data === "accept_privacy_driver") {
        const currentState = state.get(tgId);
        if (!currentState?.registrationData) {
          await bot.sendMessage(chatId, "❌ **Registration Data Lost**\n\nPlease start registration again.", getRegistrationButtons());
          return bot.answerCallbackQuery(cbq.id);
        }

        // Complete registration after privacy policy acceptance
        const result = await performDriverCrud("createDriver", currentState.registrationData);
        
        if (!result?.success) {
          await bot.sendMessage(chatId, `❌ Registration failed: ${result?.error || "unknown error"}`, getErrorButtons());
          return bot.answerCallbackQuery(cbq.id);
        }

        state.clear(tgId);
        await bot.sendMessage(
          chatId,
          `✅ **Welcome to RideEase, ${currentState.registrationData.name}!**\n\n🚗 **DRIVER:** You're all set as a driver. Use /available when you're ready to start accepting rides!\n\n⚠️ **Privacy:** You can view, update, or delete your data anytime using the bot menu.\n\n⏱️ *Response time: 3-45 seconds due to AI processing*`,
          { parse_mode: "Markdown", ...getDriverMainMenu() }
        );
        return bot.answerCallbackQuery(cbq.id);
      }

      // Privacy Policy - Driver Decline
      if (data === "decline_privacy_driver") {
        state.clear(tgId);
        await bot.sendMessage(
          chatId,
          "❌ **Registration Cancelled**\n\nYour registration has been cancelled and no data has been stored.\n\n👋 Thank you for considering RideEase. You can start registration again anytime by sending /start.",
          { parse_mode: "Markdown" }
        );
        return bot.answerCallbackQuery(cbq.id);
      }

      // Main menu actions
      if (data === "go_available") {
        const found = await ensureDriverRegistered({ from: cbq.from, chat: { id: chatId } });
        if (!found) return bot.answerCallbackQuery(cbq.id);

        // Check if already in set_availability phase to prevent duplicates
        const currentState = state.get(tgId) || {};
        if (currentState.phase === "set_availability") {
          return bot.answerCallbackQuery(cbq.id, { text: "Already setting availability..." });
        }

        try {
          // Rate limiting for availability changes
          checkRateLimit(found.user._id.toString(), 'availability_change', 10, 60000); // 10 changes per minute
        } catch (error) {
          await bot.sendMessage(chatId, `❌ ${error.message}`, getErrorButtons());
          return bot.answerCallbackQuery(cbq.id);
        }

        // Check if already available
        const driverId = found.user._id.toString();
        const currentAvailability = await performDriverCrud("getOpenAvailabilityByDriver", driverId);
        if (currentAvailability) {
          await bot.sendMessage(chatId, "🟢 **Already Available**\n\nYou are currently available for rides. Use /unavailable to stop accepting ride requests.", { parse_mode: "Markdown", ...getAvailabilityButtons() });
          return bot.answerCallbackQuery(cbq.id);
        }

        // Check for active rides that prevent going available
        const mongoose = require('mongoose');
        const driverObjectId = mongoose.Types.ObjectId.isValid(found.user._id) ? 
          new mongoose.Types.ObjectId(found.user._id) : found.user._id;
        
        const activeRide = await Ride.findOne({
          driverId: driverObjectId,
          status: { $in: ["matched", "in_progress"] }
        });

        if (activeRide) {
          await bot.sendMessage(
            chatId,
            `⚠️ **Cannot Go Available**\n\nYou have an active ride that must be completed first:\n\n📍 ${activeRide.pickupLocationName} → ${activeRide.dropLocationName}\n💰 $${activeRide.bid}\n📊 Status: ${activeRide.status.toUpperCase()}\n\n**Please use /completed or /canceled to finish this ride before going available again.**\n\nThis prevents conflicts and ensures proper ride management.`,
            { parse_mode: "Markdown", ...getRideCompletionButtons() }
          );
          return bot.answerCallbackQuery(cbq.id);
        }

        state.set(tgId, { phase: "set_availability" });
        
        const locationButtons = {
          reply_markup: {
            keyboard: [
              [{ text: "📍 Share My Location", request_location: true }]
            ],
            resize_keyboard: true,
            one_time_keyboard: true
          }
        };

        await bot.sendMessage(
          chatId,
          "🟢 **Set Your Availability**\n\n📍 **Share Your GPS Location**\n\nTap the \"Share My Location\" button below to set your availability with precise GPS coordinates.\n\n⚠️ **Note:** Maximum driving distance for ride pickup is 50 miles",
          { parse_mode: "Markdown", ...locationButtons }
        );
        return bot.answerCallbackQuery(cbq.id);
      }

      if (data === "go_unavailable") {
        const found = await ensureDriverRegistered({ from: cbq.from, chat: { id: chatId } });
        if (!found) return bot.answerCallbackQuery(cbq.id);

        try {
          // Rate limiting for availability changes
          checkRateLimit(found.user._id.toString(), 'availability_change', 10, 60000); // 10 changes per minute
        } catch (error) {
          await bot.sendMessage(chatId, `❌ ${error.message}`, getErrorButtons());
          return bot.answerCallbackQuery(cbq.id);
        }

        // Convert _id to string to ensure proper ObjectId handling
        const driverId = found.user._id.toString();
        
        const availability = await performDriverCrud("getOpenAvailabilityByDriver", driverId);
        if (!availability) {
          await bot.sendMessage(chatId, "🔴 You're already unavailable.", getAvailabilityButtons());
        } else {
          // Pass the driver ID string
          await performDriverCrud("closeDriverAvailability", driverId);
          const menu = await getContextAwareDriverMainMenu(found.user._id.toString());
          await bot.sendMessage(
            chatId,
            "🔴 **Availability Closed**\n\nYou're no longer accepting new rides.",
            { parse_mode: "Markdown", ...menu }
          );
        }
        return bot.answerCallbackQuery(cbq.id);
      }

      if (data === "view_profile") {
        const found = await ensureDriverRegistered({ from: cbq.from, chat: { id: chatId } });
        if (!found) return bot.answerCallbackQuery(cbq.id);

        // Reuse the /me command logic
        const user = await performDriverCrud("findDriverByTelegramId", tgId);
        if (!user?.user) {
          await bot.sendMessage(chatId, "❌ Driver profile not found. Please register first.", getRegistrationButtons());
          return bot.answerCallbackQuery(cbq.id);
        }

        let profileText = `👤 **Driver Profile**\n\n`;
        profileText += `📝 **Name:** ${user.user.name || "Not set"}\n`;
        profileText += `📞 **Phone:** ${user.user.phoneNumber || "Not set"}\n`;
        profileText += `⭐ **Rating:** ${user.user.rating || 0}/5\n`;
        
        // Count completed rides dynamically
        const totalRides = await db.countCompletedRides(user.user._id, 'driver');
        profileText += `📊 **Total Rides:** ${totalRides}\n`;
        profileText += `🚗 **Vehicle:** ${user.user.vehicleColour || "N/A"} - ${user.user.licensePlateNumber || "N/A"}\n`;
        
        // Check for active availability
        const availability = await performDriverCrud("getOpenAvailabilityByDriver", user.user._id);
        if (availability) {
          profileText += `\n🟢 **Current Status:** Available for rides\n`;
          profileText += `📍 **Location:** ${availability.availableLocationName || "undefined"}\n`;
          profileText += `📏 **Pickup Distance:** Up to ${availability.myRadiusOfAvailabilityMiles || "undefined"} miles from your location\n`;
          if (availability.timeTillAvailable) {
            const endTime = new Date(availability.timeTillAvailable);
            profileText += `⏰ **Available until:** ${endTime.toLocaleTimeString()}\n`;
          }
        } else {
          profileText += `\n🔴 **Current Status:** Not available\n`;
          profileText += `📍 **Location:** undefined\n`;
          profileText += `📏 **Pickup Distance:** Not set\n`;
        }

        profileText += `\n📅 **Driver since:** ${new Date(user.user.createdAt).toLocaleDateString()}\n`;

        const menu = await getContextAwareDriverMainMenu(found.user._id.toString());
        await bot.sendMessage(chatId, profileText, { 
          parse_mode: "Markdown",
          ...menu
        });
        return bot.answerCallbackQuery(cbq.id);
      }

      if (data === "view_rides") {
        const found = await ensureDriverRegistered({ from: cbq.from, chat: { id: chatId } });
        if (!found) return bot.answerCallbackQuery(cbq.id);

        // Get driver's rides
        const result = await db.getRidesByDriver(found.user._id);
        
        if (!result?.success || !result?.data || result.data.length === 0) {
          const menu = await getContextAwareDriverMainMenu(found.user._id.toString());
          await bot.sendMessage(
            chatId,
            "🚗 **No Rides Yet**\n\nYou haven't accepted any rides yet. Go available to start accepting rides!",
            { parse_mode: "Markdown", ...menu }
          );
          return bot.answerCallbackQuery(cbq.id);
        }

        const rides = result.data;
        let ridesList = `🚗 **Your Rides (${rides.length})**\n\n`;
        rides.slice(0, 10).forEach((ride, index) => {
          const status = ride.status.toUpperCase();
          const time = ride.timeOfRide ? formatDateTime(new Date(ride.timeOfRide)) : 'ASAP';
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

        const menu = await getContextAwareDriverMainMenu(found.user._id.toString());
        await bot.sendMessage(chatId, ridesList, { 
          parse_mode: "Markdown",
          ...menu
        });
        return bot.answerCallbackQuery(cbq.id);
      }

      if (data === "view_stats") {
        const found = await ensureDriverRegistered({ from: cbq.from, chat: { id: chatId } });
        if (!found) return bot.answerCallbackQuery(cbq.id);

        // Get driver stats using the dedicated function
        const statsResult = await db.getDriverStats(found.user._id);
        
        if (!statsResult?.success) {
          await bot.sendMessage(
            chatId,
            "❌ **Stats Not Available**\n\nUnable to fetch your statistics at the moment. Please try again later.",
            { parse_mode: "Markdown", ...getDriverMainMenu() }
          );
          return bot.answerCallbackQuery(cbq.id);
        }

        const stats = statsResult.data;
        let statsText = `📊 **Driver Statistics**\n\n`;
        statsText += `👤 **Driver:** ${found.user.name || 'Unknown'}\n`;
        statsText += `⭐ **Rating:** ${stats.rating || 0}/5\n\n`;
        
        statsText += `🚗 **Ride Summary:**\n`;
        statsText += `📈 **Total Rides:** ${stats.totalRides || 0}\n`;
        statsText += `✅ **Completed:** ${stats.completedRides || 0}\n`;
        statsText += `🔄 **Matched:** ${stats.matchedRides || 0}\n`;
        statsText += `❌ **Cancelled:** ${stats.cancelledRides || 0}\n\n`;
        
        if (stats.totalRides > 0) {
          statsText += `📊 **Performance:**\n`;
          statsText += `✅ **Success Rate:** ${(stats.successRate || 0).toFixed(1)}%\n`;
          statsText += `💰 **Total Earned:** $${stats.totalEarned || 0}\n`;
          statsText += `📈 **Avg Per Ride:** $${(stats.avgEarningsPerRide || 0).toFixed(2)}\n`;
        } else {
          statsText += `💡 **Ready to Start?**\nGo available to accept your first ride!`;
        }
        
        statsText += `\n\n📅 **Driver since:** ${new Date(found.user.createdAt).toLocaleDateString()}`;

        const menu = await getContextAwareDriverMainMenu(found.user._id.toString());
        await bot.sendMessage(chatId, statsText, { 
          parse_mode: "Markdown",
          ...menu
        });
        return bot.answerCallbackQuery(cbq.id);
      }

      if (data === "update_details") {
        const found = await ensureDriverRegistered({ from: cbq.from, chat: { id: chatId } });
        if (!found) return bot.answerCallbackQuery(cbq.id);

        const updateButtons = {
          reply_markup: {
            inline_keyboard: [
              [
                { text: "📱 Phone Number", callback_data: "update_phone" },
                { text: "👤 Name", callback_data: "update_name" }
              ],
              [
                { text: "🚗 Vehicle Model", callback_data: "update_vehicle_model" },
                { text: "🎨 Vehicle Color", callback_data: "update_vehicle_color" }
              ],
              [
                { text: "🔢 License Plate", callback_data: "update_license_plate" }
              ],
              [
                { text: "@️⃣ Username", callback_data: "update_username" }
              ],
              [
                { text: "❌ Cancel", callback_data: "cancel_update" }
              ]
            ]
          }
        };

        await bot.sendMessage(
          chatId,
          "✏️ **Update Driver Profile**\n\nPlease select which field you want to update:",
          { parse_mode: "Markdown", ...updateButtons }
        );
        return bot.answerCallbackQuery(cbq.id);
      }

      // Individual field update callbacks
      if (data === "update_phone") {
        const found = await ensureDriverRegistered({ from: cbq.from, chat: { id: chatId } });
        if (!found) return bot.answerCallbackQuery(cbq.id);

        state.set(tgId, { phase: "update_driver_phone" });
        await bot.sendMessage(
          chatId,
          "📱 **Update Phone Number**\n\nPlease enter your new phone number:",
          { parse_mode: "Markdown" }
        );
        return bot.answerCallbackQuery(cbq.id);
      }

      if (data === "update_name") {
        const found = await ensureDriverRegistered({ from: cbq.from, chat: { id: chatId } });
        if (!found) return bot.answerCallbackQuery(cbq.id);

        state.set(tgId, { phase: "update_driver_name" });
        await bot.sendMessage(
          chatId,
          "👤 **Update Name**\n\nPlease enter your new name:",
          { parse_mode: "Markdown" }
        );
        return bot.answerCallbackQuery(cbq.id);
      }

      if (data === "update_vehicle_model") {
        const found = await ensureDriverRegistered({ from: cbq.from, chat: { id: chatId } });
        if (!found) return bot.answerCallbackQuery(cbq.id);

        state.set(tgId, { phase: "update_driver_vehicle_model" });
        await bot.sendMessage(
          chatId,
          "🚗 **Update Vehicle Model**\n\nPlease enter your vehicle model (e.g., Honda Civic, Toyota Camry):",
          { parse_mode: "Markdown" }
        );
        return bot.answerCallbackQuery(cbq.id);
      }

      if (data === "update_vehicle_color") {
        const found = await ensureDriverRegistered({ from: cbq.from, chat: { id: chatId } });
        if (!found) return bot.answerCallbackQuery(cbq.id);

        state.set(tgId, { phase: "update_driver_vehicle_color" });
        await bot.sendMessage(
          chatId,
          "🎨 **Update Vehicle Color**\n\nPlease enter your vehicle color (e.g., Blue, Red, White):",
          { parse_mode: "Markdown" }
        );
        return bot.answerCallbackQuery(cbq.id);
      }

      if (data === "update_license_plate") {
        const found = await ensureDriverRegistered({ from: cbq.from, chat: { id: chatId } });
        if (!found) return bot.answerCallbackQuery(cbq.id);

        state.set(tgId, { phase: "update_driver_license_plate" });
        await bot.sendMessage(
          chatId,
          "🔢 **Update License Plate**\n\nPlease enter your license plate number:",
          { parse_mode: "Markdown" }
        );
        return bot.answerCallbackQuery(cbq.id);
      }



      if (data === "update_username") {
        const found = await ensureDriverRegistered({ from: cbq.from, chat: { id: chatId } });
        if (!found) return bot.answerCallbackQuery(cbq.id);

        // Automatically update username from current user
        const telegramUsername = cbq.from.username ? `@${cbq.from.username}` : `@user_${tgId.slice(-8)}`;
        
        const result = await performDriverCrud("updateDriver", {
          telegramId: tgId,
          updates: { telegramUsername }
        });
        
        if (result?.success) {
          await bot.sendMessage(
            chatId,
            `✅ **Username Updated!**\n\nYour Telegram username has been automatically updated to: ${telegramUsername}`,
            { parse_mode: "Markdown", ...getDriverMainMenu() }
          );
        } else {
          await bot.sendMessage(
            chatId,
            `❌ Username update failed: ${result?.error || "unknown error"}`,
            { parse_mode: "Markdown", ...getDriverMainMenu() }
          );
        }
        return bot.answerCallbackQuery(cbq.id);
      }

      if (data === "cancel_update") {
        await bot.sendMessage(
          chatId,
          "❌ **Update Canceled**\n\nYour profile update has been canceled.",
          { parse_mode: "Markdown", ...getDriverMainMenu() }
        );
        return bot.answerCallbackQuery(cbq.id);
      }

      if (data === "show_help") {
        const helpText = `🚗 **Driver Bot Commands**\n\n` +
          `**Basic Commands:**\n` +
          `• /start - Show main menu\n` +
          `• /me - View your profile\n` +
          `• /help - Show this help message\n` +
          `• /time - Show current date and time\n` +
          `• /clearcache - Clear session cache\n\n` +
          `**Driver Commands:**\n` +
          `• /available - Go available for rides\n` +
          `• /unavailable - Stop accepting rides\n` +
          `• /rides - View your rides\n` +
          `• /stats - View your statistics\n\n` +
          `**Profile Management:**\n` +
          `• /update - Update your details\n` +
          `• /erase - Delete your profile\n\n` +
          `**How to Drive:**\n` +
          `1. Go available with GPS location or address\n` +
          `2. Accept rides from the menu\n` +
          `3. Contact riders via Telegram\n` +
          `4. Complete the ride\n\n` +
          `**Setting Availability:**\n` +
          `📍 **GPS Location:** Use /available and tap "Share My Location" for precise accuracy\n\n` +
          `**Troubleshooting:**\n` +
          `If you're experiencing issues, try /clearcache to clear your session state.\n\n` +
          `**Natural Language:**\n` +
          `Just tell me what you want to do! For example:\n` +
          `• "I'm available at Miami Airport for 2 hours"\n` +
          `• "Go unavailable"\n` +
          `• "Update my phone number to 555-0123"\n\n` +
          `I'll understand and help you! 🤖`;

        const found = await ensureDriverRegistered({ from: cbq.from, chat: { id: chatId } });
        const menu = found ? await getContextAwareDriverMainMenu(found.user._id.toString()) : getDriverMainMenu();
        await bot.sendMessage(chatId, helpText, { 
          parse_mode: "Markdown",
          ...menu
        });
        return bot.answerCallbackQuery(cbq.id);
      }

      // Accept ride from menu
      const acceptRide = data.match(/^accept_ride_(\d+)$/);
      if (acceptRide) {
        // Immediately respond to Telegram to prevent timeout
        bot.answerCallbackQuery(cbq.id, { text: '⏳ Processing your ride acceptance...' });
        
        const idx = parseInt(acceptRide[1], 10);
        const user = await performDriverCrud("findDriverByTelegramId", tgId);
        if (!user?.user || user.type !== "driver") {
          await bot.sendMessage(chatId, "❌ Driver not found or invalid user type");
          return;
        }
        
        const availability = await performDriverCrud("getOpenAvailabilityByDriver", user.user._id);
        if (!availability) {
          await bot.sendMessage(chatId, "❌ Your availability has changed. Please set availability again with /available after accepted ride completed", getAvailabilityButtons());
          return bot.answerCallbackQuery(cbq.id);
        }

        const matches = await matching.findMatchesForDriverAvailability(availability);
        const selectedMatch = matches[idx - 1];
        if (!selectedMatch) {
          await bot.sendMessage(chatId, "❌ That ride is no longer available.", getQuickActionButtons());
          return bot.answerCallbackQuery(cbq.id);
        }

        const ride = selectedMatch.ride;
        
        // ✅ ATOMIC TRANSACTION: Accept ride and close availability in single MongoDB transaction
        // This prevents race conditions where multiple drivers could accept the same ride
        // Uses MongoDB sessions to ensure both operations succeed together or both fail
        const acceptResult = await performDriverCrud("acceptRide", { rideId: ride._id, driverId: user.user._id });
        if (!acceptResult.success) {
          // Ensure driver stays available after failed acceptance
          console.log(`🚗 FAILED ACCEPTANCE: Driver ${user.user._id} failed to accept ride ${ride._id}, ensuring availability stays true`);
          
          // Explicitly refresh driver availability to ensure they stay available for future notifications
          await Driver.findByIdAndUpdate(user.user._id, { 
            $set: { availability: true }
          });
          
          // Clear cache to ensure fresh state for future notifications
          await performDriverCrud("clearUserCache", user.user.telegramId);
          
          await bot.sendMessage(chatId, `❌ **Failed to Accept Ride**\n\n${acceptResult.error}\n\n💡 Don't worry, you'll continue receiving notifications for new rides.`, getQuickActionButtons());
          return bot.answerCallbackQuery(cbq.id);
        }
        
        // Notify both parties
        const driver = user.user;
        const rider = await db.findById("riders", ride.riderId);
        
        // Send confirmation to driver using the centralized notification function
        await notifications.notifyDriverRideAccepted(driver, ride, rider, notifications.getRideCompletionButtons());

        // Notify rider about the driver accepting their ride
        try {
          if (!rider) {
            console.error("Rider not found for notification:", ride.riderId);
            // Continue with ride acceptance even if rider notification fails
          } else if (!rider.telegramId) {
            console.error("Rider telegramId missing:", { riderId: ride.riderId, rider: rider });
            // Continue with ride acceptance even if rider notification fails
          } else {
            console.log("Attempting to notify rider:", { 
              riderId: ride.riderId, 
              riderTelegramId: rider.telegramId,
              driverName: driver.name 
            });
            
            const riderNotificationResult = await notifications.notifyRider(
              rider,
              `🚗 **Driver Found!**\n\nYour ride has been accepted!\n\nDriver contact: @${driver.telegramUsername || driver.username || "(no username)"}\n📞 Phone: ${driver.phoneNumber || "Contact via Telegram"}\n🚗 Vehicle: ${driver.vehicleColour || "N/A"} - ${driver.licensePlateNumber || "N/A"}\n\n${summarizeRide(ride)}\n\n⚠️ **Important Notice:**\n• You cannot request new rides until this one is completed or canceled\n• **MUST** use /completed button after ride is finished\n• **MUST** use /canceled button if ride gets cancelled\n• Failure to mark completion will result in automatic cancellation\n\n📝 **Instructions:**\n• Contact driver for coordination\n• Use /completed or /canceled when appropriate`,
              { parse_mode: "Markdown", ...notifications.getRideCompletionButtons() }
            );
            
            console.log("Rider notification result:", riderNotificationResult);
            
            if (!riderNotificationResult?.ok && riderNotificationResult?.error) {
              console.error("Failed to notify rider:", riderNotificationResult.error);
            }
          }
        } catch (err) {
          console.error("Error notifying rider about ride acceptance:", err);
        }





        return bot.answerCallbackQuery(cbq.id);
      }

      // Handle accept specific ride from notification
      const acceptSpecificRide = data.match(/^accept_specific_ride_(.+)$/);
      if (acceptSpecificRide) {
        const rideId = acceptSpecificRide[1];
        const user = await performDriverCrud("findDriverByTelegramId", tgId);
        if (!user?.user || user.type !== "driver") return bot.answerCallbackQuery(cbq.id);
        
        // Check if driver still has availability
        const availability = await performDriverCrud("getOpenAvailabilityByDriver", user.user._id);
        if (!availability) {
          await bot.sendMessage(chatId, "⚠️ **Availability Expired**\n\nYour availability has changed. Please set availability again with /available.", getAvailabilityButtons());
          return bot.answerCallbackQuery(cbq.id);
        }

        // Find the specific ride
        const ride = await db.findById("rides", rideId);
        if (!ride || ride.status !== "open") {
          await bot.sendMessage(chatId, "❌ **Ride No Longer Available**\n\nThis ride has already been taken or cancelled.", getQuickActionButtons());
          return bot.answerCallbackQuery(cbq.id);
        }

        // Accept the ride using the proper transaction-safe function
        const acceptResult = await performDriverCrud("acceptRide", { rideId: ride._id, driverId: user.user._id });
        if (!acceptResult.success) {
          // Ensure driver stays available after failed acceptance
          console.log(`🚗 FAILED ACCEPTANCE: Driver ${user.user._id} failed to accept ride ${ride._id}, ensuring availability stays true`);
          
          // Explicitly refresh driver availability to ensure they stay available for future notifications
          await Driver.findByIdAndUpdate(user.user._id, { 
            $set: { availability: true }
          });
          
          // Clear cache to ensure fresh state for future notifications
          await performDriverCrud("clearUserCache", user.user.telegramId);
          
          await bot.sendMessage(chatId, `❌ **Failed to Accept Ride**\n\n${acceptResult.error}\n\n💡 Don't worry, you'll continue receiving notifications for new rides.`, getQuickActionButtons());
          return bot.answerCallbackQuery(cbq.id);
        }

        // Close driver availability after successful acceptance
        await performDriverCrud("closeDriverAvailability", user.user._id);
        
        // Notify both parties
        const driver = user.user;
        const rider = await db.findById("riders", ride.riderId);
        
        // Send confirmation to driver
        await notifications.notifyDriverRideAccepted(driver, ride, rider, notifications.getRideCompletionButtons());

        // Notify rider about the driver accepting their ride
        try {
          if (rider?.telegramId && rider.telegramId !== "1") {
            await notifications.notifyRiderDriverAccepted(rider, ride, driver);
          }
        } catch (err) {
          console.error("Error notifying rider about ride acceptance:", err);
        }

        // Edit the original message to show success
        try {
          await bot.editMessageText(
            `✅ **Ride Accepted!**\n\nYou have successfully accepted this ride. Check your notifications for details.`,
            {
              chat_id: chatId,
              message_id: cbq.message.message_id,
              parse_mode: 'Markdown'
            }
          );
        } catch (editError) {
          // If editing fails, send a new message
          await bot.sendMessage(chatId, `✅ **Ride Accepted!**\n\nYou have successfully accepted this ride.`, { parse_mode: 'Markdown' });
        }

        return;
      }

      // Handle view available rides from notification
      if (data === "view_available_rides") {
        const user = await performDriverCrud("findDriverByTelegramId", tgId);
        if (user?.type === "driver") {
          const availability = await performDriverCrud("getOpenAvailabilityByDriver", user.user._id);
          if (!availability) {
            await bot.sendMessage(chatId, "❌ **No Active Availability**\n\nYour availability has expired. Use /available to set availability again.", getAvailabilityButtons());
          } else {
            await showDriverRideMenu({ chat: { id: chatId } }, availability);
          }
        }
        return bot.answerCallbackQuery(cbq.id);
      }

      // Refresh rides menu
      if (data === "refresh_rides") {
        const user = await performDriverCrud("findDriverByTelegramId", tgId);
        if (user?.type === "driver") {
          const availability = await performDriverCrud("getOpenAvailabilityByDriver", user.user._id);
          if (!availability) {
            await bot.sendMessage(chatId, "❌ No active availability.", getAvailabilityButtons());
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

      // Handle matched ride cancellation confirmation
      const cancelMatchedRide = data.match(/^cancel_matched_ride_(.+)$/);
      if (cancelMatchedRide) {
        const rideId = cancelMatchedRide[1];
        const user = await performDriverCrud("findDriverByTelegramId", tgId);
        if (user?.user) {
          const result = await performDriverCrud("cancelRide", rideId, user.user._id.toString(), "driver", "Cancelled by driver");
          if (result?.success) {
            await bot.sendMessage(
              chatId,
              "❌ **Ride Cancelled**\n\nThe ride has been cancelled and the rider has been notified.",
              { parse_mode: "Markdown", ...getDriverMainMenu() }
            );
            
            // Notify the rider
            try {
              const ride = await db.findById("rides", rideId);
              if (ride) {
                const rider = await db.findById("riders", ride.riderId);
                if (rider) {
                  await notifications.notifyRider(
                    rider,
                    `❌ **Ride Cancelled**\n\nYour driver has cancelled the ride:\n\n${summarizeRide(ride)}\n\nYou can request a new ride anytime.`,
                    { parse_mode: "Markdown" }
                  );
                }
              }
            } catch (err) {
              console.error("Failed to notify rider of ride cancellation:", err);
            }
          } else {
            await bot.sendMessage(chatId, `❌ Failed to cancel ride: ${result?.error || "Unknown error"}`, getErrorButtons());
          }
        }
        return bot.answerCallbackQuery(cbq.id);
      }

      if (data === "keep_matched_ride") {
        const found = await ensureDriverRegistered({ from: cbq.from, chat: { id: chatId } });
        const menu = found ? await getContextAwareDriverMainMenu(found.user._id.toString()) : getDriverMainMenu();
        await bot.sendMessage(chatId, "✅ Ride kept. Continue with your journey!", menu);
        return bot.answerCallbackQuery(cbq.id);
      }

      // Handle cancel current ride from main menu
      if (data === "cancel_current_ride") {
        const found = await ensureDriverRegistered({ from: cbq.from, chat: { id: chatId } });
        if (!found) return bot.answerCallbackQuery(cbq.id);

        // Find the driver's current matched or in-progress ride
        const driverId = found.user._id;
        const mongoose = require('mongoose');
        const driverObjectId = mongoose.Types.ObjectId.isValid(driverId) ? 
          new mongoose.Types.ObjectId(driverId) : driverId;
        
        const matchedRide = await Ride.findOne({
          driverId: driverObjectId,
          status: { $in: ["matched", "in_progress"] }
        });

        if (!matchedRide) {
          const menu = await getContextAwareDriverMainMenu(found.user._id.toString());
          await bot.sendMessage(chatId, "❌ **No Active Ride**\n\nYou don't have any active rides to cancel.", menu);
          return bot.answerCallbackQuery(cbq.id);
        }

        const confirmKb = {
          reply_markup: {
            inline_keyboard: [
              [
                { text: "✅ Yes, Cancel Ride", callback_data: `cancel_matched_ride_${matchedRide._id}` },
                { text: "❌ Keep Ride", callback_data: "keep_matched_ride" }
              ]
            ],
          },
        };

        await bot.sendMessage(
          chatId,
          `❓ **Cancel This Ride?**\n\n📍 From: ${matchedRide.pickupLocationName}\n📍 To: ${matchedRide.dropLocationName}\n💰 Amount: $${matchedRide.bid}\n\nAre you sure you want to cancel? This will notify the rider.`,
          { parse_mode: "Markdown", ...confirmKb }
        );
        return bot.answerCallbackQuery(cbq.id);
      }

      // Handle cancel ride confirmation from natural language processing
      const cancelRideConfirm = data.match(/^cancel_ride_confirm_(.+)$/);
      if (cancelRideConfirm) {
        const rideId = cancelRideConfirm[1];
        const user = await performDriverCrud("findDriverByTelegramId", tgId);
        if (user?.user) {
          // Cancel the ride by updating status
          const updateResult = await Ride.findOneAndUpdate(
            { _id: rideId, driverId: user.user._id },
            { 
              status: "cancelled",
              cancelledAt: new Date(),
              cancelledBy: "driver",
              cancellationReason: "Cancelled by driver"
            },
            { new: true }
          );

          if (updateResult) {
            await bot.sendMessage(
              chatId,
              "❌ **Ride Cancelled**\n\nThe ride has been cancelled and the rider has been notified.",
              { parse_mode: "Markdown", ...getDriverMainMenu() }
            );
            
            // Notify the rider
            try {
              const rider = await Rider.findOne({ _id: updateResult.riderId });
              if (rider?.telegramId && rider.telegramId !== "1") {
                await notifications.notifyRider(
                  rider,
                  `❌ **Ride Cancelled**\n\n📍 From: ${updateResult.pickupLocationName}\n📍 To: ${updateResult.dropLocationName}\n\nYour driver has cancelled the ride. You can book another ride anytime!`,
                  { parse_mode: "Markdown" }
                );
              }
            } catch (err) {
              console.error("Failed to notify rider of ride cancellation:", err);
            }
          } else {
            await bot.sendMessage(chatId, "❌ Failed to cancel ride. Please try again.", getErrorButtons());
          }
        }
        return bot.answerCallbackQuery(cbq.id);
      }

      const cancelRideKeep = data.match(/^cancel_ride_keep_(.+)$/);
      if (cancelRideKeep) {
        await bot.sendMessage(chatId, "✅ Ride kept. Continue with your journey!", getDriverMainMenu());
        return bot.answerCallbackQuery(cbq.id);
      }

      // Handle set available at location
      if (data === "set_available_at_location") {
        const found = await ensureDriverRegistered({ from: cbq.from, chat: { id: chatId } });
        if (!found) return bot.answerCallbackQuery(cbq.id);

        const currentState = state.get(tgId) || {};
        if (!currentState.pendingLocation) {
          await bot.sendMessage(chatId, "❌ **Location Lost**\n\nLocation information was lost. Please send your location again.", getAvailabilityButtons());
          return bot.answerCallbackQuery(cbq.id);
        }

        // Check for active rides that prevent going available
        const mongoose = require('mongoose');
        const driverObjectId = mongoose.Types.ObjectId.isValid(found.user._id) ? 
          new mongoose.Types.ObjectId(found.user._id) : found.user._id;
        
        const activeRide = await Ride.findOne({
          driverId: driverObjectId,
          status: { $in: ["matched", "in_progress"] }
        });

        if (activeRide) {
          await bot.sendMessage(
            chatId,
            `⚠️ **Cannot Go Available**\n\nYou have an active ride that must be completed first:\n\n📍 ${activeRide.pickupLocationName} → ${activeRide.dropLocationName}\n💰 $${activeRide.bid}\n📊 Status: ${activeRide.status.toUpperCase()}\n\n**Please use /completed or /canceled to finish this ride before going available again.**`,
            { parse_mode: "Markdown", ...getRideCompletionButtons() }
          );
          return bot.answerCallbackQuery(cbq.id);
        }

        // Convert to availability setting phase with location
        const locationName = `${currentState.pendingLocation.latitude.toFixed(4)}, ${currentState.pendingLocation.longitude.toFixed(4)}`;
        
        try {
          const reverseResult = await geocode.reverseGeocode(currentState.pendingLocation.latitude, currentState.pendingLocation.longitude);
          if (reverseResult?.name) {
            state.set(tgId, { 
              phase: "set_availability_with_location", 
              location: {
                latitude: currentState.pendingLocation.latitude,
                longitude: currentState.pendingLocation.longitude,
                name: reverseResult.name
              }
            });
            
            await bot.sendMessage(
              chatId,
              `📍 **Location Set: ${reverseResult.name}**\n\nNow please tell me your pickup distance and duration:\n\n🚗 **Pickup Distance:** How far are you willing to drive to pick up riders?\n\n• Example: "10 miles pickup distance, for 3 hours"\n• Or: "pickup distance 15 miles, 2 hours"\n• Just: "5 miles, 4 hours"\n\n⚠️ **Note:** Maximum pickup distance is 50 miles`,
              { 
                parse_mode: "Markdown",
                reply_markup: { remove_keyboard: true }
              }
            );
          }
        } catch (err) {
          console.error("Reverse geocoding failed:", err);
          state.set(tgId, { 
            phase: "set_availability_with_location", 
            location: {
              latitude: currentState.pendingLocation.latitude,
              longitude: currentState.pendingLocation.longitude,
              name: locationName
            }
          });
          
          await bot.sendMessage(
            chatId,
            `📍 **Location Set: ${locationName}**\n\nNow please tell me your pickup distance and duration:\n\n🚗 **Pickup Distance:** How far are you willing to drive to pick up riders?\n\n• Example: "10 miles pickup distance, for 3 hours"\n• Or: "pickup distance 15 miles, 2 hours"\n• Just: "5 miles, 4 hours"\n\n⚠️ **Note:** Maximum pickup distance is 50 miles`,
            { 
              parse_mode: "Markdown",
              reply_markup: { remove_keyboard: true }
            }
          );
        }
        
        return bot.answerCallbackQuery(cbq.id);
      }

      // Handle main menu callback
      if (data === "main_menu") {
        const found = await ensureDriverRegistered({ from: cbq.from, chat: { id: chatId } });
        if (found) {
          const menu = await getContextAwareDriverMainMenu(found.user._id.toString());
          await bot.sendMessage(chatId, "🏠 **Main Menu**\n\nWhat would you like to do?", menu);
        } else {
          await bot.sendMessage(chatId, "👋 Please register first to access the menu.", getRegistrationButtons());
        }
        return bot.answerCallbackQuery(cbq.id);
      }

      // Handle enable natural language callback
      if (data === "enable_natural") {
        const currentState = state.get(tgId) || {};
        state.set(tgId, { ...currentState, naturalLanguageMode: true });
        await bot.sendMessage(
          chatId,
          `🧠 **Natural Language Mode: ON**\n\n` +
          `I can now understand natural messages like:\n` +
          `• "I'm available at downtown, 5 miles, for 3 hours"\n` +
          `• "Mark my current ride as completed"\n` +
          `• "I'm done for the day"\n` +
          `• "Update my phone number to 555-0123"\n\n` +
          `⚠️ **Note:** Maximum pickup distance is 50 miles\n\n` +
          `💡 Use /natural again to turn off natural language mode and save tokens.\n\n` +
          `🎯 **This mode uses AI processing and may cost more tokens.**`,
          { parse_mode: "Markdown", ...getDriverMainMenu() }
        );
        return bot.answerCallbackQuery(cbq.id);
      }

      // Handle retry callback
      if (data === "retry") {
        await bot.sendMessage(chatId, "🔄 **Try Again**\n\nPlease try your last action again or use the menu below.", getDriverMainMenu());
        return bot.answerCallbackQuery(cbq.id);
      }

      // Handle refresh callback
      if (data === "refresh") {
        await bot.sendMessage(chatId, "🔄 **Refreshed**\n\nContent has been refreshed. Use the menu below for available actions.", getDriverMainMenu());
        return bot.answerCallbackQuery(cbq.id);
      }

      // Handle mark completed callback
      if (data === "mark_completed") {
        const found = await ensureDriverRegistered({ from: cbq.from, chat: { id: chatId } });
        if (!found) {
          await bot.sendMessage(chatId, "👋 Please register first.", getRegistrationButtons());
          return bot.answerCallbackQuery(cbq.id);
        }

        // Find the driver's current matched or in-progress ride
        const driverId = found.user._id;
        const mongoose = require('mongoose');
        const driverObjectId = mongoose.Types.ObjectId.isValid(driverId) ? 
          new mongoose.Types.ObjectId(driverId) : driverId;
        
        const matchedRide = await Ride.findOne({
          driverId: driverObjectId,
          status: { $in: ["matched", "in_progress"] }
        });

        if (!matchedRide) {
          await bot.sendMessage(chatId, "❌ **No Active Ride**\n\nYou don't have any active rides to complete.", getDriverMainMenu());
          return bot.answerCallbackQuery(cbq.id);
        }

        // Complete the ride
        const updateResult = await Ride.findOneAndUpdate(
          { _id: matchedRide._id },
          { 
            status: "completed",
            completedAt: new Date()
          }
        );

        if (updateResult) {
          await bot.sendMessage(
            chatId,
            `✅ **Ride Completed!**\n\n📍 From: ${matchedRide.pickupLocationName}\n📍 To: ${matchedRide.dropLocationName}\n� Time: ${matchedRide.timeOfRide ? new Date(matchedRide.timeOfRide).toLocaleString() : 'ASAP'}\n�💰 Amount: $${matchedRide.bid}\n\nThank you for using RideEase! 🚗`,
            { parse_mode: "Markdown", ...getDriverMainMenu() }
          );

          // Notify the rider
          try {
            const rider = await Rider.findOne({ _id: matchedRide.riderId });
            if (rider && rider.telegramId && rider.telegramId !== "1") {
              await notifications.notifyRider(
                rider,
                `✅ **Ride Completed!**\n\n📍 From: ${matchedRide.pickupLocationName}\n📍 To: ${matchedRide.dropLocationName}\n� Time: ${matchedRide.timeOfRide ? new Date(matchedRide.timeOfRide).toLocaleString() : 'ASAP'}\n�👤 Driver: ${found.user.name}\n💰 Amount: $${matchedRide.bid}\n\nThank you for using RideEase!`,
                { parse_mode: "Markdown" }
              );
            }
          } catch (err) {
            console.error("Failed to notify rider of ride completion:", err);
          }
        } else {
          await bot.sendMessage(chatId, "❌ **Failed to Complete Ride**\n\nCould not update ride status. Please try again.", getErrorButtons());
        }
        return bot.answerCallbackQuery(cbq.id);
      }

      // Handle view ride details callback  
      if (data === "view_ride_details") {
        const found = await ensureDriverRegistered({ from: cbq.from, chat: { id: chatId } });
        if (!found) {
          await bot.sendMessage(chatId, "👋 Please register first.", getRegistrationButtons());
          return bot.answerCallbackQuery(cbq.id);
        }

        // Find current active ride
        const driverId = found.user._id;
        const mongoose = require('mongoose');
        const driverObjectId = mongoose.Types.ObjectId.isValid(driverId) ? 
          new mongoose.Types.ObjectId(driverId) : driverId;
        
        const activeRide = await Ride.findOne({
          driverId: driverObjectId,
          status: { $in: ["matched", "in_progress"] }
        });

        if (activeRide) {
          const statusText = activeRide.status === "matched" ? 
            "🔄 **Current Status:** Ride matched! Rider assigned" : 
            "🚗 **Current Status:** Ride in progress";
          
          await bot.sendMessage(
            chatId,
            `📋 **Current Ride Details**\n\n${statusText}\n\n📍 **From:** ${activeRide.pickupLocationName}\n📍 **To:** ${activeRide.dropLocationName}\n🕐 **Time:** ${new Date(activeRide.timeOfRide).toLocaleString()}\n💰 **Bid:** $${activeRide.bid}`,
            { parse_mode: "Markdown", ...getRideCompletionButtons() }
          );
        } else {
          await bot.sendMessage(chatId, "❌ **No Active Ride**\n\nYou don't have any active rides.", getDriverMainMenu());
        }
        return bot.answerCallbackQuery(cbq.id);
      }

      return bot.answerCallbackQuery(cbq.id);
    } catch (err) {
      await sendError(chatId, err, "Action failed.");
      try { await bot.answerCallbackQuery(cbq.id); } catch (_) {}
    }
  });
}

// Handle location messages (GPS coordinates)
async function handleLocationMessage(bot, msg) {
  const tgId = msg.from.id.toString();
  const st = state.get(tgId);
  
  try {
    await debug("Processing location message", { 
      lat: msg.location.latitude, 
      lon: msg.location.longitude 
    }, bot, msg.chat.id);

    // Check if driver is registered
    const found = await ensureDriverRegistered(msg);
    if (!found) {
      await clearTempMessage(bot, msg.chat.id);
      return;
    }

    // Check if we're in availability setting phase
    if (st?.phase === "set_availability") {
      await handleLocationAvailabilitySetting(bot, msg);
      return;
    }

    // Check if driver is already available
    await debug("Checking current availability status", null, bot, msg.chat.id);
    const driverId = found.user._id.toString();
    const currentAvailability = await performDriverCrud("getOpenAvailabilityByDriver", driverId);
    
    if (currentAvailability) {
      // Driver is already available - inform them
      const locationName = `${msg.location.latitude.toFixed(4)}, ${msg.location.longitude.toFixed(4)}`;
      
      await sendFinalMessage(
        bot,
        msg.chat.id,
        `🟢 **Already Available!**\n\nYou are currently available for rides at:\n📍 ${currentAvailability.locationName || 'Your set location'}\n📏 Pickup Distance: Up to ${currentAvailability.radiusMiles || 'Unknown'} miles from your location\n\n📍 **Location shared:** ${locationName}\n\nUse /unavailable to stop accepting rides first if you need to change your availability.`,
        { 
          parse_mode: "Markdown", 
          reply_markup: {
            inline_keyboard: [
              [
                { text: "� Go Unavailable", callback_data: "go_unavailable" }
              ],
              [
                { text: "🏠 Main Menu", callback_data: "main_menu" }
              ]
            ],
            remove_keyboard: true
          }
        }
      );
      return;
    }

    // If not available and not in any specific phase, offer to set availability with this location
    await sendFinalMessage(
      bot,
      msg.chat.id,
      `📍 **Location Received!**\n\nI received your location. Would you like to set your availability at this location?\n\n🗺️ **Coordinates:** ${msg.location.latitude.toFixed(6)}, ${msg.location.longitude.toFixed(6)}\n\nTap "Set Available Here" to continue with radius and duration settings.`,
      { 
        parse_mode: "Markdown", 
        reply_markup: {
          inline_keyboard: [
            [
              { text: "🟢 Set Available Here", callback_data: "set_available_at_location" }
            ],
            [
              { text: "🏠 Main Menu", callback_data: "main_menu" }
            ]
          ],
          remove_keyboard: true // Remove the location sharing keyboard
        }
      }
    );

    // Store location in state for later use
    state.set(tgId, { 
      ...st, 
      pendingLocation: { 
        latitude: msg.location.latitude, 
        longitude: msg.location.longitude 
      } 
    });

  } catch (err) {
    await sendError(msg.chat.id, err, "Location processing failed.");
  }
}

// Handle availability setting with GPS location
async function handleLocationAvailabilitySetting(bot, msg) {
  const tgId = msg.from.id.toString();
  
  try {
    await debug("Setting availability with GPS location", null, bot, msg.chat.id);

    // Get reverse geocoding to show user a readable address
    const clearTyping = await showTyping(bot, msg.chat.id);
    let locationName = "Current Location";
    
    try {
      const reverseResult = await geocode.reverseGeocode(msg.location.latitude, msg.location.longitude);
      locationName = reverseResult?.name || `${msg.location.latitude.toFixed(4)}, ${msg.location.longitude.toFixed(4)}`;
      clearTyping();
    } catch (err) {
      clearTyping();
      console.error("Reverse geocoding failed:", err);
      locationName = `${msg.location.latitude.toFixed(4)}, ${msg.location.longitude.toFixed(4)}`;
    }

    // Ask for radius and duration
    state.set(tgId, { 
      phase: "set_availability_with_location", 
      location: {
        latitude: msg.location.latitude,
        longitude: msg.location.longitude,
        name: locationName
      }
    });

    await sendFinalMessage(
      bot,
      msg.chat.id,
      `📍 **Location Set: ${locationName}**\n\nNow please tell me your pickup distance and duration:\n\n🚗 **Pickup Distance:** How far are you willing to drive to pick up riders?\n\n• Example: "10 miles pickup distance, for 3 hours"\n• Or: "pickup distance 15 miles, 2 hours"\n• Just: "5 miles, 4 hours"\n\n⚠️ **Note:** Maximum pickup distance is 50 miles`,
      { 
        parse_mode: "Markdown",
        reply_markup: { remove_keyboard: true }
      }
    );

  } catch (err) {
    await sendError(msg.chat.id, err, "Location availability setting failed.");
    state.clear(tgId);
  }
}

// Message handlers for natural language processing
function setupDriverMessageHandlers(bot) {
  // Remove any existing message listeners to prevent duplicates
  bot.removeAllListeners('message');
  
  bot.on("message", async (msg) => {
    try {
      // Ensure MongoDB connection first
      await ensureMongoConnection();
      await debug("Message received", { 
        userId: msg.from.id, 
        type: msg.location ? 'location' : 'text',
        text: msg.text?.substring(0, 50) + '...' 
      }, bot, msg.chat.id);
      
      // Handle location messages first
      if (msg.location) {
        await handleLocationMessage(bot, msg);
        return;
      }
      
      if (!msg.text || msg.via_bot || msg.edit_date) return;
      if (msg.text.startsWith('/')) return; // Skip commands
      
      const tgId = msg.from.id.toString();
      const st = state.get(tgId);
      
      // Only check for session timeout if user is in an active state that requires it
      // Skip timeout checks for users just sending casual messages
      const requiresTimeoutCheck = st && (
        st.phase === "register_driver" || 
        st.phase === "set_availability_with_location" || 
        st.phase === "update_driver" ||
        st.phase === "update_driver_phone" ||
        st.naturalLanguageMode === true
      );
      
      if (requiresTimeoutCheck) {
        try {
          const state = require("./utils/state");
          await state.checkUserTimeout(tgId);
        } catch (timeoutErr) {
          console.error("⏰ Session timeout check failed:", timeoutErr);
        }
      }

      // Check for natural language mode - if disabled, only process registration and special phases
      if (st?.naturalLanguageMode !== true && 
          st?.phase !== "register_driver" && 
          st?.phase !== "set_availability_with_location" &&
          st?.phase !== "update_driver" &&
          st?.phase !== "update_driver_phone" &&
          st?.phase !== "update_driver_name" &&
          st?.phase !== "update_driver_vehicle_model" &&
          st?.phase !== "update_driver_vehicle_color" &&
          st?.phase !== "update_driver_license_plate" &&
          st?.phase !== "update_driver_username") {
        await debug("Natural language mode disabled, showing command menu", null, bot, msg.chat.id);
        await clearTempMessage(bot, msg.chat.id);
        return bot.sendMessage(
          msg.chat.id,
          `🤖 **Driver: Command Mode Active**\n\n` +
          `🚗 **DRIVER MODE:** I didn't understand that. I only respond to commands and buttons.\n\n` +
          `📝 **Available Commands for DRIVERS:**\n` +
          `• /start - Main menu\n` +
          `• /me - View profile\n` +
          `• /available - Start accepting rides (GPS location required)\n` +
          `• /unavailable - Stop accepting rides\n` +
          `• /rides - View your rides\n` +
          `• /stats - View statistics\n` +
          `• /help - Get help\n\n` +
          `📍 **GPS Location Required:** Use /available and share your precise location to start driving!\n\n` +
          `🧠 **Want natural language?** Use /natural to enable AI chat mode.\n\n` +
          `⏱️ *Response time: 3-45 seconds due to AI processing*`,
          { 
            parse_mode: "Markdown",
            reply_markup: {
              inline_keyboard: [
                [
                  { text: "🏠 Main Menu", callback_data: "main_menu" },
                  { text: "🧠 Enable Natural Language", callback_data: "enable_natural" }
                ],
                [
                  { text: "❓ Help", callback_data: "show_help" }
                ]
              ]
            }
          }
        );
      }

      // Only sanitize text if we're going to process it with OpenAI
      const text = openai.sanitizeInput(msg.text.trim());

      // Handle registration
      if (st?.phase === "register_driver") {
        console.log(`Processing driver registration for ${tgId} with text: ${text.substring(0, 100)}...`);
        
        const parts = text.split(",").map(s => s.trim());
        console.log(`Registration parts count: ${parts.length}`);
        
        if (parts.length < 4) {
          return bot.sendMessage(
            msg.chat.id,
            "❌ Please send all 4 required fields:\n`Name, Phone, License Plate, Vehicle Color`\n\n*Your Telegram username will be automatically detected.*",
            { parse_mode: "Markdown" }
          );
        }
        
        const [name, phoneNumber, licensePlateNumber, vehicleColour] = parts;
        // Automatically get the telegram username from the message sender
        const telegramUsername = msg.from.username ? `@${msg.from.username}` : `@user_${tgId.slice(-8)}`;
        console.log(`Registration data:`, { name, phoneNumber, telegramUsername, licensePlateNumber, vehicleColour });
        
        // Validate all fields using the validation utility
        const validationErrors = validation.validateDriverRegistration({
          name, 
          phoneNumber, 
          telegramUsername, 
          licensePlateNumber, 
          vehicleColour
        });
        
        console.log(`Validation errors count: ${validationErrors.length}`);
        
        if (validationErrors.length > 0) {
          const errorMsg = "❌ **Registration Validation Errors:**\n\n" + 
            validationErrors.map(err => `• ${err}`).join('\n') + 
            "\n\nPlease fix these issues and try again.";
          return bot.sendMessage(msg.chat.id, errorMsg, { parse_mode: "Markdown" });
        }
        
        console.log(`Creating driver with data...`);
        
        // Store registration data temporarily for privacy policy acceptance
        state.set(tgId, { 
          phase: "privacy_policy_driver",
          registrationData: {
            name,
            phoneNumber: validation.normalizePhone(phoneNumber), 
            telegramId: tgId, 
            telegramUsername, 
            licensePlateNumber: licensePlateNumber.toUpperCase(), 
            vehicleColour: vehicleColour.toLowerCase()
          }
        });
        
        // Send privacy policy acceptance prompt
        const privacyPolicyButtons = {
          reply_markup: {
            inline_keyboard: [
              [
                { text: "✅ Accept & Register", callback_data: "accept_privacy_driver" },
                { text: "❌ Decline & Erase", callback_data: "decline_privacy_driver" }
              ],
              [
                { text: "📄 Read Privacy Policy", url: "https://iboulevardi.app/privacy" }
              ]
            ]
          }
        };
        
        await bot.sendMessage(
          msg.chat.id,
          `📋 **Privacy Policy & Terms**\n\n${name}, before completing your driver registration, please review and accept our Privacy Policy.\n\n🔒 **Your privacy matters to us!**\n\n**What we collect:**\n• Name, phone number, and vehicle details\n• Location data when you're available for rides\n• Ride history and ratings\n\n**How we use it:**\n• Match you with nearby riders\n• Process payments and ride coordination\n• Improve our service quality\n\n**Your rights:**\n• View, update, or delete your data anytime\n• Control location sharing\n• Contact us with privacy concerns\n\n📄 **Please read our full Privacy Policy and accept to continue.**`,
          { parse_mode: "Markdown", ...privacyPolicyButtons }
        );
        return;
      }

      // Handle availability setting with GPS location (radius and duration input)
      if (st?.phase === "set_availability_with_location") {
        await handleAvailabilityWithLocationParams(bot, msg, text);
        return;
      }

      // Handle update phase
      if (st?.phase === "update_driver") {
        await handleDriverUpdate(bot, msg, text);
        return;
      }

      // Handle individual field updates
      if (st?.phase === "update_driver_phone") {
        await handleDriverFieldUpdate(bot, msg, text, "phoneNumber", "Phone Number");
        return;
      }

      if (st?.phase === "update_driver_name") {
        await handleDriverFieldUpdate(bot, msg, text, "name", "Name");
        return;
      }

      if (st?.phase === "update_driver_vehicle_model") {
        await handleDriverFieldUpdate(bot, msg, text, "vehicleModel", "Vehicle Model");
        return;
      }

      if (st?.phase === "update_driver_vehicle_color") {
        await handleDriverFieldUpdate(bot, msg, text, "vehicleColour", "Vehicle Color");
        return;
      }

      if (st?.phase === "update_driver_license_plate") {
        await handleDriverFieldUpdate(bot, msg, text, "licensePlateNumber", "License Plate");
        return;
      }



      if (st?.phase === "update_driver_username") {
        // Username is now automatically detected, so clear state and inform user
        state.clear(tgId);
        await bot.sendMessage(
          msg.chat.id,
          "ℹ️ **Username Auto-Detection**\n\nYour Telegram username is now automatically detected and updated. No manual input needed!\n\nCurrent username: " + (msg.from.username ? `@${msg.from.username}` : `@user_${tgId.slice(-8)}`),
          { parse_mode: "Markdown", ...getDriverMainMenu() }
        );
        return;
      }

      // Ensure registered for other messages
      await debug("Checking driver registration", null, bot, msg.chat.id);
      const found = await ensureDriverRegistered(msg);
      if (!found) {
        await clearTempMessage(bot, msg.chat.id);
        return;
      }

      // Show typing indicator while processing
      await debug("Starting AI analysis", null, bot, msg.chat.id);
      const clearTyping = await showTyping(bot, msg.chat.id);

      try {
        // Process with OpenAI for intent detection
        await debug("Analyzing your message with AI", null, bot, msg.chat.id);
        const intent = await openai.detectIntent(text, "driver");
        await debug("AI analysis completed, processing your request", null, bot, msg.chat.id);
        clearTyping();
        await handleDriverIntent(bot, msg, intent, found);
      } catch (err) {
        clearTyping();
        await clearTempMessage(bot, msg.chat.id);
        throw err;
      }

    } catch (err) {
      await sendError(msg.chat.id, err, "Message processing failed.");
    }
  });
}

// Handle availability setting when location is already provided via GPS
async function handleAvailabilityWithLocationParams(bot, msg, text) {
  const tgId = msg.from.id.toString();
  const st = state.get(tgId);
  
  if (!st?.location) {
    state.clear(tgId);
    return bot.sendMessage(msg.chat.id, "❌ **Location Lost**\n\nLocation information was lost. Please send your location again or use /available.", getAvailabilityButtons());
  }
  
  try {
    await debug("Processing radius and duration with GPS location", null, bot, msg.chat.id);
    const clearTyping = await showTyping(bot, msg.chat.id);
    
    // Use OpenAI to extract radius and duration from text
    const intent = await openai.detectIntent(text, "driver", "Extract radius in miles and duration in hours from this text about driver availability");
    clearTyping();
    
    let radiusMiles, hours;
    
    // Use OpenAI parsing exclusively - no manual regex fallback
    if (intent?.fields?.radiusMiles && intent.fields.radiusMiles > 0) {
      radiusMiles = intent.fields.radiusMiles;
      hours = intent.fields.hours || 1; // Default to 1 hour if not specified
      await debug(`OpenAI parsed: radius=${radiusMiles}, hours=${hours}`, { intent: intent.fields }, bot, msg.chat.id);
    } else {
      await debug(`OpenAI parsing failed or incomplete`, { intent }, bot, msg.chat.id);
      return bot.sendMessage(
        msg.chat.id,
        "❌ **Unable to Parse Request**\n\nI couldn't understand your availability settings. Please try:\n• \"10 miles pickup distance, for 3 hours\"\n• \"5 miles, 2 hours\"\n• \"pickup distance 15 miles, 4 hrs\""
      );
    }
    
    if (!radiusMiles || radiusMiles <= 0) {
      return bot.sendMessage(
        msg.chat.id,
        "❌ **Pickup Distance Required**\n\nI need to know how far you're willing to drive to pick up riders. Try:\n• \"10 miles pickup distance, for 3 hours\"\n• \"5 miles, 2 hours\"\n• \"pickup distance 15 miles\""
      );
    }

    // Validate radius limit
    if (radiusMiles > 50) {
      return bot.sendMessage(
        msg.chat.id,
        "❌ **Pickup Distance Too Large**\n\nMaximum pickup distance is 50 miles. Please set a pickup distance between 1-50 miles.",
        { parse_mode: "Markdown" }
      );
    }

    if (radiusMiles < 1) {
      return bot.sendMessage(
        msg.chat.id,
        "❌ **Pickup Distance Too Small**\n\nMinimum pickup distance is 1 mile. Please set a pickup distance between 1-50 miles.",
        { parse_mode: "Markdown" }
      );
    }

    // Set availability using the stored GPS location
    const user = await performDriverCrud("findDriverByTelegramId", tgId);
    const availability = await performDriverCrud("setDriverAvailability", {
      telegramId: tgId,
      isAvailable: true,
      currentLocation: { 
        type: "Point", 
        coordinates: [st.location.longitude, st.location.latitude], 
        name: st.location.name 
      },
      radiusMiles: radiusMiles,
      durationHours: hours
    });

    if (!availability?.success) {
      return bot.sendMessage(msg.chat.id, `❌ **Availability Setup Failed**\n\n${availability?.error || "unknown error"}\n\nPlease try again.`, getAvailabilityButtons());
    }

    await bot.sendMessage(
      msg.chat.id,
      `🟢 **You're Now Available!**\n\n📍 **Location:** ${st.location.name}\n📏 **Pickup Distance:** Up to ${radiusMiles} miles from your location\n⏰ **Duration:** ${hours ? `${hours} hours` : 'until you go unavailable'}\n\n🔍 Looking for rides nearby...`,
      { parse_mode: "Markdown" }
    );

    // Show available rides
    try {
      await showDriverRideMenu(msg, availability.data);
    } catch (err) {
      console.error("Failed to show ride menu:", err);
    }
      
    // Clear state
    state.clear(tgId);
    
  } catch (err) {
    await sendError(msg.chat.id, err, "Availability setting with location failed.");
    state.clear(tgId);
  }
}

async function handleAvailabilitySetting(bot, msg, text) {
  const tgId = msg.from.id.toString();
  
  try {
    // Show typing indicator while processing intent
    await debug("Processing availability setting", null, bot, msg.chat.id);
    const clearTyping = await showTyping(bot, msg.chat.id);
    
    const intent = await openai.detectIntent(text, "driver");
    clearTyping();
    
    if (intent?.type === "driver_availability") {
      const { address, radiusMiles, hours } = intent.fields || {};
      
      if (!address || !radiusMiles) {
        return bot.sendMessage(
          msg.chat.id,
          "❌ I need your address and pickup distance. Try:\n\"I'm available at [your address], pickup distance [X] miles, for [Y] hours\""
        );
      }

      // Validate radius limit
      if (radiusMiles > 50) {
        return bot.sendMessage(
          msg.chat.id,
          "❌ **Pickup Distance Too Large**\n\nMaximum pickup distance is 50 miles. Please set a pickup distance between 1-50 miles.\n\nExample: \"I'm available at [your address], pickup distance 15 miles, for 3 hours\"",
          { parse_mode: "Markdown" }
        );
      }

      if (radiusMiles < 1) {
        return bot.sendMessage(
          msg.chat.id,
          "❌ **Pickup Distance Too Small**\n\nMinimum pickup distance is 1 mile. Please set a pickup distance between 1-50 miles.\n\nExample: \"I'm available at [your address], pickup distance 5 miles, for 3 hours\"",
          { parse_mode: "Markdown" }
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
        return bot.sendMessage(msg.chat.id, "❌ **Address Not Found**\n\nCouldn't locate that address. Please provide a more specific address with city and state.", getAvailabilityButtons());
      }

      if (!center) {
        return bot.sendMessage(msg.chat.id, "❌ **Location Error**\n\nCouldn't process that address. Please try again with a valid location.", getAvailabilityButtons());
      }

      const user = await performDriverCrud("findDriverByTelegramId", tgId);
      const availability = await performDriverCrud("setDriverAvailability", {
        telegramId: tgId,
        isAvailable: true,
        currentLocation: { type: "Point", coordinates: [center.lon, center.lat], name: center.name },
        radiusMiles: radiusMiles,
        durationHours: hours
      });

      if (!availability?.success) {
        return bot.sendMessage(msg.chat.id, `❌ **Availability Setup Failed**\n\n${availability?.error || "unknown error"}\n\nPlease try again.`, getAvailabilityButtons());
      }

      await bot.sendMessage(
        msg.chat.id,
        `🟢 **You're Now Available!**\n\n📍 Location: ${center.name}\n📏 Pickup Distance: Up to ${radiusMiles} miles from your location\n⏰ Duration: ${hours || 'until you go unavailable'} hours\n\nLooking for rides nearby...`,
        { parse_mode: "Markdown" }
      );

      // Show available rides before clearing state to ensure proper context
      try {
        await showDriverRideMenu(msg, availability.data);
      } catch (err) {
        console.error("Failed to show ride menu:", err);
      }
      
      // Clear state only after all operations are complete
      state.clear(tgId);
      
    } else {
      await bot.sendMessage(
        msg.chat.id,
        "❌ I didn't understand that. Please tell me:\n• Your location/address\n• Pickup distance in miles (max 50 miles) - how far you'll drive to pick up riders\n• How long you'll be available\n\nExample: \"I'm available at Downtown Miami, 10 miles pickup distance, for 4 hours\""
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
    
    // Check if it's comma-delimited format
    if (text.includes(',')) {
      clearTyping();
      const parts = text.split(",").map(s => s.trim());
      if (parts.length >= 4) {
        const [name, phoneNumber, licensePlateNumber, vehicleColour] = parts;
        // Automatically get the telegram username from the message sender
        const telegramUsername = msg.from.username ? `@${msg.from.username}` : `@user_${tgId.slice(-8)}`;
        
        // Validate the update data
        const validationErrors = validation.validateDriverRegistration({
          name,
          phoneNumber,
          telegramUsername,
          licensePlateNumber,
          vehicleColour
        });

        if (validationErrors.length > 0) {
          return bot.sendMessage(
            msg.chat.id,
            `❌ Validation Error:\n${validationErrors.map(err => `• ${err}`).join('\n')}\n\nPlease fix these issues and try again.`
          );
        }
        
        const result = await performDriverCrud("updateDriver", {
          telegramId: tgId,
          updates: { name, phoneNumber, telegramUsername, licensePlateNumber, vehicleColour }
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
    const updateIntent = await openai.detectIntent(text, "driver");
    clearTyping2();
    
    if (updateIntent?.type === "driver_update" && updateIntent?.fields) {
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
        "❌ I didn't understand what you want to update.\n\n**Try these examples:**\n• \"Update my number to 555-0123\"\n• \"Change my name to John Smith\"\n• \"Update my license plate to ABC123\"\n• \"Update my vehicle color to blue\"\n\n**Or send all details:**\n`Name, Phone, License, Color`\n\n*Your Telegram username will be automatically detected.*",
        { parse_mode: "Markdown" }
      );
    }
  } catch (err) {
    await sendError(msg.chat.id, err, "Update failed.");
    state.clear(tgId);
  }
}

function extractFieldValue(text, fieldName) {
  const input = text.trim();
  
  // Extract value from natural language patterns first
  if (fieldName === "phoneNumber") {
    // Match phone numbers - prioritize patterns with context words
    const phonePatterns = [
      /(?:my\s+)?(?:phone|number|mobile|cell)(?:\s+is\s+|\s+to\s+|\s*[:=]\s*)(\+?[\d\-\(\)\s]+)/i,
      /phone\s*[:=]\s*(\+?[\d\-\(\)\s]+)/i,
      /(\+?[\d\-\(\)\s]{7,})/
    ];
    for (const pattern of phonePatterns) {
      const match = input.match(pattern);
      if (match) return match[1].trim();
    }
  }
  
  else if (fieldName === "name") {
    // Match names - prioritize patterns with context words
    const namePatterns = [
      /(?:my\s+)?name(?:\s+is\s+|\s+to\s+|\s*[:=]\s*)([a-zA-Z\s\-']+)/i,
      /^([a-zA-Z\s\-']+)$/
    ];
    for (const pattern of namePatterns) {
      const match = input.match(pattern);
      if (match) return match[1].trim();
    }
  }
  
  else if (fieldName === "telegramUsername") {
    // Match usernames - prioritize patterns with context words
    const usernamePatterns = [
      /(?:my\s+)?(?:username|handle)(?:\s+is\s+|\s+to\s+|\s*[:=]\s*)(@?[a-zA-Z0-9_]+)/i,
      /username\s*[:=]\s*(@?[a-zA-Z0-9_]+)/i,
      /^(@?[a-zA-Z0-9_]+)$/
    ];
    for (const pattern of usernamePatterns) {
      const match = input.match(pattern);
      if (match) return match[1].trim();
    }
  }
  
  else if (fieldName === "vehicleModel") {
    // Match vehicle models - prioritize patterns with context words
    const modelPatterns = [
      /(?:my\s+)?(?:car|vehicle)(?:\s+model)?(?:\s+is\s+|\s+to\s+|\s*[:=]\s*)([a-zA-Z0-9\s]+)/i,
      /(?:model|car)\s*[:=]\s*([a-zA-Z0-9\s]+)/i,
      /^([a-zA-Z0-9\s]+)$/
    ];
    for (const pattern of modelPatterns) {
      const match = input.match(pattern);
      if (match) return match[1].trim();
    }
  }
  
  else if (fieldName === "vehicleColour") {
    // Match vehicle colors - prioritize patterns with context words
    const colorPatterns = [
      /(?:my\s+)?(?:car|vehicle)(?:\s+)?(?:color|colour)(?:\s+is\s+|\s+to\s+|\s*[:=]\s*)([a-zA-Z\s]+)/i,
      /(?:color|colour)\s*[:=]\s*([a-zA-Z\s]+)/i,
      /^([a-zA-Z\s]+)$/
    ];
    for (const pattern of colorPatterns) {
      const match = input.match(pattern);
      if (match) return match[1].trim();
    }
  }
  
  else if (fieldName === "licensePlateNumber") {
    // Match license plates - prioritize patterns with context words
    const platePatterns = [
      /(?:my\s+)?(?:license\s+plate|plate)(?:\s+number)?(?:\s+is\s+|\s+to\s+|\s*[:=]\s*)([a-zA-Z0-9\-\s]+)/i,
      /(?:plate|license)\s*[:=]\s*([a-zA-Z0-9\-\s]+)/i,
      /^([a-zA-Z0-9\-\s]+)$/
    ];
    for (const pattern of platePatterns) {
      const match = input.match(pattern);
      if (match) return match[1].trim();
    }
  }
  

  
  // Fallback: return the input as is
  return input;
}

async function handleDriverFieldUpdate(bot, msg, text, fieldName, fieldDisplayName) {
  const tgId = msg.from.id.toString();
  
  try {
    // Extract actual value from input (handles both raw values and natural language)
    let value = extractFieldValue(text, fieldName);
    
    // Field-specific validation
    if (fieldName === "phoneNumber") {
      if (!value || !/^\+?[\d\-\(\)\s]{7,}$/.test(value.replace(/[\s\-\(\)]/g, ''))) {
        return bot.sendMessage(
          msg.chat.id,
          "❌ **Invalid Phone Number**\n\nPlease enter a valid phone number:\n• Just the number: `7542696640`\n• With formatting: `+1-754-269-6640`\n• Or: `(754) 269-6640`"
        );
      }
      // Clean up phone number
      value = value.replace(/[\s\-\(\)]/g, '');
    }
    
    else if (fieldName === "telegramUsername") {
      if (!value.startsWith('@')) {
        value = '@' + value;
      }
      if (!/^@[a-zA-Z0-9_]{3,32}$/.test(value)) {
        return bot.sendMessage(
          msg.chat.id,
          "❌ **Invalid Username**\n\nPlease enter a valid Telegram username:\n• Just username: `johnsmith`\n• With @: `@johnsmith`\n• Letters, numbers, underscores only"
        );
      }
    }
    
    else if (fieldName === "name") {
      if (!value || value.length < 2 || value.length > 50 || !/^[a-zA-Z\s\-']+$/.test(value)) {
        return bot.sendMessage(
          msg.chat.id,
          "❌ **Invalid Name**\n\nPlease enter a valid name:\n• 2-50 characters\n• Letters, spaces, hyphens, apostrophes only\n• Example: `John Smith`"
        );
      }
    }
    
    else if (fieldName === "vehicleModel") {
      if (!value || value.length < 2 || value.length > 50) {
        return bot.sendMessage(
          msg.chat.id,
          "❌ **Invalid Vehicle Model**\n\nPlease enter your vehicle model:\n• Example: `Honda Civic`\n• Example: `Toyota Camry`"
        );
      }
    }
    
    else if (fieldName === "vehicleColour") {
      if (!value || value.length < 2 || value.length > 30) {
        return bot.sendMessage(
          msg.chat.id,
          "❌ **Invalid Vehicle Color**\n\nPlease enter your vehicle color:\n• Example: `Blue`\n• Example: `Silver`"
        );
      }
    }
    
    else if (fieldName === "licensePlateNumber") {
      if (!value || value.length < 2 || value.length > 15) {
        return bot.sendMessage(
          msg.chat.id,
          "❌ **Invalid License Plate**\n\nPlease enter your license plate:\n• Example: `ABC123`\n• Example: `FL-ABC-123`"
        );
      }
    }
    

    
    // Update the field
    const updates = {};
    updates[fieldName] = value;
    
    const result = await performDriverCrud("updateDriver", {
      telegramId: tgId,
      updates: updates
    });
    
    if (result?.success) {
      state.clear(tgId);
      await bot.sendMessage(
        msg.chat.id,
        `✅ **${fieldDisplayName} Updated!**\n\nYour ${fieldDisplayName.toLowerCase()} has been updated to: ${value}`,
        { parse_mode: "Markdown", ...getDriverMainMenu() }
      );
    } else {
      await bot.sendMessage(msg.chat.id, `❌ Update failed: ${result?.error || "unknown error"}`);
    }
  } catch (err) {
    await sendError(msg.chat.id, err, "Field update failed.");
    state.clear(tgId);
  }
}

async function handleDriverIntent(bot, msg, intent, found) {
  switch (intent?.type) {
    case "driver_availability":
      // Set availability
      const { address, radiusMiles, hours } = intent.fields || {};
      if (!address || !radiusMiles) {
        return bot.sendMessage(
          msg.chat.id,
          "❌ I need your address and pickup distance. Try:\n\"I'm available at [address], pickup distance [X] miles, for [Y] hours\""
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
        currentLocation: { type: "Point", coordinates: [center.lon, center.lat], name: center.name },
        radiusMiles: radiusMiles,
        durationHours: hours
      });

      if (!availability?.success) {
        return bot.sendMessage(msg.chat.id, `❌ **Availability Update Failed**\n\n${availability?.error || "unknown error"}\n\nPlease try again.`, getAvailabilityButtons());
      }

      await bot.sendMessage(
        msg.chat.id,
        `🟢 **You're Now Available!**\n\n📍 ${center.name}\n📏 Pickup Distance: Up to ${radiusMiles} miles from your location\n⏰ ${hours || 'Until you go unavailable'} hours`,
        { parse_mode: "Markdown" }
      );

      return showDriverRideMenu(msg, availability.data);

    case "availability_off":
      const driverId = found.user._id.toString();
      const av = await performDriverCrud("getOpenAvailabilityByDriver", driverId);
      if (!av) {
        return bot.sendMessage(msg.chat.id, "🔴 **Already Unavailable**\n\nYou're not currently available for rides.", getAvailabilityButtons());
      }
      await performDriverCrud("closeDriverAvailability", driverId);
      return bot.sendMessage(
        msg.chat.id,
        "🔴 **Availability Closed**\n\nYou're no longer accepting new rides.",
        { parse_mode: "Markdown", ...getDriverMainMenu() }
      );

    case "complete_ride":
      // Find active ride for driver
      const activeRideToComplete = await Ride.findOne({
        driverId: found.user._id,
        status: { $in: ["matched", "in_progress"] }
      });
      
      if (!activeRideToComplete) {
        return bot.sendMessage(msg.chat.id, "❌ **No Active Rides**\n\nYou don't have any rides to complete at this time.", getQuickActionButtons());
      }
      
      // Complete the ride
      await Ride.findOneAndUpdate(
        { _id: activeRideToComplete._id },
        { 
          status: "completed",
          completedAt: new Date()
        }
      );
      
      // Notify rider
      const rider = await Rider.findOne({ _id: activeRideToComplete.riderId });
      if (rider?.telegramId && rider.telegramId !== "1") {
        const riderBotInstance = bot.token === process.env.TELEGRAM_BOT_TOKEN ? bot : getRiderBot();
        if (riderBotInstance) {
          await riderBotInstance.sendMessage(
            parseInt(rider.telegramId),
            `✅ **Ride Completed!**\n\n📍 From: ${activeRideToComplete.pickupLocationName}\n📍 To: ${activeRideToComplete.dropLocationName}\n🕐 Time: ${activeRideToComplete.timeOfRide ? new Date(activeRideToComplete.timeOfRide).toLocaleString() : 'ASAP'}\n👤 Driver: ${found.user.name}\n💰 Amount: $${activeRideToComplete.bid}\n\nThank you for using RideEase!`,
            { parse_mode: "Markdown" }
          );
        }
      }
      
      return bot.sendMessage(
        msg.chat.id,
        `✅ **Ride Completed!**\n\n📍 From: ${activeRideToComplete.pickupLocationName}\n📍 To: ${activeRideToComplete.dropLocationName}\n🕐 Time: ${activeRideToComplete.timeOfRide ? new Date(activeRideToComplete.timeOfRide).toLocaleString() : 'ASAP'}\n💰 Amount: $${activeRideToComplete.bid}\n\nGreat job! The rider has been notified.`,
        { parse_mode: "Markdown", ...getDriverMainMenu() }
      );

    case "cancel_ride":
      // Find active ride for driver
      const activeRideToCancel = await Ride.findOne({
        driverId: found.user._id,
        status: { $in: ["matched", "in_progress"] }
      });
      
      if (!activeRideToCancel) {
        return bot.sendMessage(msg.chat.id, "❌ **No Active Rides**\n\nYou don't have any rides to cancel at this time.", getQuickActionButtons());
      }
      
      // Show confirmation dialog
      return bot.sendMessage(
        msg.chat.id,
        `⚠️ **Cancel Ride?**\n\n📍 From: ${activeRideToCancel.pickup.address}\n📍 To: ${activeRideToCancel.destination.address}\n💰 Amount: $${activeRideToCancel.bidAmount}\n\n❓ Are you sure you want to cancel this ride?`,
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [[
              { text: "✅ Yes, Cancel Ride", callback_data: `cancel_ride_confirm_${activeRideToCancel._id}` },
              { text: "❌ No, Keep Ride", callback_data: `cancel_ride_keep_${activeRideToCancel._id}` }
            ]]
          }
        }
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
  if (!token) {
    console.error("❌ TELEGRAM_BOT_TOKEN_DRIVER not set in environment variables");
    throw new Error("TELEGRAM_BOT_TOKEN_DRIVER not set");
  }

  console.log("🤖 Initializing driver bot...");
  const usePolling = !process.env.FUNCTIONS_EMULATOR && process.env.NODE_ENV !== "production";
  console.log(`Bot polling: ${usePolling}`);
  
  try {
    driverBot = new TelegramBot(token, { polling: usePolling });
    console.log("✅ Driver bot instance created successfully");
  } catch (err) {
    console.error("❌ Failed to create driver bot instance:", err);
    throw err;
  }

  // Set bot instance for notifications
  try {
    require("./utils/notifications").setDriverBotInstance(driverBot);
    console.log("✅ Driver bot set for notifications");
  } catch (err) {
    console.error("⚠️ Failed to set driver bot for notifications:", err);
  }

  // Note: State timeout bot instances are set in index.js to avoid conflicts

  if (!driverWired) {
    console.log("🔧 Setting up driver bot handlers...");
    try {
      setupDriverCommands(driverBot);
      setupDriverCallbacks(driverBot);
      setupDriverMessageHandlers(driverBot);
      driverWired = true;
      console.log("✅ Driver bot handlers setup complete");
    } catch (err) {
      console.error("❌ Failed to setup driver bot handlers:", err);
      throw err;
    }
  }

  return driverBot;
}

// Export for webhook
module.exports = {
  processUpdate: async (update) => {
    const bot = initDriverBot();
    return bot.processUpdate(update);
  },
  initDriverBot,
  ensureMongoConnection
};
