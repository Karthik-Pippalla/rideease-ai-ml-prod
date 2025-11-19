// utils/state.js
// Enhanced in-memory per-user state with TTL and cleanup
// Note: Ephemeral. For production durability, store in DB or Redis.

const map = new Map();
const timestamps = new Map(); // Track last access time
const notificationSent = new Map(); // Track if timeout notification was sent
const TTL_MS = 30 * 60 * 1000; // 30 minutes

// Bot instances for sending timeout notifications
let driverBot = null;
let riderBot = null;

// Function to set bot instances for timeout notifications
function setBotInstances(driverBotInstance, riderBotInstance) {
  // Only update bot instances if they are provided (not null/undefined)
  if (driverBotInstance !== null && driverBotInstance !== undefined) {
    driverBot = driverBotInstance;
    console.log("✅ Driver bot instance updated for state notifications");
  }
  if (riderBotInstance !== null && riderBotInstance !== undefined) {
    riderBot = riderBotInstance;
    console.log("✅ Rider bot instance updated for state notifications");
  }
  
  console.log(`[STATE] Current bot instances after setup: driver=${driverBot ? 'available' : 'null'}, rider=${riderBot ? 'available' : 'null'}`);
}

// Function to get bot instances status for debugging
function getBotInstancesStatus() {
  return {
    driverBot: driverBot ? 'available' : 'null',
    riderBot: riderBot ? 'available' : 'null'
  };
}

function key(tgId) {
  return String(tgId);
}

function get(tgId) {
  const k = key(tgId);
  const value = map.get(k);
  
  if (value) {
    // Update last access time
    timestamps.set(k, Date.now());
    // Reset notification flag when user is active
    notificationSent.delete(k);
    return value;
  }
  
  return null;
}

function set(tgId, value) {
  const k = key(tgId);
  
  // Add metadata to state
  if (value && typeof value === 'object') {
    value.lastUpdated = Date.now();
    value.sessionId = k;
  }
  
  map.set(k, value);
  timestamps.set(k, Date.now());
  
  // Reset notification flag when user is active
  notificationSent.delete(k);
  
  // Trigger cleanup if map is getting large
  if (map.size > 1000) {
    cleanup();
  }
}

function clear(tgId) {
  const k = key(tgId);
  map.delete(k);
  timestamps.delete(k);
  notificationSent.delete(k);
}

function clearAll() {
  map.clear();
  timestamps.clear();
  notificationSent.clear();
}

// New: Automatic cleanup of stale sessions with user notification
async function cleanup() {
  const now = Date.now();
  const staleKeys = [];
  const aboutToExpireKeys = [];
  
  for (const [k, timestamp] of timestamps.entries()) {
    const age = now - timestamp;
    
    // Check if session has expired (30 minutes)
    if (age > TTL_MS) {
      staleKeys.push(k);
    }
    // Check if session is about to expire (25 minutes - give 5 minute warning)
    else if (age > (TTL_MS - 5 * 60 * 1000) && !notificationSent.get(k)) {
      aboutToExpireKeys.push(k);
    }
  }
  
  // Send timeout notifications for sessions about to expire
  for (const k of aboutToExpireKeys) {
    await sendTimeoutWarning(k);
    notificationSent.set(k, true);
  }
  
  // Send session closed notifications and clean up expired sessions
  for (const k of staleKeys) {
    const userState = map.get(k);
    console.log(`[STATE] Processing expired session for user ${k}, state:`, userState);
    await sendSessionClosedNotification(k);
    map.delete(k);
    timestamps.delete(k);
    notificationSent.delete(k);
  }
  
  if (staleKeys.length > 0 || aboutToExpireKeys.length > 0) {
    console.log(`[STATE] Cleaned up ${staleKeys.length} expired sessions, warned ${aboutToExpireKeys.length} about to expire`);
    console.log(`[STATE] Bot instances status:`, getBotInstancesStatus());
  }
  
  return staleKeys.length;
}

