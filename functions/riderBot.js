/*
  riderBot.js - Dedicated Rider Bot with Command-based Interface
  Commands:
  - /start - Welcome message and registration
  - /me - Show rider profile information
  - /erase - Delete rider details (requires confirmation)
  - /update - Update rider details
  - /riderequest - Request a new ride
  - /cancelride - Cancel active ride request
  - /rides - View active/past rides
  - /help - Show available commands
  - /time - Show current date and time with examples
  - /clearcache - Clear user's cache
  
  Natural language processing for non-command messages using OpenAI
*/

// Load environment variables first (includes TZ=America/New_York)
require("dotenv").config();

const TelegramBot = require("node-telegram-bot-api");
const mongoose = require("mongoose");
const { CloudTasksClient } = require('@google-cloud/tasks');
const Rider = require("./models/rider");
const Ride = require("./models/ride");
const Driver = require("./models/driver");

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
const { distanceMiles } = require("./utils/distance");
const db = require("./utils/database");
const matching = require("./utils/matching");
const notifications = require("./utils/notifications");
const { formatDateTime } = require("./utils/dateParser");
const { assertSingleOpen, sanitizeCrudPayload, checkRateLimit, logSecurityEvent } = require("./utils/guards");
const state = require("./utils/state");
const validation = require("./utils/validation");



// Initialize Cloud Tasks client with timeout configuration
const cloudTasksClient = new CloudTasksClient({
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


// Constants for repeated messages
const MESSAGES = {
  RESPONSE_TIME: "⏱️ *Response time: 3-45 seconds due to AI processing*",
  RIDER_REQUEST: "🚗 **Rider: Request a Ride**\n\n🚗 **As a RIDER,** tell me your ride details:\n\n• Example: \"Pickup: Miami Airport | Drop: Downtown Miami | Bid: $25 | Time: today 6:30 PM\"\n• Or just describe what you need naturally!",
  WELCOME_BACK: "🚗 **You are in the RIDER portal** - for booking rides\n\nPlease select an option from the menu below to continue.",
  REGISTRATION_PROMPT: "👋 **Welcome to RideEase - Rider Portal!**\n\n🚗 **You are in the RIDER app** - for booking rides\n\nPlease register as a rider to continue.",
  RIDER_WARNING: "⚠️ **RIDER WARNING**\n\nThis will permanently delete your rider profile and all associated data. This action cannot be undone.\n\nAre you sure you want to continue?",
  UPDATE_PROFILE: "✏️ **Update Rider Profile**\n\n🚗 **RIDER:** Send the updated information in this format:\n\n`Name, Phone, Home Address, Work Address`\n\nOr just tell me what you'd like to update (e.g., \"Update my phone to 555-0123\" or \"Set my home address to 123 Main St Miami\")\n\n*Your Telegram username will be automatically updated.*"
};

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
    console.log(`[${timestamp}] 🚕 RIDER DEBUG: ${message}`);
    if (data) console.log(`[${timestamp}] 🚕 RIDER DEBUG DATA:`, JSON.stringify(sanitizeForLogging(data), null, 2));
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
      const statusMessage = `🔄 Processing: ${message.replace(/🚕 RIDER DEBUG: /, '')}`;
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
      console.log(`[${timestamp}] 🚕 RIDER DEBUG: ${message}`);
      if (data) console.log(`[${timestamp}] 🚕 RIDER DEBUG DATA:`, JSON.stringify(sanitizeForLogging(data), null, 2));
    }
  } else if (DEBUG) {
    // Standard console logging when no bot/chatId provided
    console.log(`[${timestamp}] 🚕 RIDER DEBUG: ${message}`);
    if (data) console.log(`[${timestamp}] 🚕 RIDER DEBUG DATA:`, JSON.stringify(sanitizeForLogging(data), null, 2));
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

// Sanitize sensitive data for logging
function sanitizeForLogging(data) {
  if (!data || typeof data !== 'object') return data;
  
  const sanitized = JSON.parse(JSON.stringify(data));
  const sensitiveFields = ['phoneNumber', 'telegramId', 'address', 'homeAddress', 'workAddress'];
  
  function recursiveSanitize(obj) {
    if (typeof obj !== 'object' || obj === null) return;
    
    Object.keys(obj).forEach(key => {
      if (sensitiveFields.some(field => key.toLowerCase().includes(field.toLowerCase()))) {
        obj[key] = '[REDACTED]';
      } else if (typeof obj[key] === 'object') {
        recursiveSanitize(obj[key]);
      }
    });
  }
  
  recursiveSanitize(sanitized);
  return sanitized;
}

// Helper function to get active rides


// Helper function to format messages with response time
function formatMessage(message) {
  return `${message}\n\n${MESSAGES.RESPONSE_TIME}`;
}



// Helper function for typing indicators
async function showTyping(bot, chatId, duration = 5000) {
  const typingFuncStartTime = Date.now();
  try {
    const actionStartTime = Date.now();
    await bot.sendChatAction(chatId, 'typing');
    console.log("💬 PERF: sendChatAction took:", Date.now() - actionStartTime, "ms");
    
    // Auto-refresh typing indicator every 5 seconds if processing takes longer
    const interval = setInterval(async () => {
      try {
        await bot.sendChatAction(chatId, 'typing');
      } catch (err) {
        clearInterval(interval);
      }
    }, duration);
    
    console.log("💬 PERF: showTyping setup took:", Date.now() - typingFuncStartTime, "ms");
    // Return cleanup function
    return () => clearInterval(interval);
  } catch (err) {
    console.error("Error showing typing indicator:", err);
    return () => {}; // Return no-op cleanup
  }
}

// Helper function to replace address shortcuts (home/work) with actual addresses
function replaceAddressShortcuts(address, userHomeAddress, userWorkAddress) {
  if (!address || typeof address !== 'string') {
    return { address, error: null };
  }

  const normalizedAddress = address.toLowerCase().trim();
  
  // Check for "home" variations
  if (normalizedAddress === 'home' || normalizedAddress.includes('from home') || normalizedAddress.includes('to home')) {
    if (!userHomeAddress || !userHomeAddress.trim()) {
      return { 
        address: null, 
        error: "🏠 Home address not set up yet. Use /update to add your home address first." 
      };
    }
    
    // Replace home with actual address
    let replacedAddress = address.replace(/\bhome\b/gi, userHomeAddress);
    
    // Clean up common patterns like "from home" -> just the address
    if (replacedAddress.toLowerCase().startsWith('from ')) {
      replacedAddress = replacedAddress.substring(5).trim();
    }
    if (replacedAddress.toLowerCase().startsWith('to ')) {
      replacedAddress = replacedAddress.substring(3).trim();
    }
    
    return { address: replacedAddress, error: null };
  }
  
  // Check for "work" variations
  if (normalizedAddress === 'work' || normalizedAddress.includes('from work') || normalizedAddress.includes('to work')) {
    if (!userWorkAddress || !userWorkAddress.trim()) {
      return { 
        address: null, 
        error: "🏢 Work address not set up yet. Use /update to add your work address first." 
      };
    }
    
    // Replace work with actual address
    let replacedAddress = address.replace(/\bwork\b/gi, userWorkAddress);
    
    // Clean up common patterns like "from work" -> just the address
    if (replacedAddress.toLowerCase().startsWith('from ')) {
      replacedAddress = replacedAddress.substring(5).trim();
    }
    if (replacedAddress.toLowerCase().startsWith('to ')) {
      replacedAddress = replacedAddress.substring(3).trim();
    }
    
    return { address: replacedAddress, error: null };
  }
  
  // No shortcuts found, return original address
  return { address, error: null };
}

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
  debug("performRiderCrud called", { action, payload });
  
  const fn = RIDER_CRUD[action];
  if (!fn) {
    throw new Error(`Rider CRUD not permitted: ${action}`);
  }
  
  // Special handling for updateRider to pass payload directly
  if (action === "updateRider") {
    try {
      const result = await fn(payload);
      debug("CRUD result", { action, success: !!result });
      return result;
    } catch (error) {
      console.error("CRUD error for", action, ":", error.message);
      throw error;
    }
  }
  
  const safePayload = sanitizeCrudPayload(action, payload);
  debug("Sanitized payload", { action, safePayload });
  
  try {
    const result = await fn(safePayload);
    debug("CRUD result", { action, success: !!result });
    return result;
  } catch (error) {
    console.error("CRUD error for", action, ":", error.message);
    throw error;
  }
}

async function sendError(chatId, err, hint) {
  console.error("Error occurred:", err.message);
  debug("sendError details", { chatId, hint, errorType: err.name });
  
  // Provide more specific error message based on error type
  let userMessage = hint || "An error occurred.";
  
  if (err.message && err.message.includes('validation')) {
    userMessage = formatMessage("❌ **Rider Registration Error**\n\n🚗 **RIDER:** Registration validation failed. Please check your input format.");
  } else if (err.message && err.message.includes('phone')) {
    userMessage = formatMessage("❌ **Rider Phone Error**\n\n🚗 **RIDER:** Phone number format is invalid. Please use a valid phone number (7-15 digits).");
  } else if (err.message && err.message.includes('username')) {
    userMessage = "❌ Telegram username is invalid. Use format: @username (5-32 characters, letters, numbers, underscores only).";
  } else if (err.message && err.message.includes('address')) {
    userMessage = "❌ Address format is invalid. Please provide a complete address with street, city, and state.";
  } else if (err.message && err.message.includes('name')) {
    userMessage = "❌ Name is invalid. Use only letters, spaces, hyphens, and apostrophes (2-50 characters).";
  } else if (err.name === 'TypeError' && err.message.includes('isValid')) {
    userMessage = "❌ Registration format error. Please use: Name, Phone, Home Address, Work Address (username auto-detected)";
  }
  
  try {
    await riderBot.sendMessage(chatId, `⚠️ ${userMessage}`, getErrorButtons());
  } catch (sendErr) {
    console.error("Failed to send error message:", sendErr.message);
  }
}

// Registration keyboard
const regKb = {
  reply_markup: {
    inline_keyboard: [
      [{ text: "Register as Rider", callback_data: "register_rider" }],
    ],
  },
};

// Main menu keyboard for riders - context-aware based on rider state
function getRiderMainMenu(hasActiveRide = false, isRideMatched = false) {
  // If rider has a matched ride (driver assigned), show ride management options
  if (hasActiveRide && isRideMatched) {
    return {
      reply_markup: {
        inline_keyboard: [
          [{ text: "✅ Mark Completed", callback_data: "mark_completed" }],
          [{ text: "❌ Cancel Ride", callback_data: "cancel_ride" }],
          [
            { text: "👤 My Profile", callback_data: "view_profile" },
            { text: "📋 My Rides", callback_data: "view_rides" }
          ],
          [
            { text: "📋 Ride Details", callback_data: "view_ride_details" },
            { text: "✏️ Update Details", callback_data: "update_details" }
          ],
          [
            { text: "❓ Help", callback_data: "show_help" }
          ]
        ],
      },
    };
  }

  // If rider has an active ride (but not matched yet), show waiting/cancel options
  if (hasActiveRide) {
    return {
      reply_markup: {
        inline_keyboard: [
          [{ text: "❌ Cancel Ride", callback_data: "cancel_ride" }],
          [
            { text: "👤 My Profile", callback_data: "view_profile" },
            { text: "� My Rides", callback_data: "view_rides" }
          ],
          [
            { text: "🔄 Update Ride", callback_data: "update_current_ride" },
            { text: "✏️ Update Details", callback_data: "update_details" }
          ],
          [
            { text: "❓ Help", callback_data: "show_help" }
          ]
        ],
      },
    };
  }

  // Normal menu when no active ride
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: "🚗 Request Ride", callback_data: "request_ride" }],
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

// Helper function to get context-aware main menu for a rider
async function getContextAwareMainMenu(userId) {
  try {
    const rideResult = await db.getRidesByUser(userId, "rider");
    const activeRides = rideResult?.success ? rideResult.data?.filter(ride => 
      ride.status === "open" || ride.status === "matched" || ride.status === "in_progress"
    ) : [];
    
    const hasActiveRide = activeRides && activeRides.length > 0;
    const activeRide = activeRides?.[0] || null;
    
    // Check if the ride is matched (has a driver assigned)
    const isRideMatched = activeRide && (
      activeRide.status === "matched" || 
      activeRide.status === "in_progress"
    );
    
    return getRiderMainMenu(hasActiveRide, isRideMatched);
  } catch (error) {
    console.error("Error getting context-aware rider main menu:", error);
    return getRiderMainMenu(false, false); // Default to no active ride on error
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
          { text: "📝 Register Now", callback_data: "register_rider" }
        ],
        [
          { text: "❓ Help", callback_data: "show_help" }
        ]
      ],
    },
  };
}

// Ride management buttons
function getRideManagementButtons() {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "🚗 Request New Ride", callback_data: "request_ride" },
          { text: "📋 View My Rides", callback_data: "view_rides" }
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

// Helper functions
async function isRiderRegistered(ctx) {
  const checkStartTime = Date.now();
  const tgId = ctx.from.id.toString();
  console.log(`🔍 DEBUG: isRiderRegistered - Checking if rider ${tgId} is registered`);
  
  const dbLookupStartTime = Date.now();
  const found = await performRiderCrud("findRiderByTelegramId", tgId);
  console.log("🔍 PERF: DB lookup took:", Date.now() - dbLookupStartTime, "ms");
  console.log(`🔍 DEBUG: isRiderRegistered - findRiderByTelegramId result:`, JSON.stringify(found, null, 2));
  
  console.log("🔍 PERF: isRiderRegistered total took:", Date.now() - checkStartTime, "ms");
  
  // Return the user data if registered, null if not
  const isRegistered = (found && found.type === "rider") ? found : null;
  console.log(`🔍 DEBUG: isRiderRegistered - Final result:`, isRegistered ? "REGISTERED" : "NOT REGISTERED");
  return isRegistered;
}

async function showRegistrationPrompt(ctx) {
  console.log(`🔍 DEBUG: Showing registration prompt for user ${ctx.from.id}`);
  const bot = initRiderBot(); // Get the bot instance
  await bot.sendMessage(ctx.chat.id, "👋 **Welcome to RideEase - Rider Portal!**\n\n🚗 **You are in the RIDER app** - for booking rides\n\nPlease register as a rider to continue.\n\n⏱️ *Response time: 3-45 seconds due to AI processing*", regKb);
}

async function requireRiderRegistration(ctx) {
  // Check if user is registered
  const registeredUser = await isRiderRegistered(ctx);
  
  if (!registeredUser) {
    // User is NOT registered - show registration prompt and return null
    await showRegistrationPrompt(ctx);
    return null;
  }
  
  // User IS registered - return their data
  return registeredUser;
}

function summarizeRide(ride) {
  const when = formatDateTime(new Date(ride.rideTime || ride.timeOfRide));
  const bid = ride.bid != null ? `\n💰 Bid: $${ride.bid}` : "";
  return `📍 **Pickup:** ${ride.pickup?.name || ride.pickupLocationName}\n📍 **Drop:** ${ride.dropoff?.name || ride.dropLocationName}\n🕐 **Time:** ${when}${bid}`;
}

// Command handlers
function setupRiderCommands(bot) {
  // Remove any existing command listeners to prevent duplicates
  bot.removeAllListeners('text');

  // /clearcache command - Clear user's cache
  bot.onText(/^\/clearcache$/, async (msg) => {
    try {
      const startTime = Date.now();
      console.log("🧹 PERF: Starting clearcache command");
      
      const registeredUser = await requireRiderRegistration(msg);
      if (!registeredUser) return; // User not registered, registration prompt already shown

      console.log("🧹 PERF: Registration check took:", Date.now() - startTime, "ms");
      const dbStartTime = Date.now();
      
      const result = await performRiderCrud("clearUserCache", msg.from.id.toString());
      console.log("🧹 PERF: Database operation took:", Date.now() - dbStartTime, "ms");
      console.log("🧹 DEBUG: Cache clear result:", result);
      
      if (result.success) {
        console.log("🧹 DEBUG: Sending success message...");
        try {
          const sendResult = await bot.sendMessage(
            msg.chat.id,
            "🧹 **Cache Cleared**\n\nYour session cache has been cleared. This should resolve any stuck states or outdated information.",
            { parse_mode: "Markdown", ...getRiderMainMenu() }
          );
          console.log("🧹 DEBUG: Success message sent!", sendResult?.message_id);
        } catch (sendErr) {
          console.error("🧹 ERROR: Failed to send success message:", sendErr?.message || sendErr);
          throw sendErr;
        }
      } else {
        console.log("🧹 DEBUG: Sending failure message...");
        try {
          await bot.sendMessage(msg.chat.id, "❌ Failed to clear cache. Please try again.", getErrorButtons());
          console.log("🧹 DEBUG: Failure message sent!");
        } catch (sendErr) {
          console.error("🧹 ERROR: Failed to send failure message:", sendErr?.message || sendErr);
          throw sendErr;
        }
      }
    } catch (err) {
      await sendError(msg.chat.id, err, "Cache clearing failed.");
    }
  });
  // /start command
  bot.onText(/^\/start$/, async (msg) => {
    await debug("Processing /start command", { userId: msg.from.id }, bot, msg.chat.id);
    
    try {
      // Check if user is registered
      await debug("Checking registration status", null, bot, msg.chat.id);
      const registeredUser = await isRiderRegistered(msg);
      
      if (registeredUser) {
        // User IS registered - show welcome message with main menu
        await debug("Loading main menu", null, bot, msg.chat.id);
        const menu = await getContextAwareMainMenu(registeredUser.user._id.toString());
        await sendFinalMessage(
          bot,
          msg.chat.id,
          `🚗 **Welcome Back, ${registeredUser.user.name || 'Rider'}!**\n\n🚗 **You are in the RIDER portal** - for booking rides\n\nPlease select an option from the menu below to continue.\n\n⏱️ *Response time: 3-45 seconds due to AI processing*`,
          { parse_mode: "Markdown", ...menu }
        );
      } else {
        // User is NOT registered - show registration prompt
        await debug("Setting up registration", null, bot, msg.chat.id);
        await showRegistrationPrompt(msg);
      }
    } catch (err) {
      await sendError(msg.chat.id, err, "Start command failed.");
    }
  });

  // /me command - Show profile
  bot.onText(/^\/me$/, async (msg) => {
    await debug("Processing /me command", { userId: msg.from.id }, bot, msg.chat.id);
    
    try {
      const tgId = msg.from.id.toString();
      await debug("Loading your profile data", null, bot, msg.chat.id);
      
      const user = await performRiderCrud("findRiderByTelegramId", tgId);
      
      if (!user?.user || user.type !== "rider") {
        return sendFinalMessage(bot, msg.chat.id, "❌ **Rider Profile Not Found**\n\n🚗 **RIDER:** You need to register first to access your profile.\n\n⏱️ *Response time: 3-45 seconds due to AI processing*", getRegistrationButtons());
      }
      
      await debug("Building profile display", null, bot, msg.chat.id);

      let profileText = `👤 **Rider Profile**\n\n`;
      profileText += `📝 **Name:** ${user.user.name || "Not set"}\n`;
      profileText += `📞 **Phone:** ${user.user.phoneNumber || "Not set"}\n`;
      profileText += `⭐ **Rating:** ${user.user.rating || 0}/5\n`;
      
      // Count completed rides dynamically
      const totalRides = await db.countCompletedRides(user.user._id, 'rider');
      profileText += `📊 **Total Rides:** ${totalRides}\n`;
      
      if (user.user.homeAddress) {
        profileText += `🏠 **Home:** ${user.user.homeAddress}\n`;
      }
      if (user.user.workAddress) {
        profileText += `🏢 **Work:** ${user.user.workAddress}\n`;
      }
      
      // Check for active ride request - optimized query
      const rideCheckStartTime = Date.now();
      // Check for both "open" and "matched" rides as both are active from rider's perspective
      const rideResult = await db.getRidesByUser(user.user._id.toString(), "rider");
      const activeRides = rideResult?.success ? rideResult.data?.filter(ride => 
        ride.status === "open" || ride.status === "matched"
      ) : [];
      const activeRide = activeRides?.[0] || null;
      console.log("👤 PERF: Active ride check took:", Date.now() - rideCheckStartTime, "ms");
      
      if (activeRide) {
        const statusText = activeRide.status === "matched" ? 
          "� **Current Status:** Ride matched! Driver assigned" : 
          "🟡 **Current Status:** Looking for driver";
        profileText += `\n${statusText}\n`;
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

      const menu = await getContextAwareMainMenu(user.user._id.toString());
      await sendFinalMessage(bot, msg.chat.id, profileText, { 
        parse_mode: "Markdown",
        ...menu
      });
    } catch (err) {
      console.log("👤 PERF: /me command failed after:", Date.now() - startTime, "ms");
      await sendError(msg.chat.id, err, "Couldn't fetch your profile.");
    }
  });

  // /erase command - Delete rider profile
  bot.onText(/^\/erase$/, async (msg) => {
    await debug("Processing /erase command", { userId: msg.from.id }, bot, msg.chat.id);
    
    try {
      await debug("Verifying registration status", null, bot, msg.chat.id);
      const registeredUser = await requireRiderRegistration(msg);
      if (!registeredUser) {
        await clearTempMessage(bot, msg.chat.id);
        return; // User not registered, registration prompt already shown
      }

      await debug("Preparing deletion confirmation", null, bot, msg.chat.id);
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

      await sendFinalMessage(
        bot,
        msg.chat.id,
        "⚠️ **RIDER WARNING**\n\nThis will permanently delete your rider profile and all associated data. This action cannot be undone.\n\nAre you sure you want to continue?\n\n⏱️ *Response time: 3-45 seconds due to AI processing*",
        { parse_mode: "Markdown", ...confirmKb }
      );
    } catch (err) {
      await sendError(msg.chat.id, err, "Delete command failed.");
    }
  });

  // /update command - Update rider details
  bot.onText(/^\/update$/, async (msg) => {
    await debug("Processing /update command", { userId: msg.from.id }, bot, msg.chat.id);
    
    try {
      await debug("Checking registration status", null, bot, msg.chat.id);
      const registeredUser = await requireRiderRegistration(msg);
      if (!registeredUser) {
        await clearTempMessage(bot, msg.chat.id);
        return; // User not registered, registration prompt already shown
      }

      await debug("Loading update options", null, bot, msg.chat.id);
      const updateButtons = {
        reply_markup: {
          inline_keyboard: [
            [
              { text: "📱 Phone Number", callback_data: "update_phone" },
              { text: "👤 Name", callback_data: "update_name" }
            ],
            [
              { text: "🏠 Home Address", callback_data: "update_home_address" },
              { text: "🏢 Work Address", callback_data: "update_work_address" }
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

      await sendFinalMessage(
        bot,
        msg.chat.id,
        "✏️ **Update Rider Profile**\n\nPlease select which field you want to update:",
        { parse_mode: "Markdown", ...updateButtons }
      );
    } catch (err) {
      await sendError(msg.chat.id, err, "Update command failed.");
    }
  });

  // /riderequest command - Request a ride
  bot.onText(/^\/riderequest$/, async (msg) => {
    await debug("Processing /riderequest command", { userId: msg.from.id }, bot, msg.chat.id);
    
    try {
      const tgId = msg.from.id.toString();
      
      // Prevent duplicate processing - check if we just set request_ride state recently
      const currentState = state.get(tgId);
      const now = Date.now();
      if (currentState?.phase === "request_ride" && currentState?.timestamp && (now - currentState.timestamp) < 5000) {
        await clearTempMessage(bot, msg.chat.id);
        return;
      }

      await debug("Verifying registration status", null, bot, msg.chat.id);
      const registeredUser = await requireRiderRegistration(msg);
      if (!registeredUser) {
        await clearTempMessage(bot, msg.chat.id);
        return; // User not registered, registration prompt already shown
      }

      // Check for existing active ride (both open and matched)
      await debug("Checking for existing active rides", null, bot, msg.chat.id);
      const rideResult = await db.getRidesByUser(registeredUser.user._id.toString(), "rider");
      const activeRides = rideResult?.success ? rideResult.data?.filter(ride => 
        ride.status === "open" || ride.status === "matched"
      ) : [];
      const activeRide = activeRides?.[0] || null;
      
      if (activeRide) {
        return sendFinalMessage(
          bot,
          msg.chat.id,
          `🟡 **You already have an active ride request!**\n\n${summarizeRide(activeRide)}\n\nUse /cancelride to cancel it first.`,
          { parse_mode: "Markdown", ...getRideManagementButtons() }
        );
      }

      await debug("Setting up ride request mode", null, bot, msg.chat.id);
      state.set(tgId, { phase: "request_ride", timestamp: now });
      await sendFinalMessage(
        bot,
        msg.chat.id,
        "🚗 **Rider: Request a Ride**\n\n🚗 **As a RIDER,** tell me your ride details:\n\n• Example: \"Pickup: Miami Airport | Drop: Downtown Miami | Bid: $25 | Time: today 6:30 PM\"\n• Or just describe what you need naturally!\n\n⏱️ *Response time: 3-45 seconds due to AI processing*",
        { parse_mode: "Markdown", ...getQuickActionButtons() }
      );
    } catch (err) {
      await sendError(msg.chat.id, err, "Ride request command failed.");
    }
  });

  // /cancelride command - Cancel active ride
  bot.onText(/^\/cancelride$/, async (msg) => {
    await debug("Processing /cancelride command", { userId: msg.from.id }, bot, msg.chat.id);
    
    try {
      await debug("Verifying registration status", null, bot, msg.chat.id);
      const registeredUser = await requireRiderRegistration(msg);
      if (!registeredUser) {
        await clearTempMessage(bot, msg.chat.id);
        return; // User not registered, registration prompt already shown
      }

      // Check for active ride that can be cancelled (both open and matched)
      await debug("Looking for active rides to cancel", null, bot, msg.chat.id);
      const rideResult = await db.getRidesByUser(registeredUser.user._id.toString(), "rider");
      const activeRides = rideResult?.success ? rideResult.data?.filter(ride => 
        ride.status === "open" || ride.status === "matched"
      ) : [];
      const activeRide = activeRides?.[0] || null;
      
      if (!activeRide) {
        return sendFinalMessage(
          bot,
          msg.chat.id,
          "🔴 **No Active Ride Request**\n\nYou don't have any active ride requests to cancel.\n\nUse /riderequest to book a new ride!",
          { parse_mode: "Markdown", ...getRiderMainMenu() }
        );
      }

      await debug("Preparing cancellation confirmation", null, bot, msg.chat.id);
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

      await sendFinalMessage(
        bot,
        msg.chat.id,
        `❓ **Cancel This Ride?**\n\n${summarizeRide(activeRide)}\n\nAre you sure you want to cancel?`,
        { parse_mode: "Markdown", ...confirmKb }
      );
    } catch (err) {
      await sendError(msg.chat.id, err, "Cancel ride command failed.");
    }
  });

  // /completed command - Mark current ride as completed
  bot.onText(/^\/completed$/, async (msg) => {
    try {
      const registeredUser = await requireRiderRegistration(msg);
      if (!registeredUser) return; // User not registered, registration prompt already shown

      // Find the rider's current matched or in-progress ride
      const riderId = registeredUser.user._id;
      
      const mongoose = require('mongoose');
      const riderObjectId = mongoose.Types.ObjectId.isValid(riderId) ? 
        new mongoose.Types.ObjectId(riderId) : riderId;
      
      // Find matched or in-progress ride for this rider
      const matchedRide = await Ride.findOne({
        riderId: riderObjectId,
        status: { $in: ["matched", "in_progress"] }
      });

      if (!matchedRide) {
        return bot.sendMessage(
          msg.chat.id,
          "❌ **No Active Ride**\n\nYou don't have any active rides to complete.\n\nUse /riderequest to book a new ride!",
          { parse_mode: "Markdown", ...getRiderMainMenu() }
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

      if (!updateResult) {
        return bot.sendMessage(
          msg.chat.id,
          "❌ **Failed to Complete Ride**\n\nCould not update ride status. Please try again.",
          { parse_mode: "Markdown", ...getRiderMainMenu(false) }
        );
      }

      await bot.sendMessage(
        msg.chat.id,
        `✅ **Ride Completed!**\n\n📍 From: ${matchedRide.pickupLocationName}\n📍 To: ${matchedRide.dropLocationName}\n� Time: ${matchedRide.timeOfRide ? new Date(matchedRide.timeOfRide).toLocaleString() : 'ASAP'}\n�💰 Amount: $${matchedRide.bid}\n\nThank you for using RideEase! 🚗\n\nHow was your ride? Feel free to book another one anytime!`,
        { parse_mode: "Markdown", ...getRiderMainMenu(false) }
      );

      // Notify the driver
      try {
        const driver = await Driver.findOne({ _id: matchedRide.driverId });
        if (driver && driver.telegramId && driver.telegramId !== "1") {
          await notifications.notifyDriver(
            driver,
            `✅ **Ride Completed!**\n\n📍 From: ${matchedRide.pickupLocationName}\n📍 To: ${matchedRide.dropLocationName}\n� Time: ${matchedRide.timeOfRide ? new Date(matchedRide.timeOfRide).toLocaleString() : 'ASAP'}\n�👤 Rider: ${registeredUser.user.name}\n💰 Amount: $${matchedRide.bid}\n\nThank you for using RideEase!`,
            { parse_mode: "Markdown" }
          );
        }
      } catch (err) {
        console.error("Failed to notify driver of ride completion:", err);
      }
    } catch (err) {
      await sendError(msg.chat.id, err, "Complete ride command failed.");
    }
  });

  // /rides command - View rides
  bot.onText(/^\/rides$/, async (msg) => {
    await debug("Processing /rides command", { userId: msg.from.id }, bot, msg.chat.id);
    
    try {
      await debug("Verifying registration status", null, bot, msg.chat.id);
      const registeredUser = await requireRiderRegistration(msg);
      if (!registeredUser) {
        await clearTempMessage(bot, msg.chat.id);
        return; // User not registered, registration prompt already shown
      }

      // Call the database function properly - it expects multiple parameters
      await debug("Loading your ride history", null, bot, msg.chat.id);
      const result = await db.getRidesByUser(registeredUser.user._id, "rider");
      
      // Handle the response structure { success: true, data: rides }
      if (!result?.success || !result?.data || result.data.length === 0) {
        return sendFinalMessage(
          bot,
          msg.chat.id,
          "🚗 **No Rides Yet**\n\nYou haven't booked any rides yet. Use /riderequest to book your first ride!",
          { parse_mode: "Markdown", ...getRiderMainMenu() }
        );
      }

      const rides = result.data; // Extract the actual rides array
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

      await debug("Preparing ride list display", null, bot, msg.chat.id);
      // Add action buttons for open rides
      const openRides = rides.filter(r => r.status === 'open').slice(0, 3);
      const keyboard = openRides.length > 0 ? {
        inline_keyboard: openRides.map((ride, index) => [
          { text: `📝 Update Ride ${index + 1}`, callback_data: `update_ride_${ride._id}` },
          { text: `❌ Cancel Ride ${index + 1}`, callback_data: `confirm_cancel_${ride._id}` }
        ])
      } : getRiderMainMenu().reply_markup;

      await sendFinalMessage(bot, msg.chat.id, ridesList, { 
        parse_mode: "Markdown",
        reply_markup: keyboard
      });
    } catch (err) {
      await sendError(msg.chat.id, err, "Rides command failed.");
    }
  });

  // /help command - Show help
  bot.onText(/^\/help$/, async (msg) => {
    await debug("Processing /help command", { userId: msg.from.id }, bot, msg.chat.id);
    
    try {
      await debug("Loading help information", null, bot, msg.chat.id);
      const helpText = `🚗 **RideEase Rider Bot - Complete Command Guide**\n\n` +
        
        `**🚀 GETTING STARTED**\n` +
        `• \`/start\` - Main menu and registration\n` +
        `  └ *Use case:* First-time setup or return to main menu\n` +
        `  └ *Example:* Just send /start to see all available options\n` +
        `  └ *What happens:* Shows welcome message + main menu buttons if registered, or registration prompt if new\n\n` +
        
        `**👤 PROFILE MANAGEMENT**\n` +
        `• \`/me\` - View your complete rider profile\n` +
        `  └ *Use case:* Check your details, rating, total rides, and current ride status\n` +
        `  └ *Example:* Send /me to see your name, phone, addresses, active rides\n` +
        `  └ *Shows:* Name, phone, rating (x/5), total rides, home/work addresses, active ride status\n\n` +
        
        `• \`/update\` - Update your profile information\n` +
        `  └ *Use case:* Change phone number, name, addresses after registration\n` +
        `  └ *Format 1:* \`Name | Phone | Username | Home | Work\`\n` +
        `  └ *Format 2:* Natural language like "Update my phone to 555-0123"\n` +
        `  └ *Example:* "Set my home address to 123 Main St Miami FL"\n\n` +
        
        `• \`/erase\` - Permanently delete your profile\n` +
        `  └ *Use case:* Complete account removal (irreversible!)\n` +
        `  └ *Safety:* Requires confirmation via Yes/Cancel buttons\n` +
        `  └ *Warning:* Deletes ALL your data including ride history\n\n` +
        
        `**🚗 RIDE MANAGEMENT**\n` +
        `• \`/riderequest\` - Request a new ride\n` +
        `  └ *Use case:* Book rides when you need transportation\n` +
        `  └ *Smart format:* "Pickup: Miami Airport | Drop: Downtown Miami | Time: today 6pm | Bid: $25"\n` +
        `  └ *Natural format:* "I need a ride from the airport to downtown at 6pm today for $25"\n` +
        `  └ *Time examples:* "right now", "today 7pm", "tomorrow 9am", "in 2 hours"\n` +
        `  └ *Prevents:* Multiple active ride requests (shows current one if exists)\n\n` +
        
        `• \`/cancelride\` - Cancel your active ride request\n` +
        `  └ *Use case:* Cancel pending or matched rides before they start\n` +
        `  └ *Safety:* Shows ride details + confirmation buttons (Yes/Keep)\n` +
        `  └ *Works for:* Both "open" (looking for driver) and "matched" (driver assigned) rides\n\n` +
        
        `• \`/completed\` - Mark your current ride as completed\n` +
        `  └ *Use case:* Complete matched or in-progress rides\n` +
        `  └ *Action:* Updates ride status to "completed" and notifies driver\n` +
        `  └ *Works for:* "matched" or "in_progress" rides only\n\n` +
        
        `• \`/rides\` - View your ride history and active requests\n` +
        `  └ *Use case:* Track all your rides (past and current)\n` +
        `  └ *Shows:* Status (✅ Completed, 🔄 Matched, 🟡 Open, ❌ Cancelled)\n` +
        `  └ *Details:* Pickup → Drop locations, time, bid amount, status\n` +
        `  └ *Actions:* Quick buttons to update or cancel open rides\n` +
        `  └ *Limit:* Shows last 10 rides (+ count if more exist)\n\n` +
        
        `**🛠️ UTILITY COMMANDS**\n` +
        `• \`/time\` - Show current date/time with format examples\n` +
        `  └ *Use case:* Check current time before booking rides\n` +
        `  └ *Shows:* Full date, current time, timezone info\n` +
        `  └ *Examples:* Time format examples for ride booking\n\n` +
        
        `• \`/clearcache\` - Clear your session cache\n` +
        `  └ *Use case:* Fix stuck states, resolve bot issues\n` +
        `  └ *When to use:* Bot not responding properly, stuck in registration/update mode\n` +
        `  └ *Safe:* Doesn't delete your profile, just clears temporary session data\n\n` +
        
        `**🤖 NATURAL LANGUAGE FEATURES**\n` +
        `• \`/natural\` - Toggle AI chat mode on/off (saves tokens when off)\n` +
        `  └ *Default:* Natural language OFF (commands/buttons only)\n` +
        `  └ *When ON:* I understand natural chat like:\n` +
        `    • "Book me a ride from home to work tomorrow at 8am for $15"\n` +
        `    • "Cancel my current ride request"\n` +
        `    • "Update my phone number to 555-1234"\n` +
        `    • "Show me my ride history"\n` +
        `    • "I need to get to Miami Beach from downtown right now"\n` +
        `  └ *When OFF:* Use commands and buttons only\n\n` +
        
        `**🏠🏢 ADDRESS SHORTCUTS**\n` +
        `Set up your addresses in /update to use shortcuts:\n` +
        `• "Take me from home to work at 8am, bid $25"\n` +
        `• "I need a ride from work to home at 6pm today, $30"\n` +
        `• "Pickup: home | Drop: Miami Airport | Time: tomorrow 9am | Bid: $40"\n` +
        `• If not set up: Bot will prompt you to add addresses first\n\n` +
        
        `**📱 MAIN MENU BUTTONS**\n` +
        `Use the buttons that appear after commands:\n` +
        `• 🚗 Request Ride - Same as /riderequest\n` +
        `• ❌ Cancel Ride - Same as /cancelride  \n` +
        `• 👤 My Profile - Same as /me\n` +
        `• 📋 My Rides - Same as /rides\n` +
        `• ✏️ Update Details - Same as /update\n` +
        `• ❓ Help - Same as /help\n\n` +
        
        `**⚡ REGISTRATION (New Users)**\n` +
        `First time? Click "Register as Rider" then send:\n` +
        `\`Jane Doe | 555-0123 | 123 Main St Miami FL | Downtown Miami\`\n` +
        `• Name and Phone are required\n` +
        `• Username is automatically detected from your Telegram account\n` +
        `• Home and Work addresses are optional (leave empty: \`| | \`)\n\n` +
        
        `**🚨 TROUBLESHOOTING**\n` +
        `• Bot stuck? Try /clearcache\n` +
        `• Can't register? Check your format: \`Name | Phone | address | work\` (username auto-detected)\n` +
        `• Ride time errors? Use formats like "today 6pm" or "tomorrow 9am"\n` +
        `• Multiple rides? Cancel current ride first with /cancelride\n\n` +
        
        `**💡 PRO TIPS**\n` +
        `• Set home/work addresses to use shortcuts like "from home to work"\n` +
        `• Higher bids may get faster driver matches\n` +
        `• Use /time to see current time before setting ride times\n` +
        `• Both commands and natural language work - use what's comfortable!\n\n` +
        
        `*Need more help? Just ask me anything naturally - I'll understand! 🤖*`;

      // Get context-aware menu for registered users
      const tgId = msg.from.id.toString();
      const user = await performRiderCrud("findRiderByTelegramId", tgId);
      const menu = user?.user ? await getContextAwareMainMenu(user.user._id.toString()) : getRiderMainMenu();
      
      await sendFinalMessage(bot, msg.chat.id, helpText, { 
        parse_mode: "Markdown",
        ...menu
      });
    } catch (err) {
      await sendError(msg.chat.id, err, "Help command failed.");
    }
  });

  // /time command - Show current date and time
  bot.onText(/^\/time$/, async (msg) => {
    await debug("Processing /time command", { userId: msg.from.id }, bot, msg.chat.id);
    
    try {
      await debug("Getting current date and time", null, bot, msg.chat.id);
      const now = new Date();
      
      // Format the date and time safely
      const todayDate = now.toLocaleDateString('en-US', { 
        weekday: 'long', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric'
      });
      const currentTime = now.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
      });

      // Build the time message
      const timeText = `🕐 **Current Date & Time**\n\n` +
        `📅 **Today:** ${todayDate}\n` +
        `⏰ **Time:** ${currentTime}\n\n` +
        `**Time Examples for Rides:**\n` +
        `• "right now" = current time\n` +
        `• "today 6pm" = today at 6:00 PM\n` +
        `• "tomorrow 9am" = tomorrow at 9:00 AM\n` +
        `• "in 2 hours" = 2 hours from now\n` +
        `• "18:30" = today at 6:30 PM\n\n` +
        `**Timezone:** Eastern Time (America/New_York)`;

      // Try to check registration status, but don't fail if it errors
      await debug("Checking registration for menu options", null, bot, msg.chat.id);
      let menuOptions = regKb; // Default to registration keyboard
      try {
        const registeredUser = await isRiderRegistered(msg);
        if (registeredUser) {
          menuOptions = await getContextAwareMainMenu(registeredUser.user._id.toString());
        }
      } catch (regErr) {
        console.log("Registration check failed in /time command, using default menu:", regErr.message);
      }

      await sendFinalMessage(bot, msg.chat.id, timeText, { 
        parse_mode: "Markdown",
        ...menuOptions
      });
    } catch (err) {
      console.error("Time command error:", err);
      
      // Fallback: send a simple time message without formatting
      try {
        const simpleTime = new Date().toString();
        await bot.sendMessage(msg.chat.id, `🕐 Current time: ${simpleTime}`, getQuickActionButtons());
      } catch (fallbackErr) {
        console.error("Even fallback time message failed:", fallbackErr);
        await sendError(msg.chat.id, err, "Time command failed.");
      }
    }
  });

  // /natural command - Toggle natural language mode
  bot.onText(/^\/natural$/, async (msg) => {
    await debug("Processing /natural command", { userId: msg.from.id }, bot, msg.chat.id);
    
    try {
      const tgId = msg.from.id.toString();
      const currentState = state.get(tgId) || {};
      
      // Toggle natural language mode
      await debug("Checking current natural language setting", null, bot, msg.chat.id);
      const isCurrentlyEnabled = currentState.naturalLanguageMode === true;
      
      if (isCurrentlyEnabled) {
        // Disable natural language mode
        await debug("Disabling natural language mode", null, bot, msg.chat.id);
        state.set(tgId, { ...currentState, naturalLanguageMode: false });
        const disableMessage = `🤖 **Natural Language Mode: OFF**\n\n` +
          `I will now only respond to:\n` +
          `• Commands (like /start, /me, /help)\n` +
          `• Button clicks\n\n` +
          `💡 Use /natural again to turn natural language back on.\n\n` +
          `📝 **Available Commands:**\n` +
          `• /start - Main menu\n` +
          `• /me - Profile\n` +
          `• /riderequest - Request a ride\n` +
          `• /rides - View rides\n` +
          `• /help - Help menu\n` +
          `• /natural - Toggle natural language`;
        
        // Get context-aware menu for registered users
        const user = await performRiderCrud("findRiderByTelegramId", tgId);
        const menu = user?.user ? await getContextAwareMainMenu(user.user._id.toString()) : getRiderMainMenu();
        
        await sendFinalMessage(
          bot,
          msg.chat.id,
          disableMessage,
          { parse_mode: "Markdown", ...menu }
        );
      } else {
        // Enable natural language mode
        await debug("Enabling natural language mode", null, bot, msg.chat.id);
        state.set(tgId, { ...currentState, naturalLanguageMode: true });
        const enableMessage = `🧠 **Rider: Natural Language Mode - ON**\n\n` +
          `🚗 **RIDER MODE:** I can now understand natural messages like:\n` +
          `• "I need a ride from downtown to airport at 3pm, bid $25"\n` +
          `• "Cancel my current ride"\n` +
          `• "Show me my ride history"\n\n` +
          `💡 Use /natural again to turn off natural language mode and save tokens.\n\n` +
          `🎯 **This mode uses AI processing and may cost more tokens.**\n\n` +
          `⏱️ *Response time: 3-45 seconds due to AI processing*`;
        
        // Get context-aware menu for registered users
        const user2 = await performRiderCrud("findRiderByTelegramId", tgId);
        const menu2 = user2?.user ? await getContextAwareMainMenu(user2.user._id.toString()) : getRiderMainMenu();
        
        await sendFinalMessage(
          bot,
          msg.chat.id,
          enableMessage,
          { parse_mode: "Markdown", ...menu2 }
        );
      }
    } catch (err) {
      await sendError(msg.chat.id, err, "Natural command failed.");
    }
  });
}

// Callback query handlers
function setupRiderCallbacks(bot) {
  // Remove any existing callback_query listeners to prevent duplicates
  bot.removeAllListeners('callback_query');
  
  bot.on("callback_query", async (cbq) => {
    const data = cbq.data;
    const chatId = cbq.message.chat.id;
    const tgId = cbq.from.id.toString();
    
    try {
      await debug("Processing button click", { action: data, userId: tgId }, bot, chatId);
      
      // Only check for session timeout on actions that require active state management
      // Skip timeout checks for simple menu navigation and read-only actions
      const readOnlyActions = [
        'view_rides', 'view_profile', 'show_help', 'main_menu', 
        'refresh', 'retry', 'cancel_delete', 'cancel_update'
      ];
      
      if (!readOnlyActions.includes(data)) {
        try {
          await state.checkUserTimeout(tgId);
        } catch (timeoutErr) {
          console.error("⏰ Session timeout check failed:", timeoutErr);
        }
      }
      
      // Registration
      if (data === "register_rider") {
        await debug("Setting up rider registration", null, bot, chatId);
        state.set(tgId, { phase: "register_rider" });
        await sendFinalMessage(
          bot,
          chatId,
          "🚗 **Rider Registration**\n\n📝 **Please send your details in this exact format:**\n\n`Name, Phone, Home Address, Work Address`\n\n**✅ Good Examples:**\n• `Jane Doe, 7522695640, 123 Main St Miami FL, Downtown Miami`\n• `John Smith, +1-555-123-4567, 456 Oak Ave Tampa FL, `\n• `Mary Johnson, (305) 555-9876, , Work Plaza Orlando FL`\n\n**❌ Common Mistakes:**\n• Phone number too short (need 7+ digits)\n• Name with numbers or symbols\n• Missing required fields (Name, Phone)\n\n**📋 Field Requirements:**\n• **Name:** 2-50 letters, spaces, hyphens, apostrophes only\n• **Phone:** 7-15 digits (any format: 1234567890, +1-234-567-8900, etc.)\n• **Addresses:** Optional, but include street/city/state if provided\n\n**Note:** Your Telegram username will be automatically detected. Home and work addresses help with location features but are optional. Use empty fields if not needed: `Name, Phone, , `",
          { parse_mode: "Markdown" }
        );
        return bot.answerCallbackQuery(cbq.id);
      }

      // Privacy Policy - Rider Accept
      if (data === "accept_privacy_rider") {
        const currentState = state.get(tgId);
        if (!currentState?.registrationData) {
          await bot.sendMessage(chatId, "❌ **Registration Data Lost**\n\nPlease start registration again.", getRegistrationButtons());
          return bot.answerCallbackQuery(cbq.id);
        }

        // Complete registration after privacy policy acceptance
        const result = await performRiderCrud("createRider", currentState.registrationData);
        
        if (!result?.success) {
          await bot.sendMessage(chatId, `❌ Registration failed: ${result?.error || "unknown error"}`, getErrorButtons());
          return bot.answerCallbackQuery(cbq.id);
        }

        state.clear(tgId);
        await bot.sendMessage(
          chatId,
          `✅ **Welcome to RideEase, ${currentState.registrationData.name}!**\n\n🚗 **RIDER:** You're all set as a rider. Use /riderequest when you need a ride!\n\n⚠️ **Privacy:** You can view, update, or delete your data anytime using the bot menu.\n\n⏱️ *Response time: 3-45 seconds due to AI processing*`,
          { parse_mode: "Markdown", ...getRiderMainMenu() }
        );
        return bot.answerCallbackQuery(cbq.id);
      }

      // Privacy Policy - Rider Decline
      if (data === "decline_privacy_rider") {
        state.clear(tgId);
        await bot.sendMessage(
          chatId,
          "❌ **Registration Cancelled**\n\nYour registration has been cancelled and no data has been stored.\n\n👋 Thank you for considering RideEase. You can start registration again anytime by sending /start.",
          { parse_mode: "Markdown" }
        );
        return bot.answerCallbackQuery(cbq.id);
      }

      // Main menu actions
      if (data === "request_ride") {
        await debug("Processing ride request button", null, bot, chatId);
        const registeredUser = await requireRiderRegistration({ from: cbq.from, chat: { id: chatId } });
        if (!registeredUser) {
          await clearTempMessage(bot, chatId);
          return bot.answerCallbackQuery(cbq.id); // User not registered, registration prompt already shown
        }

        // Prevent duplicate processing - check if we just set request_ride state recently
        const currentState = state.get(tgId);
        const now = Date.now();
        if (currentState?.phase === "request_ride" && currentState?.timestamp && (now - currentState.timestamp) < 5000) {
          await clearTempMessage(bot, chatId);
          return bot.answerCallbackQuery(cbq.id);
        }

        // Check for existing active ride (both open and matched)
        await debug("Checking for existing active rides", null, bot, chatId);
        const rideResult = await db.getRidesByUser(registeredUser.user._id.toString(), "rider");
        const activeRides = rideResult?.success ? rideResult.data?.filter(ride => 
          ride.status === "open" || ride.status === "matched"
        ) : [];
        const activeRide = activeRides?.[0] || null;
        
        if (activeRide) {
          await bot.sendMessage(
            chatId,
            `🟡 **You already have an active ride request!**\n\n${summarizeRide(activeRide)}\n\nCancel it first to request a new ride.`,
            { parse_mode: "Markdown" }
          );
          return bot.answerCallbackQuery(cbq.id);
        }

        state.set(tgId, { phase: "request_ride", timestamp: now });
        
        // Use a single consistent message
        await bot.sendMessage(
          chatId,
          "🚗 **Rider: Request a Ride**\n\n🚗 **As a RIDER,** tell me your ride details:\n\n• Example: \"Pickup: Miami Airport | Drop: Downtown Miami | Bid: $25 | Time: today 6:30 PM\"\n• Or just describe what you need naturally!\n\n⏱️ *Response time: 3-45 seconds due to AI processing*",
          { parse_mode: "Markdown" }
        );
        
        return bot.answerCallbackQuery(cbq.id);
      }

      // Handle cancel current ride with confirmation
      if (data === "cancel_current_ride") {
        const found = await requireRiderRegistration({ from: cbq.from, chat: { id: chatId } });
        if (!found) return bot.answerCallbackQuery(cbq.id);

        // Get current active ride
        const rideResult = await db.getRidesByUser(found.user._id.toString(), "rider");
        const activeRides = rideResult?.success ? rideResult.data?.filter(ride => 
          ride.status === "open" || ride.status === "matched"
        ) : [];
        const activeRide = activeRides?.[0] || null;

        if (!activeRide) {
          const menu = await getContextAwareMainMenu(found.user._id.toString());
          await bot.sendMessage(
            chatId,
            "❌ **No Active Ride**\n\nYou don't have any active rides to cancel.",
            { parse_mode: "Markdown", ...menu }
          );
          return bot.answerCallbackQuery(cbq.id);
        }

        // Show confirmation with ride details
        const rideInfo = 
          `📍 Pickup: ${activeRide.pickupLocationName}\n` +
          `📍 Drop: ${activeRide.dropLocationName}\n` +
          `💰 Bid: $${activeRide.bid}\n` +
          `⏰ Time: ${activeRide.timeOfRide ? new Date(activeRide.timeOfRide).toLocaleString() : 'ASAP'}\n` +
          `📊 Status: ${activeRide.status === "matched" ? "🟢 Matched with driver" : "🟡 Waiting for driver"}`;

        const confirmButtons = {
          reply_markup: {
            inline_keyboard: [
              [
                { text: "✅ Yes, Cancel Ride", callback_data: `confirm_cancel_${activeRide._id}` },
                { text: "❌ No, Keep Ride", callback_data: "main_menu" }
              ]
            ]
          }
        };

        await bot.sendMessage(
          chatId,
          `❓ **Cancel This Ride?**\n\n${rideInfo}\n\n⚠️ **Warning:** ${activeRide.status === "matched" ? "Your driver has already been notified. Canceling may affect your rating." : "This will remove your ride request from the system."}`,
          { parse_mode: "Markdown", ...confirmButtons }
        );
        return bot.answerCallbackQuery(cbq.id);
      }

      if (data === "cancel_ride") {
        const found = await requireRiderRegistration({ from: cbq.from, chat: { id: chatId } });
        if (!found) return bot.answerCallbackQuery(cbq.id);

        // Check for active ride that can be cancelled (both open and matched)
        const rideResult = await db.getRidesByUser(found.user._id.toString(), "rider");
        console.log(`Cancel ride debug - rideResult:`, rideResult);
        
        const activeRides = rideResult?.success ? rideResult.data?.filter(ride => 
          ride.status === "open" || ride.status === "matched"
        ) : [];
        
        console.log(`Cancel ride debug - activeRides:`, activeRides);
        console.log(`Cancel ride debug - rider ID:`, found.user._id.toString());
        
        const activeRide = activeRides?.[0] || null;
        
        if (!activeRide) {
          await bot.sendMessage(chatId, "🔴 No active ride request to cancel.", getRideManagementButtons());
        } else {
          await performRiderCrud("deleteRideRequest", activeRide._id);
          await bot.sendMessage(
            chatId,
            "❌ **Ride Cancelled**\n\nYour ride request has been cancelled.",
            { parse_mode: "Markdown", ...getRiderMainMenu(false) }
          );
        }
        return bot.answerCallbackQuery(cbq.id);
      }

      if (data === "view_profile") {
        const found = await requireRiderRegistration({ from: cbq.from, chat: { id: chatId } });
        if (!found) return bot.answerCallbackQuery(cbq.id);

        // Reuse the /me command logic
        const user = await performRiderCrud("findRiderByTelegramId", tgId);
        if (!user?.user || user.type !== "rider") {
          await bot.sendMessage(chatId, "❌ Rider profile not found. Please register first.", getRegistrationButtons());
          return bot.answerCallbackQuery(cbq.id);
        }

        let profileText = `👤 **Rider Profile**\n\n`;
        profileText += `📝 **Name:** ${user.user.name || "Not set"}\n`;
        profileText += `📞 **Phone:** ${user.user.phoneNumber || "Not set"}\n`;
        profileText += `⭐ **Rating:** ${user.user.rating || 0}/5\n`;
        
        // Count completed rides dynamically
        const totalRides = await db.countCompletedRides(user.user._id, 'rider');
        profileText += `📊 **Total Rides:** ${totalRides}\n`;
        
        if (user.user.homeAddress) {
          profileText += `🏠 **Home:** ${user.user.homeAddress}\n`;
        }
        if (user.user.workAddress) {
          profileText += `🏢 **Work:** ${user.user.workAddress}\n`;
        }
        
        // Check for active ride request
        const rideResult = await db.getRidesByUser(user.user._id.toString(), "rider");
        const activeRides = rideResult?.success ? rideResult.data?.filter(ride => 
          ride.status === "open" || ride.status === "matched"
        ) : [];
        const activeRide = activeRides?.[0] || null;
        
        if (activeRide) {
          const statusText = activeRide.status === "matched" ? 
            "🟢 **Current Status:** Ride matched! Driver assigned" : 
            "🟡 **Current Status:** Looking for driver";
          profileText += `\n${statusText}\n`;
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

        await bot.sendMessage(chatId, profileText, { 
          parse_mode: "Markdown",
          ...getRiderMainMenu(activeRide !== null)
        });
        return bot.answerCallbackQuery(cbq.id);
      }

      if (data === "view_rides") {
        const found = await requireRiderRegistration({ from: cbq.from, chat: { id: chatId } });
        if (!found) return bot.answerCallbackQuery(cbq.id);

        // Reuse the /rides command logic
        const result = await db.getRidesByUser(found.user._id, "rider");
        
        if (!result?.success || !result?.data || result.data.length === 0) {
          const menu = await getContextAwareMainMenu(found.user._id.toString());
          await bot.sendMessage(
            chatId,
            "🚗 **No Rides Yet**\n\nYou haven't booked any rides yet. Use the 🚗 Request Ride button to book your first ride!",
            { parse_mode: "Markdown", ...menu }
          );
          return bot.answerCallbackQuery(cbq.id);
        }

        const rides = result.data;
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

        await bot.sendMessage(chatId, ridesList, { 
          parse_mode: "Markdown",
          reply_markup: keyboard
        });
        return bot.answerCallbackQuery(cbq.id);
      }

      if (data === "update_details") {
        const found = await requireRiderRegistration({ from: cbq.from, chat: { id: chatId } });
        if (!found) return bot.answerCallbackQuery(cbq.id);

        const updateButtons = {
          reply_markup: {
            inline_keyboard: [
              [
                { text: "📱 Phone Number", callback_data: "update_phone" },
                { text: "👤 Name", callback_data: "update_name" }
              ],
              [
                { text: "🏠 Home Address", callback_data: "update_home_address" },
                { text: "🏢 Work Address", callback_data: "update_work_address" }
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
          "✏️ **Update Rider Profile**\n\nPlease select which field you want to update:",
          { parse_mode: "Markdown", ...updateButtons }
        );
        return bot.answerCallbackQuery(cbq.id);
      }

      // Handle update current ride
      if (data === "update_current_ride") {
        const found = await requireRiderRegistration({ from: cbq.from, chat: { id: chatId } });
        if (!found) return bot.answerCallbackQuery(cbq.id);

        // Get current active ride
        const rideResult = await db.getRidesByUser(found.user._id.toString(), "rider");
        const activeRides = rideResult?.success ? rideResult.data?.filter(ride => 
          ride.status === "open" || ride.status === "matched"
        ) : [];
        const activeRide = activeRides?.[0] || null;

        if (!activeRide) {
          const menu = await getContextAwareMainMenu(found.user._id.toString());
          await bot.sendMessage(
            chatId,
            "❌ **No Active Ride**\n\nYou don't have any active rides to update.",
            { parse_mode: "Markdown", ...menu }
          );
          return bot.answerCallbackQuery(cbq.id);
        }

        // If ride is already matched, don't allow updates
        if (activeRide.status === "matched") {
          await bot.sendMessage(
            chatId,
            "⚠️ **Ride Already Matched**\n\nYour ride has been matched with a driver. You cannot update ride details at this time.\n\nIf you need to make changes, please cancel this ride and create a new one.",
            { parse_mode: "Markdown", ...getQuickActionButtons() }
          );
          return bot.answerCallbackQuery(cbq.id);
        }

        // Set state for ride update
        state.set(tgId, { phase: "update_ride", rideId: activeRide._id });
        await bot.sendMessage(
          chatId,
          "✏️ **Update Your Ride**\n\n📍 **Current Ride:**\n" +
          `• Pickup: ${activeRide.pickupLocationName}\n` +
          `• Drop: ${activeRide.dropLocationName}\n` +
          `• Time: ${activeRide.timeOfRide ? new Date(activeRide.timeOfRide).toLocaleString() : 'ASAP'}\n` +
          `• Bid: $${activeRide.bid}\n\n` +
          "Send me the updated ride details:\n\n" +
          "`Pickup: <new address> | Drop: <new address> | Bid: <new amount> | Time: <new time>`\n\n" +
          "Or just tell me what you want to change naturally!",
          { parse_mode: "Markdown" }
        );
        return bot.answerCallbackQuery(cbq.id);
      }

      // Handle view ride details
      if (data === "view_ride_details") {
        const found = await requireRiderRegistration({ from: cbq.from, chat: { id: chatId } });
        if (!found) return bot.answerCallbackQuery(cbq.id);

        // Get current matched ride
        const rideResult = await db.getRidesByUser(found.user._id.toString(), "rider");
        const activeRides = rideResult?.success ? rideResult.data?.filter(ride => 
          ride.status === "matched"
        ) : [];
        const matchedRide = activeRides?.[0] || null;

        if (!matchedRide) {
          const menu = await getContextAwareMainMenu(found.user._id.toString());
          await bot.sendMessage(
            chatId,
            "❌ **No Matched Ride**\n\nYou don't have any rides matched with a driver.",
            { parse_mode: "Markdown", ...menu }
          );
          return bot.answerCallbackQuery(cbq.id);
        }

        try {
          // Get driver details
          const driverResult = await db.getDriver(matchedRide.driverId);
          const driver = driverResult?.success ? driverResult.data : null;

          if (!driver) {
            await bot.sendMessage(
              chatId,
              "❌ **Driver Information Unavailable**\n\nSorry, we couldn't retrieve your driver's information at the moment.",
              { parse_mode: "Markdown", ...getQuickActionButtons() }
            );
            return bot.answerCallbackQuery(cbq.id);
          }

          const rideTime = matchedRide.timeOfRide ? 
            new Date(matchedRide.timeOfRide).toLocaleString() : 'ASAP';

          const rideDetails = 
            "🚗 **Your Ride Details**\n\n" +
            "📍 **Trip Information:**\n" +
            `• Pickup: ${matchedRide.pickupLocationName}\n` +
            `• Drop: ${matchedRide.dropLocationName}\n` +
            `• Time: ${rideTime}\n` +
            `• Agreed Price: $${matchedRide.bid}\n\n` +
            "👨‍✈️ **Driver Information:**\n" +
            `• Name: ${driver.name}\n` +
            `• Phone: ${driver.phone}\n` +
            `• Car: ${driver.car?.make || 'N/A'} ${driver.car?.model || ''} (${driver.car?.color || 'N/A'})\n` +
            `• License: ${driver.car?.licensePlate || 'N/A'}\n\n` +
            "💡 **Need help?** Contact your driver directly or use the options below.";

          const detailsButtons = {
            reply_markup: {
              inline_keyboard: [
                [
                  { text: "📞 Call Driver", url: `tel:${driver.phone}` },
                  { text: "💬 Message Driver", callback_data: "message_driver" }
                ],
                [
                  { text: "❌ Cancel Ride", callback_data: "cancel_current_ride" },
                  { text: "🏠 Main Menu", callback_data: "main_menu" }
                ]
              ]
            }
          };

          await bot.sendMessage(chatId, rideDetails, { 
            parse_mode: "Markdown", 
            ...detailsButtons 
          });
          return bot.answerCallbackQuery(cbq.id);

        } catch (error) {
          console.error("Error fetching ride details:", error);
          await bot.sendMessage(
            chatId,
            "❌ **Error**\n\nSorry, there was an error retrieving your ride details. Please try again.",
            { parse_mode: "Markdown", ...getQuickActionButtons() }
          );
          return bot.answerCallbackQuery(cbq.id);
        }
      }

      // Individual field update callbacks
      if (data === "update_phone") {
        const found = await requireRiderRegistration({ from: cbq.from, chat: { id: chatId } });
        if (!found) return bot.answerCallbackQuery(cbq.id);

        state.set(tgId, { phase: "update_rider_phone" });
        await bot.sendMessage(
          chatId,
          "📱 **Update Phone Number**\n\nPlease enter your new phone number:",
          { parse_mode: "Markdown" }
        );
        return bot.answerCallbackQuery(cbq.id);
      }

      if (data === "update_name") {
        const found = await requireRiderRegistration({ from: cbq.from, chat: { id: chatId } });
        if (!found) return bot.answerCallbackQuery(cbq.id);

        state.set(tgId, { phase: "update_rider_name" });
        await bot.sendMessage(
          chatId,
          "👤 **Update Name**\n\nPlease enter your new name:",
          { parse_mode: "Markdown" }
        );
        return bot.answerCallbackQuery(cbq.id);
      }

      if (data === "update_home_address") {
        const found = await requireRiderRegistration({ from: cbq.from, chat: { id: chatId } });
        if (!found) return bot.answerCallbackQuery(cbq.id);

        state.set(tgId, { phase: "update_rider_home_address" });
        await bot.sendMessage(
          chatId,
          "🏠 **Update Home Address**\n\nPlease enter your new home address (e.g., 123 Main St Miami FL):",
          { parse_mode: "Markdown" }
        );
        return bot.answerCallbackQuery(cbq.id);
      }

      if (data === "update_work_address") {
        const found = await requireRiderRegistration({ from: cbq.from, chat: { id: chatId } });
        if (!found) return bot.answerCallbackQuery(cbq.id);

        state.set(tgId, { phase: "update_rider_work_address" });
        await bot.sendMessage(
          chatId,
          "🏢 **Update Work Address**\n\nPlease enter your new work address (e.g., 456 Office Blvd Miami FL):",
          { parse_mode: "Markdown" }
        );
        return bot.answerCallbackQuery(cbq.id);
      }

      if (data === "update_username") {
        const found = await requireRiderRegistration({ from: cbq.from, chat: { id: chatId } });
        if (!found) return bot.answerCallbackQuery(cbq.id);

        // Automatically update username from current user
        const telegramUsername = cbq.from.username ? `@${cbq.from.username}` : `@user_${tgId.slice(-8)}`;
        
        const result = await performRiderCrud("updateRider", {
          telegramId: tgId,
          updates: { telegramUsername }
        });
        
        if (result?.success) {
          await bot.sendMessage(
            chatId,
            `✅ **Username Updated!**\n\nYour Telegram username has been automatically updated to: ${telegramUsername}`,
            { parse_mode: "Markdown", ...getRiderMainMenu() }
          );
        } else {
          await bot.sendMessage(
            chatId,
            `❌ Username update failed: ${result?.error || "unknown error"}`,
            { parse_mode: "Markdown", ...getRiderMainMenu() }
          );
        }
        return bot.answerCallbackQuery(cbq.id);
      }

      if (data === "cancel_update") {
        await bot.sendMessage(
          chatId,
          "❌ **Update Canceled**\n\nYour profile update has been canceled.",
          { parse_mode: "Markdown", ...getRiderMainMenu() }
        );
        return bot.answerCallbackQuery(cbq.id);
      }

      if (data === "show_help") {
        const helpText = `🚗 **RideEase Rider Bot - Complete Command Guide**\n\n` +
          
          `**🚀 GETTING STARTED**\n` +
          `• \`/start\` - Main menu and registration\n` +
          `  └ *Use case:* First-time setup or return to main menu\n` +
          `  └ *Example:* Just send /start to see all available options\n` +
          `  └ *What happens:* Shows welcome message + main menu buttons if registered, or registration prompt if new\n\n` +
          
          `**👤 PROFILE MANAGEMENT**\n` +
          `• \`/me\` - View your complete rider profile\n` +
          `  └ *Use case:* Check your details, rating, total rides, and current ride status\n` +
          `  └ *Example:* Send /me to see your name, phone, addresses, active rides\n` +
          `  └ *Shows:* Name, phone, rating (x/5), total rides, home/work addresses, active ride status\n\n` +
          
          `• \`/update\` - Update your profile information\n` +
          `  └ *Use case:* Change phone number, name, addresses after registration\n` +
          `  └ *Format 1:* \`Name | Phone | Username | Home | Work\`\n` +
          `  └ *Format 2:* Natural language like "Update my phone to 555-0123"\n` +
          `  └ *Example:* "Set my home address to 123 Main St Miami FL"\n\n` +
          
          `• \`/erase\` - Permanently delete your profile\n` +
          `  └ *Use case:* Complete account removal (irreversible!)\n` +
          `  └ *Safety:* Requires confirmation via Yes/Cancel buttons\n` +
          `  └ *Warning:* Deletes ALL your data including ride history\n\n` +
          
          `**🚗 RIDE MANAGEMENT**\n` +
          `• \`/riderequest\` - Request a new ride\n` +
          `  └ *Use case:* Book rides when you need transportation\n` +
          `  └ *Smart format:* "Pickup: Miami Airport | Drop: Downtown Miami | Time: today 6pm | Bid: $25"\n` +
          `  └ *Natural format:* "I need a ride from the airport to downtown at 6pm today for $25"\n` +
          `  └ *Time examples:* "right now", "today 7pm", "tomorrow 9am", "in 2 hours"\n` +
          `  └ *Prevents:* Multiple active ride requests (shows current one if exists)\n\n` +
          
          `• \`/cancelride\` - Cancel your active ride request\n` +
          `  └ *Use case:* Cancel pending or matched rides before they start\n` +
          `  └ *Safety:* Shows ride details + confirmation buttons (Yes/Keep)\n` +
          `  └ *Works for:* Both "open" (looking for driver) and "matched" (driver assigned) rides\n\n` +
          
          `• \`/completed\` - Mark your current ride as completed\n` +
          `  └ *Use case:* Complete matched or in-progress rides\n` +
          `  └ *Action:* Updates ride status to "completed" and notifies driver\n` +
          `  └ *Works for:* "matched" or "in_progress" rides only\n\n` +
          
          `• \`/rides\` - View your ride history and active requests\n` +
          `  └ *Use case:* Track all your rides (past and current)\n` +
          `  └ *Shows:* Status (✅ Completed, 🔄 Matched, 🟡 Open, ❌ Cancelled)\n` +
          `  └ *Details:* Pickup → Drop locations, time, bid amount, status\n` +
          `  └ *Actions:* Quick buttons to update or cancel open rides\n` +
          `  └ *Limit:* Shows last 10 rides (+ count if more exist)\n\n` +
          
          `**🛠️ UTILITY COMMANDS**\n` +
          `• \`/time\` - Show current date/time with format examples\n` +
          `  └ *Use case:* Check current time before booking rides\n` +
          `  └ *Shows:* Full date, current time, timezone info\n` +
          `  └ *Examples:* Time format examples for ride booking\n\n` +
          
          `• \`/clearcache\` - Clear your session cache\n` +
          `  └ *Use case:* Fix stuck states, resolve bot issues\n` +
          `  └ *When to use:* Bot not responding properly, stuck in registration/update mode\n` +
          `  └ *Safe:* Doesn't delete your profile, just clears temporary session data\n\n` +
          
          `**🤖 NATURAL LANGUAGE FEATURES**\n` +
          `Just chat with me naturally! I understand:\n` +
          `• "Book me a ride from home to work tomorrow at 8am for $15"\n` +
          `• "Cancel my current ride request"\n` +
          `• "Update my phone number to 555-1234"\n` +
          `• "Show me my ride history"\n` +
          `• "I need to get to Miami Beach from downtown right now"\n\n` +
          
          `**🏠🏢 ADDRESS SHORTCUTS**\n` +
          `Set up your addresses in /update to use shortcuts:\n` +
          `• "Take me from home to work at 8am, bid $25"\n` +
          `• "I need a ride from work to home at 6pm today, $30"\n` +
          `• "Pickup: home | Drop: Miami Airport | Time: tomorrow 9am | Bid: $40"\n` +
          `• If not set up: Bot will prompt you to add addresses first\n\n` +
          
          `**📱 MAIN MENU BUTTONS**\n` +
          `Use the buttons that appear after commands:\n` +
          `• 🚗 Request Ride - Same as /riderequest\n` +
          `• ❌ Cancel Ride - Same as /cancelride  \n` +
          `• 👤 My Profile - Same as /me\n` +
          `• 📋 My Rides - Same as /rides\n` +
          `• ✏️ Update Details - Same as /update\n` +
          `• ❓ Help - Same as /help\n\n` +
          
          `**⚡ REGISTRATION (New Users)**\n` +
          `First time? Click "Register as Rider" then send:\n` +
          `\`Jane Doe | 555-0123 | 123 Main St Miami FL | Downtown Miami\`\n` +
          `• Name and Phone are required\n` +
          `• Username is automatically detected from your Telegram account\n` +
          `• Home and Work addresses are optional (leave empty: \`| | \`)\n\n` +
          
          `**🚨 TROUBLESHOOTING**\n` +
          `• Bot stuck? Try /clearcache\n` +
          `• Can't register? Check your format: \`Name | Phone | address | work\` (username auto-detected)\n` +
          `• Ride time errors? Use formats like "today 6pm" or "tomorrow 9am"\n` +
          `• Multiple rides? Cancel current ride first with /cancelride\n\n` +
          
          `**💡 PRO TIPS**\n` +
          `• Set home/work addresses to use shortcuts like "from home to work"\n` +
          `• Higher bids may get faster driver matches\n` +
          `• Use /time to see current time before setting ride times\n` +
          `• Both commands and natural language work - use what's comfortable!\n\n` +
          
          `*Need more help? Just ask me anything naturally - I'll understand! 🤖*\n\n` +
          `⏱️ **Response Time:** 3-45 seconds due to AI processing`;

        await bot.sendMessage(chatId, helpText, { 
          parse_mode: "Markdown",
          ...getRiderMainMenu()
        });
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
          "✏️ **Update Ride Details**\n\nSend the updated ride information:\n\n`Pickup: <new address> | Drop: <new address> | Bid: <new amount> | Time: <new time>`\n\nOr just tell me what you want to change!",
          { parse_mode: "Markdown" }
        );
        return bot.answerCallbackQuery(cbq.id);
      }

      // Delete confirmation
      if (data === "confirm_delete") {
        const user = await performRiderCrud("findRiderByTelegramId", tgId);
        if (user?.user?._id && user.type === "rider") {
          await performRiderCrud("deleteRider", user.user._id);
          await bot.sendMessage(
            chatId,
            "✅ **Profile Deleted**\n\nYour rider profile has been permanently deleted. Thank you for using RideEase!\n\nIf you want to use our service again, just send /start to register."
          );
        } else {
          await bot.sendMessage(chatId, "❌ Profile not found.", getRegistrationButtons());
        }
        return bot.answerCallbackQuery(cbq.id);
      }

      if (data === "cancel_delete") {
        await bot.sendMessage(chatId, "❌ **Deletion Cancelled**\n\nYour profile is safe!", getRiderMainMenu());
        return bot.answerCallbackQuery(cbq.id);
      }

      // Handle main menu callback
      if (data === "main_menu") {
        const found = await isRiderRegistered({ from: cbq.from, chat: { id: chatId } });
        if (found) {
          const menu = await getContextAwareMainMenu(found.user._id.toString());
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
          `• "I need a ride from downtown to airport at 3pm, bid $25"\n` +
          `• "Cancel my current ride"\n` +
          `• "Show me my ride history"\n\n` +
          `💡 Use /natural again to turn off natural language mode and save tokens.\n\n` +
          `🎯 **This mode uses AI processing and may cost more tokens.**`,
          { parse_mode: "Markdown", ...getRiderMainMenu() }
        );
        return bot.answerCallbackQuery(cbq.id);
      }

      // Handle retry callback
      if (data === "retry") {
        const found = await isRiderRegistered({ from: cbq.from, chat: { id: chatId } });
        const menu = found ? await getContextAwareMainMenu(found.user._id.toString()) : getRiderMainMenu(false);
        await bot.sendMessage(chatId, "🔄 **Try Again**\n\nPlease try your last action again or use the menu below.", menu);
        return bot.answerCallbackQuery(cbq.id);
      }

      // Handle refresh callback
      if (data === "refresh") {
        const found = await isRiderRegistered({ from: cbq.from, chat: { id: chatId } });
        const menu = found ? await getContextAwareMainMenu(found.user._id.toString()) : getRiderMainMenu(false);
        await bot.sendMessage(chatId, "🔄 **Refreshed**\n\nContent has been refreshed. Use the menu below for available actions.", menu);
        return bot.answerCallbackQuery(cbq.id);
      }

      // Handle mark completed callback
      if (data === "mark_completed") {
        const found = await isRiderRegistered({ from: cbq.from, chat: { id: chatId } });
        if (!found) {
          await bot.sendMessage(chatId, "👋 Please register first.", getRegistrationButtons());
          return bot.answerCallbackQuery(cbq.id);
        }

        // Find the rider's current matched or in-progress ride
        const riderId = found.user._id;
        const mongoose = require('mongoose');
        const riderObjectId = mongoose.Types.ObjectId.isValid(riderId) ? 
          new mongoose.Types.ObjectId(riderId) : riderId;
        
        const matchedRide = await Ride.findOne({
          riderId: riderObjectId,
          status: { $in: ["matched", "in_progress"] }
        });

        if (!matchedRide) {
          await bot.sendMessage(chatId, "❌ **No Active Ride**\n\nYou don't have any active rides to complete.", getRiderMainMenu(false));
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
            { parse_mode: "Markdown", ...getRiderMainMenu(false) }
          );

          // Notify the driver
          try {
            const driver = await Driver.findOne({ _id: matchedRide.driverId });
            if (driver && driver.telegramId && driver.telegramId !== "1") {
              await notifications.notifyDriver(
                driver,
                `✅ **Ride Completed!**\n\n📍 From: ${matchedRide.pickupLocationName}\n📍 To: ${matchedRide.dropLocationName}\n� Time: ${matchedRide.timeOfRide ? new Date(matchedRide.timeOfRide).toLocaleString() : 'ASAP'}\n�👤 Rider: ${found.user.name}\n💰 Amount: $${matchedRide.bid}\n\nThank you for using RideEase!`,
                { parse_mode: "Markdown" }
              );
            }
          } catch (err) {
            console.error("Failed to notify driver of ride completion:", err);
          }
        } else {
          await bot.sendMessage(chatId, "❌ **Failed to Complete Ride**\n\nCould not update ride status. Please try again.", getErrorButtons());
        }
        return bot.answerCallbackQuery(cbq.id);
      }

      // Handle view ride details callback  
      if (data === "view_ride_details") {
        const found = await isRiderRegistered({ from: cbq.from, chat: { id: chatId } });
        if (!found) {
          await bot.sendMessage(chatId, "👋 Please register first.", getRegistrationButtons());
          return bot.answerCallbackQuery(cbq.id);
        }

        // Find current active ride
        const riderId = found.user._id;
        const mongoose = require('mongoose');
        const riderObjectId = mongoose.Types.ObjectId.isValid(riderId) ? 
          new mongoose.Types.ObjectId(riderId) : riderId;
        
        const activeRide = await Ride.findOne({
          riderId: riderObjectId,
          status: { $in: ["matched", "in_progress"] }
        });

        if (activeRide) {
          const statusText = activeRide.status === "matched" ? 
            "🔄 **Current Status:** Ride matched! Driver assigned" : 
            "🚗 **Current Status:** Ride in progress";
          
          await bot.sendMessage(
            chatId,
            `📋 **Current Ride Details**\n\n${statusText}\n\n📍 **From:** ${activeRide.pickupLocationName}\n📍 **To:** ${activeRide.dropLocationName}\n🕐 **Time:** ${new Date(activeRide.timeOfRide).toLocaleString()}\n💰 **Bid:** $${activeRide.bid}`,
            { parse_mode: "Markdown", ...getRideCompletionButtons() }
          );
        } else {
          await bot.sendMessage(chatId, "❌ **No Active Ride**\n\nYou don't have any active rides.", getRiderMainMenu());
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

// Message handlers for natural language processing
function setupRiderMessageHandlers(bot) {
  // Remove any existing message listeners to prevent duplicates
  bot.removeAllListeners('message');
  
  bot.on("message", async (msg) => {
    const messageStartTime = Date.now();
    await debug("Message received", { userId: msg.from.id, text: msg.text?.substring(0, 50) + '...' }, bot, msg.chat.id);
    
    try {
      if (!msg.text || msg.via_bot || msg.edit_date) return;
      if (msg.text.startsWith('/')) return; // Skip commands
      
      await debug("Initial message validation completed", { duration: Date.now() - messageStartTime + 'ms' }, bot, msg.chat.id);
      
      const tgId = msg.from.id.toString();
      const st = state.get(tgId);
      
      // Only check for session timeout if user is in an active state that requires it
      // Skip timeout checks for users just sending casual messages
      const requiresTimeoutCheck = st && (
        st.phase === "register_rider" || 
        st.phase === "request_ride" || 
        st.phase === "update_profile" ||
        st.naturalLanguageMode === true
      );
      
      if (requiresTimeoutCheck) {
        try {
          await state.checkUserTimeout(tgId);
        } catch (timeoutErr) {
          console.error("⏰ Session timeout check failed:", timeoutErr);
        }
      }

      // Check for natural language mode - if disabled, only process registration and special phases
      if (st?.naturalLanguageMode !== true && 
          st?.phase !== "register_rider" && 
          st?.phase !== "request_ride" && 
          st?.phase !== "update_ride" && 
          st?.phase !== "update_rider" &&
          st?.phase !== "update_rider_phone" &&
          st?.phase !== "update_rider_name" &&
          st?.phase !== "update_rider_home_address" &&
          st?.phase !== "update_rider_work_address" &&
          st?.phase !== "update_rider_username") {
        await debug("Natural language mode disabled, showing command menu", null, bot, msg.chat.id);
        await clearTempMessage(bot, msg.chat.id);
        return bot.sendMessage(
          msg.chat.id,
          `🤖 **Rider: Command Mode Active**\n\n` +
          `🚗 **RIDER MODE:** I didn't understand that. I only respond to commands and buttons.\n\n` +
          `📝 **Available Commands for RIDERS:**\n` +
          `• /start - Main menu\n` +
          `• /me - View profile\n` +
          `• /riderequest - Request a ride\n` +
          `• /rides - View your rides\n` +
          `• /help - Get help\n\n` +
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
      if (st?.phase === "register_rider") {
        await debug("Processing rider registration", { parts: text.split(",").length }, bot, msg.chat.id);
        
        const parts = text.split(",").map(s => s.trim());
        
        if (parts.length < 2) {
          await clearTempMessage(bot, msg.chat.id);
          return bot.sendMessage(
            msg.chat.id,
            "❌ Please send at least the first 2 required fields:\n`Name, Phone, Home Address, Work Address`\n\nHome and work addresses are optional - you can leave them empty:\n`Name, Phone, , `\n\n**Example:**\n`John Smith, 7522695640, 123 Main St Miami FL, Downtown Miami`\n\n*Your Telegram username will be automatically detected.*",
            { parse_mode: "Markdown" }
          );
        }
        
        const [name, phoneNumber, homeAddress = "", workAddress = ""] = parts;
        // Automatically get the telegram username from the message sender
        const telegramUsername = msg.from.username ? `@${msg.from.username}` : `@user_${tgId.slice(-8)}`;
        
        console.log("🔍 DEBUG: Extracted fields:", {
          name: `"${name}"`,
          phoneNumber: `"${phoneNumber}"`,
          telegramUsername: `"${telegramUsername}"`,
          homeAddress: `"${homeAddress}"`,
          workAddress: `"${workAddress}"`
        });
        
        // Validate input data
        const validationResult = validation.validateRiderRegistration({
          name,
          phoneNumber,
          telegramUsername,
          homeAddress: homeAddress || undefined,
          workAddress: workAddress || undefined
        });

        console.log("🔍 DEBUG: Validation result:", validationResult);

        if (!validationResult.isValid) {
          console.log("❌ DEBUG: Validation failed with errors:", validationResult.errors);
          return bot.sendMessage(
            msg.chat.id,
            `❌ **Registration Validation Errors:**\n\n${validationResult.errors.map(err => `• ${err}`).join('\n')}\n\n**Please fix these issues and try again.**\n\n**Format:** \`Name, Phone, Home Address, Work Address\`\n**Example:** \`John Smith, 7522695640, 123 Main St Miami FL, Downtown Miami\`\n\n*Your Telegram username will be automatically detected.*`,
            { parse_mode: "Markdown" }
          );
        }
        
        console.log("✅ DEBUG: Validation passed, creating rider data");
        
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
        
        console.log("🔍 DEBUG: Final rider data for creation:", riderData);
        
        // Store registration data temporarily for privacy policy acceptance
        state.set(tgId, { 
          phase: "privacy_policy_rider",
          registrationData: riderData
        });
        
        // Send privacy policy acceptance prompt
        const privacyPolicyButtons = {
          reply_markup: {
            inline_keyboard: [
              [
                { text: "✅ Accept & Register", callback_data: "accept_privacy_rider" },
                { text: "❌ Decline & Erase", callback_data: "decline_privacy_rider" }
              ],
              [
                { text: "📄 Read Privacy Policy", url: "https://iboulevardi.app/privacy" }
              ]
            ]
          }
        };
        
        await clearTempMessage(bot, msg.chat.id);
        await bot.sendMessage(
          msg.chat.id,
          `📋 **Privacy Policy & Terms**\n\n${name}, before completing your rider registration, please review and accept our Privacy Policy.\n\n🔒 **Your privacy matters to us!**\n\n**What we collect:**\n• Name, phone number, and addresses\n• Ride requests and location data\n• Ride history and preferences\n\n**How we use it:**\n• Match you with nearby drivers\n• Process ride requests and payments\n• Improve our service experience\n\n**Your rights:**\n• View, update, or delete your data anytime\n• Control location sharing\n• Contact us with privacy concerns\n\n📄 **Please read our full Privacy Policy and accept to continue.**`,
          { parse_mode: "Markdown", ...privacyPolicyButtons }
        );
        return;
      }

      // Handle ride request
      if (st?.phase === "request_ride") {
        console.log("🐛 DEBUG: Detected request_ride phase, calling handleRideRequest");
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

      // Handle individual field updates
      if (st?.phase === "update_rider_phone") {
        await handleRiderFieldUpdate(bot, msg, text, "phoneNumber", "Phone Number");
        return;
      }

      if (st?.phase === "update_rider_name") {
        await handleRiderFieldUpdate(bot, msg, text, "name", "Name");
        return;
      }

      if (st?.phase === "update_rider_home_address") {
        await handleRiderFieldUpdate(bot, msg, text, "homeAddress", "Home Address");
        return;
      }

      if (st?.phase === "update_rider_work_address") {
        await handleRiderFieldUpdate(bot, msg, text, "workAddress", "Work Address");
        return;
      }

      if (st?.phase === "update_rider_username") {
        // Username is now automatically detected, so clear state and inform user
        state.clear(tgId);
        await bot.sendMessage(
          msg.chat.id,
          "ℹ️ **Username Auto-Detection**\n\nYour Telegram username is now automatically detected and updated. No manual input needed!\n\nCurrent username: " + (msg.from.username ? `@${msg.from.username}` : `@user_${tgId.slice(-8)}`),
          { parse_mode: "Markdown", ...getRiderMainMenu() }
        );
        return;
      }

      // Ensure registered for other messages
      await debug("Checking rider registration", null, bot, msg.chat.id);
      const ensureStartTime = Date.now();
      const registeredUser = await requireRiderRegistration(msg);
      if (!registeredUser) {
        await clearTempMessage(bot, msg.chat.id);
        return; // User not registered, registration prompt already shown
      }

      // Show typing indicator while processing
      await debug("Starting AI analysis", null, bot, msg.chat.id);
      const clearTyping = await showTyping(bot, msg.chat.id);

      try {
        // Process with OpenAI for intent detection
        await debug("Analyzing your message with AI", null, bot, msg.chat.id);
        const openaiStartTime = Date.now();
        const intent = await openai.detectIntent(text, "rider");
        await debug("AI analysis completed", { duration: Date.now() - openaiStartTime + 'ms' }, bot, msg.chat.id);
        clearTyping();
        
        await debug("Processing your request", null, bot, msg.chat.id);
        const handleIntentStartTime = Date.now();
        await handleRiderIntent(bot, msg, intent, registeredUser);
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

async function handleRideRequest(bot, msg, text) {
  const tgId = msg.from.id.toString();
  const requestStartTime = Date.now();
  
  try {
    // Show typing indicator while processing intent
    await debug("Processing ride request", { userId: tgId }, bot, msg.chat.id);
    const clearTyping = await showTyping(bot, msg.chat.id);
    
    await debug("Analyzing ride details with AI", null, bot, msg.chat.id);
    const intentStartTime = Date.now();
    const intent = await openai.detectIntent(text, "rider");
    await debug("AI analysis completed", { duration: Date.now() - intentStartTime + 'ms' }, bot, msg.chat.id);
    clearTyping();
    
    if (intent?.type === "rider_ride") {
      console.log("🐛 DEBUG: Processing rider_ride intent");
      const { pickup, dropoff, bid, rideTimeISO, confidence, timeInterpretation, errors } = intent.fields || {};
      
      console.log("🐛 DEBUG: Extracted fields:");
      console.log("  - pickup:", pickup);
      console.log("  - dropoff:", dropoff);
      console.log("  - bid:", bid);
      console.log("  - rideTimeISO:", rideTimeISO);
      console.log("  - confidence:", confidence);
      console.log("  - timeInterpretation:", timeInterpretation);
      console.log("  - errors:", errors);
      
      // Get user data to access home and work addresses
      await debug("Fetching your profile data", null, bot, msg.chat.id);
      const userData = await performRiderCrud("findRiderByTelegramId", tgId);
      if (!userData?.user) {
        await clearTempMessage(bot, msg.chat.id);
        return bot.sendMessage(msg.chat.id, "❌ **Rider Error**\n\n🚗 **RIDER:** Unable to process request. Please try again.\n\n⏱️ *Response time: 3-45 seconds due to AI processing*", getErrorButtons());
      }
      
      const { homeAddress, workAddress } = userData.user;
      
      // Replace address shortcuts with actual addresses
      await debug("Processing pickup and drop-off locations", null, bot, msg.chat.id);
      const pickupReplacement = replaceAddressShortcuts(pickup, homeAddress, workAddress);
      const dropoffReplacement = replaceAddressShortcuts(dropoff, homeAddress, workAddress);
      
      // Check for address replacement errors
      if (pickupReplacement.error) {
        return bot.sendMessage(
          msg.chat.id, 
          `❌ **Pickup Location Issue**\n\n${pickupReplacement.error}`,
          { parse_mode: "Markdown", ...getErrorButtons() }
        );
      }
      
      if (dropoffReplacement.error) {
        return bot.sendMessage(
          msg.chat.id, 
          `❌ **Drop-off Location Issue**\n\n${dropoffReplacement.error}`,
          { parse_mode: "Markdown", ...getErrorButtons() }
        );
      }
      
      // Use the replaced addresses
      const finalPickup = pickupReplacement.address;
      const finalDropoff = dropoffReplacement.address;
      
      console.log("🐛 DEBUG: Final addresses:");
      console.log("  - finalPickup:", finalPickup);
      console.log("  - finalDropoff:", finalDropoff);
      
      // Separate critical errors from warnings
      const criticalErrors = errors ? errors.filter(err => 
        err.includes("missing") || err.includes("could not be parsed")
      ) : [];
      
      console.log("🐛 DEBUG: Critical errors:", criticalErrors);
      
      // Handle critical errors (missing required fields)
      if (criticalErrors.length > 0 || !finalPickup || !finalDropoff || !rideTimeISO) {
        console.log("🐛 DEBUG: Critical errors found, sending error message");
        let message = "❌ I need more information:\n\n";
        
        if (!finalPickup) message += "• Pickup location missing\n";
        if (!finalDropoff) message += "• Drop-off location missing\n";  
        if (!rideTimeISO) message += "• Ride time missing\n";
        
        if (criticalErrors.length > 0) {
          message += criticalErrors.map(err => `• ${err}`).join('\n') + "\n";
        }
        
        message += "\n💡 Try this format:\n\"Pickup: Miami Airport | Drop: Downtown Miami | Time: today 7pm | Bid: $30\"";
        message += "\n\nOr just describe naturally:\n\"I need a ride from the airport to downtown at 7pm today for $25\"";
        message += "\n\n🏠🏢 You can also use shortcuts like 'from home to work' if you've set up your addresses in /update";
        
        return bot.sendMessage(msg.chat.id, message, getErrorButtons());
      }
      
      // Handle time validation
      console.log("🐛 DEBUG: Validating ride time");
      const rideTime = new Date(rideTimeISO);
      const now = new Date();
      const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
      
      console.log("🐛 DEBUG: Time validation:");
      console.log("  - rideTime:", rideTime.toISOString());
      console.log("  - now:", now.toISOString());
      console.log("  - fiveMinutesAgo:", fiveMinutesAgo.toISOString());
      console.log("  - rideTime < fiveMinutesAgo:", rideTime.getTime() < fiveMinutesAgo.getTime());
      
      if (rideTime.getTime() < fiveMinutesAgo.getTime()) {
        console.log("🐛 DEBUG: Ride time is in the past, sending error");
        return bot.sendMessage(
          msg.chat.id, 
          `❌ The ride time appears to be in the past.\n\n` +
          `You specified: ${timeInterpretation || rideTime.toLocaleString()}\n` +
          `Current time: ${now.toLocaleString()}\n\n` +
          `Please specify a future time like:\n• "today 7pm"\n• "tomorrow 9am"\n• "in 2 hours"`,
          getErrorButtons()
        );
      }
      
      // For low confidence times, show a warning but proceed
      let confirmationMessage = "";
      if (confidence === "low" && timeInterpretation) {
        confirmationMessage = `⚠️ Time interpretation: ${timeInterpretation}\n\n`;
      }

      // Geocode addresses
      await debug("Looking up pickup location", null, bot, msg.chat.id);
      let gp, gd;
      const clearGeoTyping = await showTyping(bot, msg.chat.id);
      try {
        gp = await geocode.geocodeAddress(finalPickup);
        await debug("Looking up drop-off location", null, bot, msg.chat.id);
        
        gd = await geocode.geocodeAddress(finalDropoff);
        await debug("Location lookup completed", null, bot, msg.chat.id);
        clearGeoTyping();
      } catch (err) {
        console.error("🐛 DEBUG: Geocoding error:", err);
        clearGeoTyping();
        return sendFinalMessage(bot, msg.chat.id, "❌ **Address Not Found**\n\nCould not locate one of the specified addresses. Please provide more specific addresses and try again.", { parse_mode: "Markdown", ...getErrorButtons() });
      }

      if (!gp || !gd) {
        console.log("🐛 DEBUG: Geocoding failed - gp:", gp, "gd:", gd);
        clearGeoTyping();
        return sendFinalMessage(bot, msg.chat.id, "❌ **Address Lookup Failed**\n\nCould not locate the specified addresses. Please provide more detailed addresses and try again.", { parse_mode: "Markdown", ...getErrorButtons() });
      }

      // Double-check ride time (redundant but for safety)
      if (rideTime.getTime() < Date.now() - (2 * 60 * 1000)) { // 2 minute buffer
        console.log("🐛 DEBUG: Second time check failed");
        return bot.sendMessage(msg.chat.id, "❌ **Invalid Ride Time**\n\nThe specified ride time cannot be in the past. Please provide a future time.", { parse_mode: "Markdown", ...getErrorButtons() });
      }

      await debug("Validating your rider profile", null, bot, msg.chat.id);
      const userResult = await performRiderCrud("findRiderByTelegramId", tgId);
      
      if (!userResult?.user?._id || userResult.type !== "rider") {
        await clearTempMessage(bot, msg.chat.id);
        return bot.sendMessage(msg.chat.id, "❌ **Registration Required**\n\nRider profile not found. Please register first using /start.", { parse_mode: "Markdown", ...getRegistrationButtons() });
      }

      // Check if user already has an active ride
      await debug("Checking for existing active rides", null, bot, msg.chat.id);
      try {
        await assertSingleOpen("rider", userResult.user._id);
        
        // Rate limiting for ride requests
        checkRateLimit(userResult.user._id.toString(), 'ride_request', 5, 60000); // 5 requests per minute
      } catch (error) {
        await clearTempMessage(bot, msg.chat.id);
        return bot.sendMessage(msg.chat.id, `❌ ${error.message}`, getErrorButtons());
      }

      await debug("Creating your ride request", null, bot, msg.chat.id);
      const rideData = {
        riderId: userResult.user._id,
        pickupLocationName: gp.name,
        pickupLocation: { type: "Point", coordinates: [gp.lon, gp.lat] },
        dropLocationName: gd.name,
        dropLocation: { type: "Point", coordinates: [gd.lon, gd.lat] },
        bid: Number(bid) || 0,
        timeOfRide: rideTime,
        status: "open",
      };
      console.log("🐛 DEBUG: Ride data:", JSON.stringify(rideData, null, 2));

      try {
        const ride = await performRiderCrud("createRideRequest", rideData);
        console.log("🐛 DEBUG: Create ride result:", JSON.stringify(ride, null, 2));

        if (!ride?._id) {
          console.error("🐛 DEBUG: Failed to create ride - no _id returned");
          return bot.sendMessage(msg.chat.id, "❌ Failed to create ride request. Please try again.", getErrorButtons());
        }

        console.log("🐛 DEBUG: Ride created successfully");
      
      // Prepare success message with address replacement info
      let addressReplacementInfo = "";
      if (pickup !== finalPickup) {
        addressReplacementInfo += `📍 Pickup: "${pickup}" → ${finalPickup}\n`;
      }
      if (dropoff !== finalDropoff) {
        addressReplacementInfo += `📍 Drop-off: "${dropoff}" → ${finalDropoff}\n`;
      }
      if (addressReplacementInfo) {
        addressReplacementInfo = `\n**Address Shortcuts Used:**\n${addressReplacementInfo}`;
      }
      
      await debug("Ride request created successfully!", null, bot, msg.chat.id);
      await sendFinalMessage(
        bot,
        msg.chat.id,
        `✅ **Ride Request Created!**${addressReplacementInfo}\n\n${summarizeRide({
          pickupLocationName: gp.name,
          dropLocationName: gd.name,
          timeOfRide: rideTime,
          bid: bid
        })}\n\nI'll notify you when a driver accepts your ride!`,
        { parse_mode: "Markdown", ...getRiderMainMenu() }
      );

      // Notify nearby drivers
      console.log("🐛 DEBUG: Attempting to notify nearby drivers");
      console.log("🐛 DEBUG: Ride object for notification:", JSON.stringify(ride, null, 2));
      
      try {
        console.log("🐛 DEBUG: Checking if matching.findDriversForRide is a function");
        console.log("🐛 DEBUG: typeof matching.findDriversForRide:", typeof matching.findDriversForRide);
        
        if (typeof matching.findDriversForRide === "function") {
          console.log("🐛 DEBUG: Calling matching.findDriversForRide with ride:", ride._id);
          // This function handles both finding drivers AND notifying them
          const drivers = await matching.findDriversForRide(ride);
          console.log("🐛 DEBUG: Found and notified drivers:", drivers?.length || 0);
        } else {
          console.log("🐛 DEBUG: matching.findDriversForRide is not a function");
        }
      } catch (err) {
        console.error("🐛 DEBUG: Failed to notify drivers:", err);
        console.error("🐛 DEBUG: Error stack:", err.stack);
      }
      
      // Clear state only after all operations including driver notifications are complete
      console.log("🐛 DEBUG: Clearing state after ride creation and driver notification");
      state.clear(tgId);
      
      } catch (rideCreationError) {
        console.error("🐛 DEBUG: Ride creation error:", rideCreationError);
        console.error("🐛 DEBUG: Error stack:", rideCreationError.stack);
        return bot.sendMessage(msg.chat.id, "❌ Failed to create ride request. Please try again.", getErrorButtons());
      }
      
    } else {
      console.log("🐛 DEBUG: Intent type is not rider_ride:", intent?.type);
      await bot.sendMessage(
        msg.chat.id,
        "❌ **Invalid Ride Request**\n\nI couldn't understand your ride request. Please include:\n\n• **Pickup location**\n• **Drop-off location** \n• **Time** (examples: 'right now', 'today 6pm', 'tomorrow 9am')\n• **Optional:** bid amount\n\n💡 **Example:**\n\"Pickup: Miami Airport | Drop: Downtown Miami | Time: today 6pm | Bid: $25\"",
        { parse_mode: "Markdown", ...getErrorButtons() }
      );
    }
  } catch (err) {
    console.error("🐛 DEBUG: Major error in handleRideRequest:", err);
    console.error("🐛 DEBUG: Error stack:", err.stack);
    await sendError(msg.chat.id, err, "Ride request failed.");
    state.clear(tgId);
  }
}

async function handleRideRequestFromIntent(bot, msg, intent) {
  const tgId = msg.from.id.toString();
  console.log("🚗 PERF: Starting handleRideRequestFromIntent");
  console.log("🐛 DEBUG: Processing intent:", JSON.stringify(intent, null, 2));
  
  try {
    const { pickup, dropoff, bid, rideTimeISO, confidence, timeInterpretation, errors } = intent.fields || {};
    
    console.log("🐛 DEBUG: Extracted fields from intent:");
    console.log("  - pickup:", pickup);
    console.log("  - dropoff:", dropoff);
    console.log("  - bid:", bid);
    console.log("  - rideTimeISO:", rideTimeISO);
    console.log("  - confidence:", confidence);
    console.log("  - timeInterpretation:", timeInterpretation);
    console.log("  - errors:", errors);
    
    // Check for critical errors
    if (errors && errors.length > 0) {
      console.log("🐛 DEBUG: Intent has errors, sending error message");
      let message = "❌ I need more information:\n\n";
      message += errors.map(err => `• ${err}`).join('\n') + "\n";
      message += "\n💡 Try this format:\n\"Pickup: Miami Airport | Drop: Downtown Miami | Time: today 7pm | Bid: $30\"";
      message += "\n\nOr just describe naturally:\n\"I need a ride from the airport to downtown at 7pm today, bid $30\"";
      return bot.sendMessage(msg.chat.id, message, getErrorButtons());
    }

    if (!pickup || !dropoff || !rideTimeISO) {
      console.log("🐛 DEBUG: Missing required fields");
      let message = "❌ I need more information:\n\n";
      if (!pickup) message += "• Pickup location missing\n";
      if (!dropoff) message += "• Drop-off location missing\n";
      if (!rideTimeISO) message += "• Ride time missing\n";
      message += "\n💡 Try this format:\n\"Pickup: Miami Airport | Drop: Downtown Miami | Time: today 7pm | Bid: $30\"";
      return bot.sendMessage(msg.chat.id, message, getErrorButtons());
    }

    // Get user data
    const userData = await performRiderCrud("findRiderByTelegramId", tgId);
    if (!userData?.user) {
      console.log("🐛 DEBUG: Failed to get user data");
      return bot.sendMessage(msg.chat.id, "❌ Unable to process request. Please try again.", getErrorButtons());
    }

    // Validate ride time is not in the past
    const rideTime = new Date(rideTimeISO);
    const now = new Date();
    const buffer = 2 * 60 * 1000; // 2 minutes buffer - reduced for stricter validation
    
    console.log("🐛 DEBUG: Time validation details:");
    console.log("  - rideTime (UTC):", rideTime.toISOString());
    console.log("  - rideTime (local):", rideTime.toLocaleString());
    console.log("  - current time (UTC):", now.toISOString());
    console.log("  - current time (local):", now.toLocaleString());
    console.log("  - difference (minutes):", (rideTime.getTime() - now.getTime()) / (60 * 1000));
    
    if (rideTime.getTime() < (now.getTime() - buffer)) {
      console.log("🐛 DEBUG: Ride time is in the past (with 5min buffer)");
      return bot.sendMessage(
        msg.chat.id, 
        `❌ **Invalid Ride Time**\n\n` +
        `The specified time appears to be in the past.\n\n` +
        `**You specified:** ${timeInterpretation || rideTime.toLocaleString()}\n` +
        `**Current time:** ${now.toLocaleString()}\n\n` +
        `**Please specify a future time:**\n• "today 11:30pm"\n• "tomorrow 9am"\n• "in 30 minutes"`,
        { parse_mode: "Markdown", ...getErrorButtons() }
      );
    }

    // Check if user already has an active ride
    try {
      await assertSingleOpen("rider", userData.user._id);
    } catch (error) {
      console.log("🐛 DEBUG: User has active ride:", error.message);
      return bot.sendMessage(msg.chat.id, `❌ ${error.message}`, getErrorButtons());
    }

    // Geocode addresses
    console.log("🐛 DEBUG: Starting geocoding");
    let gp, gd;
    const clearGeoTyping = await showTyping(bot, msg.chat.id);
    try {
      console.log("🐛 DEBUG: Geocoding pickup:", pickup);
      gp = await geocode.geocodeAddress(pickup);
      console.log("🐛 DEBUG: Pickup geocoded:", gp);
      
      console.log("🐛 DEBUG: Geocoding dropoff:", dropoff);
      gd = await geocode.geocodeAddress(dropoff);
      console.log("🐛 DEBUG: Dropoff geocoded:", gd);
    } catch (err) {
      console.error("🐛 DEBUG: Geocoding error:", err);
      clearGeoTyping();
      return bot.sendMessage(msg.chat.id, "❌ **Address Not Found**\n\nCould not locate one of the specified addresses. Please provide more specific addresses and try again.", { parse_mode: "Markdown", ...getErrorButtons() });
    }

    if (!gp || !gd) {
      console.log("🐛 DEBUG: Geocoding failed - gp:", gp, "gd:", gd);
      clearGeoTyping();
      return bot.sendMessage(msg.chat.id, "❌ **Address Lookup Failed**\n\nCould not locate the specified addresses. Please provide more detailed addresses and try again.", { parse_mode: "Markdown", ...getErrorButtons() });
    }

    console.log("🐛 DEBUG: Creating ride request");
    const rideData = {
      riderId: userData.user._id,
      pickupLocationName: gp.name,
      pickupLocation: { type: "Point", coordinates: [gp.lon, gp.lat] },
      dropLocationName: gd.name,
      dropLocation: { type: "Point", coordinates: [gd.lon, gd.lat] },
      bid: Number(bid) || 0,
      timeOfRide: rideTime,
      status: "open",
    };

    console.log("🐛 DEBUG: Ride data:", JSON.stringify(rideData, null, 2));

    const result = await performRiderCrud("createRideRequest", rideData);
    clearGeoTyping();

    if (!result?._id) {
      console.error("🐛 DEBUG: Ride creation failed:", result);
      return bot.sendMessage(msg.chat.id, "❌ Failed to create ride request. Please try again.", getErrorButtons());
    }

    console.log("🚗 Success: Ride request created");
    
    let confirmMessage = `✅ **Ride Request Created!**\n\n` +
      `📍 **Pickup:** ${gp.name}\n` +
      `🏁 **Drop-off:** ${gd.name}\n` +
      `💰 **Your Bid:** $${bid}\n` +
      `⏰ **Time:** ${timeInterpretation || rideTime.toLocaleString()}\n\n` +
      `🔍 Looking for nearby drivers...`;

    if (confidence === "low" && timeInterpretation) {
      confirmMessage = `⚠️ **Time confirmation:** ${timeInterpretation}\n\n` + confirmMessage;
    }

    await bot.sendMessage(msg.chat.id, confirmMessage, {
      parse_mode: "Markdown",
      ...getRideManagementButtons()
    });
    
    // Add response time info to confirmation
    await bot.sendMessage(msg.chat.id, "⏱️ *Response time: 3-45 seconds due to AI processing*", { parse_mode: "Markdown" });
    
    // Notify nearby drivers
    console.log("🐛 DEBUG: Attempting to notify nearby drivers");
    console.log("🐛 DEBUG: Ride object for notification:", JSON.stringify(result, null, 2));
    
    try {
      console.log("🐛 DEBUG: Checking if matching.findDriversForRide is a function");
      console.log("🐛 DEBUG: typeof matching.findDriversForRide:", typeof matching.findDriversForRide);
      
      if (typeof matching.findDriversForRide === "function") {
        console.log("🐛 DEBUG: Calling matching.findDriversForRide with ride:", result._id);
        // This function handles both finding drivers AND notifying them
        const drivers = await matching.findDriversForRide(result);
        console.log("🐛 DEBUG: Found and notified drivers:", drivers?.length || 0);
      } else {
        console.log("🐛 DEBUG: matching.findDriversForRide is not a function");
      }
    } catch (err) {
      console.error("🐛 DEBUG: Failed to notify drivers:", err);
      console.error("🐛 DEBUG: Error stack:", err.stack);
    }

  } catch (err) {
    console.error("🐛 DEBUG: Major error in handleRideRequestFromIntent:", err);
    await sendError(msg.chat.id, err, "Ride request failed.");
  }
}

// Handle different rider intents from OpenAI
async function handleRiderIntent(bot, msg, intent, found) {
  console.log("🐛 DEBUG: handleRiderIntent called with intent type:", intent?.type);
  
  switch (intent?.type) {
    case "rider_ride":
      console.log("🐛 DEBUG: Processing rider_ride intent via handleRiderIntent");
      // Call handleRideRequestFromIntent with the intent fields
      await handleRideRequestFromIntent(bot, msg, intent);
      return;

    case "delete_ride":
      // Check for active ride that can be cancelled (both open and matched)
      const rideResult = await db.getRidesByUser(found.user._id.toString(), "rider");
      console.log(`Cancel ride intent debug - rideResult:`, rideResult);
      
      const activeRides = rideResult?.success ? rideResult.data?.filter(ride => 
        ride.status === "open" || ride.status === "matched"
      ) : [];
      
      console.log(`Cancel ride intent debug - activeRides:`, activeRides);
      console.log(`Cancel ride intent debug - rider ID:`, found.user._id.toString());
      
      const activeRide = activeRides?.[0] || null;
      
      if (!activeRide) {
        return bot.sendMessage(msg.chat.id, "🔴 No active ride request to cancel.", getRideManagementButtons());
      }
      await performRiderCrud("deleteRideRequest", activeRide._id);
      return bot.sendMessage(
        msg.chat.id,
        "❌ **Ride Cancelled**\n\nYour ride request has been cancelled.",
        { parse_mode: "Markdown", ...getRiderMainMenu() }
      );

    case "view_my_rides":
      // Redirect to rides command handler
      await handleViewRides(bot, msg);
      return;

    case "rider_update":
      // Handle profile updates via natural language
      if (intent.fields) {
        await handleRiderUpdateFromIntent(bot, msg, intent);
      } else {
        // Enter update mode
        state.set(msg.from.id.toString(), { phase: "update_rider" });
        await bot.sendMessage(
          msg.chat.id,
          "📝 **Update Your Profile**\n\nWhat would you like to update? You can say things like:\n\n" +
          "• \"Update my phone to 555-1234\"\n" +
          "• \"Change my name to John Smith\"\n" +
          "• \"Set my home address to 123 Main St\"\n" +
          "• \"Update my work to Downtown Miami\"\n\n" +
          "Or use the format: `field: new value`",
          { parse_mode: "Markdown", ...getBackToMenuButtons() }
        );
      }
      return;

    case "help":
    default:
      const helpText = intent?.helpText || openai.getHelpText?.("rider") || 
        "🤖 **RideEase Assistant**\n\n" +
        "**Available Services:**\n" +
        "• Request rides by describing your destination\n" +
        "• Update your profile details\n" +
        "• View your ride history\n" +
        "• Use commands like /riderequest, /me, /rides\n\n" +
        "Please communicate naturally - the system will understand your requests.";
      
      await bot.sendMessage(
        msg.chat.id,
        helpText,
        { parse_mode: "Markdown", ...getRiderMainMenu() }
      );
      return;
  }
}

// Handle rider profile update
async function handleRiderUpdate(bot, msg, text) {
  const tgId = msg.from.id.toString();
  
  try {
    // Show typing indicator while processing
    const clearTyping = await showTyping(bot, msg.chat.id);
    
    // Check if it's pipe-delimited format
    if (text.includes(',')) {
      clearTyping();
      const parts = text.split(",").map(s => s.trim());
      if (parts.length >= 2) {
        const [name, phoneNumber, homeAddress = "", workAddress = ""] = parts;
        // Automatically get the telegram username from the message sender
        const telegramUsername = msg.from.username ? `@${msg.from.username}` : `@user_${tgId.slice(-8)}`;
        
        // Validate the update data
        const validationResult = validation.validateRiderRegistration({
          name,
          phoneNumber,
          telegramUsername,
          homeAddress: homeAddress || undefined,
          workAddress: workAddress || undefined
        });

        if (!validationResult.isValid) {
          return bot.sendMessage(
            msg.chat.id,
            `❌ Validation Error:\n${validationResult.errors.map(err => `• ${err}`).join('\n')}\n\nPlease fix these issues and try again.`
          );
        }
        
        const updates = { name, phoneNumber, telegramUsername };
        if (homeAddress && homeAddress.trim()) {
          updates.homeAddress = homeAddress.trim();
        }
        if (workAddress && workAddress.trim()) {
          updates.workAddress = workAddress.trim();
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
    const updateIntent = await openai.detectIntent(text, "rider");
    clearTyping2();
    
    if (updateIntent?.type === "rider_update" && updateIntent?.fields) {
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
        "❌ I didn't understand what you want to update.\n\n**Try these examples:**\n• \"Update my number to 555-0123\"\n• \"Change my name to John Smith\"\n• \"Change my home address to 123 Main St Miami\"\n• \"Update my work address to 456 Office Blvd\"\n\n**Or send all details:**\n`Name, Phone, Home Address, Work Address`\n\n*Your Telegram username will be automatically detected.*",
        { parse_mode: "Markdown" }
      );
    }
  } catch (err) {
    await sendError(msg.chat.id, err, "Update failed.");
    state.clear(tgId);
  }
}

function extractRiderFieldValue(text, fieldName) {
  const input = text.trim();
  
  // Extract value from natural language patterns
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
  
  else if (fieldName === "homeAddress") {
    // Match home addresses - prioritize patterns with context words
    const homePatterns = [
      /(?:my\s+)?(?:home|home\s+address)(?:\s+is\s+|\s+to\s+|\s*[:=]\s*)([a-zA-Z0-9\s\-,.#]+)/i,
      /home\s*[:=]\s*([a-zA-Z0-9\s\-,.#]+)/i,
      /^([a-zA-Z0-9\s\-,.#]+)$/
    ];
    for (const pattern of homePatterns) {
      const match = input.match(pattern);
      if (match) return match[1].trim();
    }
  }
  
  else if (fieldName === "workAddress") {
    // Match work addresses - prioritize patterns with context words
    const workPatterns = [
      /(?:my\s+)?(?:work|work\s+address|office)(?:\s+is\s+|\s+to\s+|\s*[:=]\s*)([a-zA-Z0-9\s\-,.#]+)/i,
      /(?:work|office)\s*[:=]\s*([a-zA-Z0-9\s\-,.#]+)/i,
      /^([a-zA-Z0-9\s\-,.#]+)$/
    ];
    for (const pattern of workPatterns) {
      const match = input.match(pattern);
      if (match) return match[1].trim();
    }
  }
  
  // Fallback: return the input as is
  return input;
}

async function handleRiderFieldUpdate(bot, msg, text, fieldName, fieldDisplayName) {
  const tgId = msg.from.id.toString();
  
  try {
    // Extract actual value from input (handles both raw values and natural language)
    let value = extractRiderFieldValue(text, fieldName);
    
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
    
    else if (fieldName === "homeAddress") {
      if (!value || value.length < 5 || value.length > 200) {
        return bot.sendMessage(
          msg.chat.id,
          "❌ **Invalid Home Address**\n\nPlease enter a valid home address:\n• Example: `123 Main St Miami FL`\n• Example: `456 Oak Ave, Tampa, FL 33602`"
        );
      }
    }
    
    else if (fieldName === "workAddress") {
      if (!value || value.length < 5 || value.length > 200) {
        return bot.sendMessage(
          msg.chat.id,
          "❌ **Invalid Work Address**\n\nPlease enter a valid work address:\n• Example: `789 Office Blvd Miami FL`\n• Example: `Downtown Business Plaza, Orlando FL`"
        );
      }
    }
    
    // Update the field
    const updates = {};
    updates[fieldName] = value;
    
    const result = await performRiderCrud("updateRider", {
      telegramId: tgId,
      updates: updates
    });
    
    if (result?.success) {
      state.clear(tgId);
      await bot.sendMessage(
        msg.chat.id,
        `✅ **${fieldDisplayName} Updated!**\n\nYour ${fieldDisplayName.toLowerCase()} has been updated to: ${value}`,
        { parse_mode: "Markdown", ...getRiderMainMenu() }
      );
    } else {
      await bot.sendMessage(msg.chat.id, `❌ Update failed: ${result?.error || "unknown error"}`);
    }
  } catch (err) {
    await sendError(msg.chat.id, err, "Field update failed.");
    state.clear(tgId);
  }
}

// Handle rider update from parsed intent
async function handleRiderUpdateFromIntent(bot, msg, intent) {
  // This would handle profile updates via natural language
  // For now, redirect to the regular update flow
  await bot.sendMessage(
    msg.chat.id,
    "🔧 **Update Feature**\n\nProfile updates via natural language are being developed. Please use the /update command for now.",
    { parse_mode: "Markdown", ...getRiderMainMenu() }
  );
}

// Handle view rides request
async function handleViewRides(bot, msg) {
  try {
    const tgId = msg.from.id.toString();
    const user = await performRiderCrud("findRiderByTelegramId", tgId);
    
    if (!user?.user) {
      return bot.sendMessage(msg.chat.id, "❌ User not found.", getRiderMainMenu());
    }

    const result = await performRiderCrud("getRidesByUser", user.user._id.toString(), "rider");
    
    if (!result?.success || !result.data || result.data.length === 0) {
      return bot.sendMessage(
        msg.chat.id,
        "📭 **No Rides Found**\n\nYou haven't requested any rides yet.\n\nReady to request your first ride?",
        { parse_mode: "Markdown", ...getRiderMainMenu() }
      );
    }

    const rides = result.data;
    const activeRides = rides.filter(ride => ["open", "matched", "started"].includes(ride.status));
    const pastRides = rides.filter(ride => ["completed", "cancelled"].includes(ride.status));

    let message = "🚗 **Your Rides**\n\n";
    
    if (activeRides.length > 0) {
      message += "**🟢 Active Rides:**\n";
      activeRides.forEach((ride, index) => {
        const status = ride.status === "open" ? "🔍 Looking for driver" : 
                     ride.status === "matched" ? "👤 Driver assigned" : "🚗 In progress";
        message += `${index + 1}. ${ride.pickupLocationName} → ${ride.dropLocationName}\n`;
        message += `   💰 $${ride.bid} | ${status}\n\n`;
      });
    }

    if (pastRides.length > 0) {
      message += "**📋 Recent Rides:**\n";
      pastRides.slice(-5).forEach((ride, index) => {
        const statusEmoji = ride.status === "completed" ? "✅" : "❌";
        message += `${statusEmoji} ${ride.pickupLocationName} → ${ride.dropLocationName} ($${ride.bid})\n`;
      });
    }

    await bot.sendMessage(msg.chat.id, message, { 
      parse_mode: "Markdown", 
      ...getRideManagementButtons() 
    });

  } catch (err) {
    console.error("Error viewing rides:", err);
    await bot.sendMessage(msg.chat.id, "❌ **Unable to Retrieve Rides**\n\nError occurred while loading your ride history. Please try again.", { parse_mode: "Markdown", ...getRiderMainMenu() });
  }
}

// Initialize rider bot
let riderBot;
let riderWired = false;

function initRiderBot() {
  if (riderBot) {
    console.log("🤖 DEBUG: Returning existing riderBot instance");
    return riderBot;
  }
  
  const token = process.env.TELEGRAM_BOT_TOKEN; // Using original token for riders
  if (!token) {
    console.error("🤖 ERROR: TELEGRAM_BOT_TOKEN not set");
    throw new Error("TELEGRAM_BOT_TOKEN not set");
  }

  console.log("🤖 DEBUG: Creating new riderBot instance with token:", token.substring(0, 10) + "...");
  const usePolling = !process.env.FUNCTIONS_EMULATOR && process.env.NODE_ENV !== "production";
  console.log("🤖 DEBUG: usePolling:", usePolling);
  
  riderBot = new TelegramBot(token, { polling: usePolling });

  console.log("🤖 DEBUG: RiderBot instance created successfully");

  // Set bot instance for notifications
  try {
    require("./utils/notifications").setRiderBotInstance(riderBot);
    console.log("🤖 DEBUG: Notifications bot instance set");
  } catch (err) {
    console.error("🤖 ERROR: Failed to set notifications bot instance:", err);
  }

  // Note: State timeout bot instances are set in index.js to avoid conflicts

  if (!riderWired) {
    console.log("🤖 DEBUG: Wiring up riderBot handlers...");
    setupRiderCommands(riderBot);
    setupRiderCallbacks(riderBot);
    setupRiderMessageHandlers(riderBot);
    riderWired = true;
    console.log("🤖 DEBUG: RiderBot handlers wired successfully");
  }

  return riderBot;
}

// Export for webhook
module.exports = {
  processUpdate: async (update) => {
    const bot = initRiderBot();
    return bot.processUpdate(update);
  },
  initRiderBot,
  ensureMongoConnection
};