// Send warning notification 5 minutes before session expires
async function sendTimeoutWarning(userId) {
  try {
    console.log(`[STATE] Attempting to send timeout warning to user ${userId}`);
    console.log(`[STATE] Bot instances status:`, getBotInstancesStatus());
    
    const userState = map.get(userId);
    if (!userState || !userState.phase) {
      console.log(`[STATE] No user state or phase found for ${userId}:`, userState);
      return;
    }
    
    const message = "⏰ **Session Timeout Warning**\n\n" +
      "Your current session will expire in 5 minutes due to inactivity.\n\n" +
      "Send any command or press any button to keep your session active.\n\n" +
      "⏱️ *Session automatically closes after 30 minutes of inactivity*";
    
    // Try to determine if this is a driver or rider session and send via appropriate bot
    const isDriverSession = userState.phase?.includes('driver') || 
                           userState.phase === 'set_availability' || 
                           userState.phase === 'update_driver';
    
    console.log(`[STATE] User ${userId} session type: ${isDriverSession ? 'DRIVER' : 'RIDER'} (phase: ${userState.phase})`);
    
    let warningMessageSent = false;
    const userIdNum = parseInt(userId);
    
    if (isDriverSession && driverBot) {
      try {
        await driverBot.sendMessage(userIdNum, message, { parse_mode: "Markdown" });
        warningMessageSent = true;
        console.log(`[STATE] Timeout warning sent to driver ${userId}`);
      } catch (error) {
        console.error(`[STATE] Failed to send timeout warning via driver bot to ${userId}:`, error.message);
      }
    } else if (!isDriverSession && riderBot) {
      try {
        await riderBot.sendMessage(userIdNum, message, { parse_mode: "Markdown" });
        warningMessageSent = true;
        console.log(`[STATE] Timeout warning sent to rider ${userId}`);
      } catch (error) {
        console.error(`[STATE] Failed to send timeout warning via rider bot to ${userId}:`, error.message);
      }
    }
    
    // Fallback: try both bots if the primary one failed or user type couldn't be determined
    if (!warningMessageSent) {
      if (driverBot) {
        try {
          await driverBot.sendMessage(userIdNum, message, { parse_mode: "Markdown" });
          warningMessageSent = true;
          console.log(`[STATE] Timeout warning sent via driver bot fallback to ${userId}`);
        } catch (fallbackError) {
          console.warn(`[STATE] Driver bot fallback failed for ${userId}:`, fallbackError.message);
        }
      }
      
      if (!warningMessageSent && riderBot) {
        try {
          await riderBot.sendMessage(userIdNum, message, { parse_mode: "Markdown" });
          warningMessageSent = true;
          console.log(`[STATE] Timeout warning sent via rider bot fallback to ${userId}`);
        } catch (fallbackError) {
          console.warn(`[STATE] Rider bot fallback failed for ${userId}:`, fallbackError.message);
        }
      }
    }
    
    if (!warningMessageSent) {
      console.error(`[STATE] Could not send timeout warning to ${userId}: No bot instances available`);
    } else {
      console.log(`[STATE] Timeout warning sent to user ${userId}`);
    }
    
  } catch (error) {
    console.error(`[STATE] Failed to send timeout warning to ${userId}:`, error.message);
  }
}

// Send session closed notification when session expires
async function sendSessionClosedNotification(userId) {
  try {
    console.log(`[STATE] Attempting to send session closed notification to user ${userId}`);
    console.log(`[STATE] Bot instances status:`, getBotInstancesStatus());
    
    const userState = map.get(userId);
    
    const message = "🔒 **Session Closed**\n\n" +
      "Your session was closed due to 30 minutes of inactivity.\n\n" +
      "Use /start to begin a new session.\n\n" +
      "⏱️ *Response time: 3-45 seconds due to AI processing*";
    
    // Try to determine if this is a driver or rider session and send via appropriate bot
    const isDriverSession = userState?.phase?.includes('driver') || 
                           userState?.phase === 'set_availability' || 
                           userState?.phase === 'update_driver';
    
    console.log(`[STATE] User ${userId} session type: ${isDriverSession ? 'DRIVER' : 'RIDER'} (phase: ${userState?.phase || 'undefined'})`);
    
    let closedMessageSent = false;
    const userIdNum = parseInt(userId);
    
    if (isDriverSession && driverBot) {
      try {
        await driverBot.sendMessage(userIdNum, message, { parse_mode: "Markdown" });
        closedMessageSent = true;
        console.log(`[STATE] Session closed notification sent to driver ${userId}`);
      } catch (error) {
        console.error(`[STATE] Failed to send session closed notification via driver bot to ${userId}:`, error.message);
      }
    } else if (!isDriverSession && riderBot) {
      try {
        await riderBot.sendMessage(userIdNum, message, { parse_mode: "Markdown" });
        closedMessageSent = true;
        console.log(`[STATE] Session closed notification sent to rider ${userId}`);
      } catch (error) {
        console.error(`[STATE] Failed to send session closed notification via rider bot to ${userId}:`, error.message);
      }
    }
    
    // Fallback: try both bots if the primary one failed or user type couldn't be determined
    if (!closedMessageSent) {
      if (driverBot) {
        try {
          await driverBot.sendMessage(userIdNum, message, { parse_mode: "Markdown" });
          closedMessageSent = true;
          console.log(`[STATE] Session closed notification sent via driver bot fallback to ${userId}`);
        } catch (fallbackError) {
          console.warn(`[STATE] Driver bot fallback failed for ${userId}:`, fallbackError.message);
        }
      }
      
      if (!closedMessageSent && riderBot) {
        try {
          await riderBot.sendMessage(userIdNum, message, { parse_mode: "Markdown" });
          closedMessageSent = true;
          console.log(`[STATE] Session closed notification sent via rider bot fallback to ${userId}`);
        } catch (fallbackError) {
          console.warn(`[STATE] Rider bot fallback failed for ${userId}:`, fallbackError.message);
        }
      }
    }
    
    if (!closedMessageSent) {
      console.error(`[STATE] Could not send session closed notification to ${userId}: No bot instances available`);
    } else {
      console.log(`[STATE] Session closed notification sent to user ${userId}`);
    }
    
  } catch (error) {
    console.error(`[STATE] Failed to send session closed notification to ${userId}:`, error.message);
  }
}

// Check if a specific user's session is about to expire and send warning if needed
async function checkUserTimeout(userId) {
  const k = key(userId);
  const timestamp = timestamps.get(k);
  
  if (!timestamp) return false; // No session
  
  const now = Date.now();
  const age = now - timestamp;
  
  // Check if session is about to expire (25 minutes) and warning hasn't been sent
  if (age > (TTL_MS - 5 * 60 * 1000) && age < TTL_MS && !notificationSent.get(k)) {
    await sendTimeoutWarning(k);
    notificationSent.set(k, true);
    return true;
  }
  
  return false;
}

// Force cleanup and notification check (can be called manually)
async function forceCleanupCheck() {
  return await cleanup();
}

// New: Get state with metadata
function getWithMetadata(tgId) {
  const state = get(tgId);
  if (!state) return null;
  
  const k = key(tgId);
  return {
    state,
    lastAccessed: timestamps.get(k),
    age: Date.now() - (timestamps.get(k) || 0)
  };
}

// New: Validate state transitions
function validateStateTransition(currentState, newState, userId) {
  const validTransitions = {
    'registration_start': ['collecting_name', 'cancelled'],
    'collecting_name': ['collecting_phone', 'cancelled'],
    'collecting_phone': ['registration_complete', 'cancelled'],
    'menu_main': ['ride_request', 'driver_mode', 'settings'],
    'ride_request': ['collecting_pickup', 'menu_main'],
    'collecting_pickup': ['collecting_destination', 'cancelled'],
    'collecting_destination': ['ride_created', 'cancelled']
  };
  
  if (currentState && newState && currentState.step && newState.step) {
    const allowed = validTransitions[currentState.step];
    if (allowed && !allowed.includes(newState.step)) {
      console.warn(`[STATE] Invalid transition for user ${userId}: ${currentState.step} -> ${newState.step}`);
      throw new Error(`Invalid state transition: ${currentState.step} -> ${newState.step}`);
    }
  }
}

function getSize() {
  return map.size;
}

function getAllKeys() {
  return Array.from(map.keys());
}

// Start periodic cleanup
setInterval(cleanup, 5 * 60 * 1000); // Every 5 minutes

// Test function to verify bot instances are working
async function testNotifications(userId, testType = 'both') {
  try {
    console.log(`[STATE] Testing notifications for user ${userId}, type: ${testType}`);
    console.log(`[STATE] Bot instances status:`, getBotInstancesStatus());
    
    const testMessage = "🧪 **Test Notification**\n\nThis is a test message to verify bot functionality.";
    
    let results = {
      driverBot: null,
      riderBot: null
    };
    
    if ((testType === 'both' || testType === 'driver') && driverBot) {
      try {
        await driverBot.sendMessage(userId, testMessage, { parse_mode: "Markdown" });
        results.driverBot = 'SUCCESS';
        console.log(`[STATE] Driver bot test message sent to ${userId}`);
      } catch (error) {
        results.driverBot = `FAILED: ${error.message}`;
        console.error(`[STATE] Driver bot test failed for ${userId}:`, error.message);
      }
    }
    
    if ((testType === 'both' || testType === 'rider') && riderBot) {
      try {
        await riderBot.sendMessage(userId, testMessage, { parse_mode: "Markdown" });
        results.riderBot = 'SUCCESS';
        console.log(`[STATE] Rider bot test message sent to ${userId}`);
      } catch (error) {
        results.riderBot = `FAILED: ${error.message}`;
        console.error(`[STATE] Rider bot test failed for ${userId}:`, error.message);
      }
    }
    
    return results;
  } catch (error) {
    console.error(`[STATE] Test notification failed for ${userId}:`, error.message);
    return { error: error.message };
  }
}

// Manual function to test sending notifications to a specific user
// Can be called from logs or debugging console
function debugSendTestNotification(userId, botType = 'auto') {
  console.log(`[STATE DEBUG] Manual test notification request for user ${userId}, bot type: ${botType}`);
  
  return testNotifications(userId, botType)
    .then(results => {
      console.log(`[STATE DEBUG] Test notification results:`, results);
      return results;
    })
    .catch(error => {
      console.error(`[STATE DEBUG] Test notification error:`, error);
      return { error: error.message };
    });
}

// Function to manually trigger session closed notification for testing
function debugSendSessionClosedNotification(userId) {
  console.log(`[STATE DEBUG] Manual session closed notification for user ${userId}`);
  return sendSessionClosedNotification(userId);
}

// Function to manually trigger timeout warning for testing
function debugSendTimeoutWarning(userId) {
  console.log(`[STATE DEBUG] Manual timeout warning for user ${userId}`);
  return sendTimeoutWarning(userId);
}

// Force check and manually test notifications for a specific user
async function debugForceCheckAndNotify(userId, testType = 'warning') {
  console.log(`[STATE DEBUG] Force checking user ${userId} for ${testType}`);
  
  const k = key(userId);
  const timestamp = timestamps.get(k);
  const userState = map.get(k);
  
  console.log(`[STATE DEBUG] User ${userId} state:`, {
    hasState: !!userState,
    phase: userState?.phase,
    timestamp: timestamp ? new Date(timestamp).toISOString() : 'none',
    age: timestamp ? Date.now() - timestamp : 'none',
    notificationSent: notificationSent.get(k) || false
  });

  if (testType === 'warning') {
    await sendTimeoutWarning(k);
  } else if (testType === 'closed') {
    await sendSessionClosedNotification(k);
  }
}

module.exports = { 
  get, 
  set, 
  clear, 
  clearAll, 
  getSize, 
  getAllKeys,
  cleanup,
  getWithMetadata,
  validateStateTransition,
  setBotInstances,
  getBotInstancesStatus,
  checkUserTimeout,
  forceCleanupCheck,
  testNotifications,
  debugSendTestNotification,
  debugSendSessionClosedNotification,
  debugSendTimeoutWarning,
  debugForceCheckAndNotify
};
