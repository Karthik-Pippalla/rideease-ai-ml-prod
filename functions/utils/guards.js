// utils/guards.js
// Guards and sanitizers for bot-triggered operations

const Ride = require("../models/ride");
const Driver = require("../models/driver");

// Fields that must not be user-editable via the bot
const RESTRICTED_FIELDS = new Set([
  "rating",
  "ratings",
  "pastRides",
  "createdAt",
  "updatedAt",
  "_id",
  "tokenBalance",
  "adminFlags",
  "systemFlags"
]);

const MONGO_OPERATORS = new Set([
  "$set", "$push", "$addToSet", "$inc", "$pull", 
  "$pullAll", "$pop", "$rename", "$unset", "$min", "$max"
]);

// Security event logging
const securityEvents = [];

function logSecurityEvent(event, context = {}) {
  const logEntry = {
    timestamp: new Date(),
    event,
    context,
    stack: new Error().stack.split('\n').slice(0, 3).join('\n') // Truncated stack
  };
  
  securityEvents.push(logEntry);
  
  // Keep only last 1000 events
  if (securityEvents.length > 1000) {
    securityEvents.splice(0, securityEvents.length - 1000);
  }
  
  console.warn('[SECURITY]', event, context);
}

// Enhanced field restriction with pattern matching
function isRestrictedField(fieldName, fullPath) {
  // Direct match
  if (RESTRICTED_FIELDS.has(fieldName)) return true;
  
  // Pattern matching for dynamic fields
  const restrictedPatterns = [
    /^rating/i,           // Any field starting with "rating"
    /.*\.rating$/i,       // Any nested rating field
    /^admin/i,            // Admin-related fields
    /^system/i,           // System fields
    /.*Token.*$/i,        // Token-related fields
    /.*[Bb]alance.*$/i    // Balance-related fields
  ];
  
  return restrictedPatterns.some(pattern => 
    pattern.test(fieldName) || pattern.test(fullPath)
  );
}

function deepStripRestricted(obj, path = '') {
  if (!obj || typeof obj !== "object") return obj;
  
  // Preserve MongoDB ObjectIds and Dates - multiple detection methods
  if (obj instanceof Date) return obj;
  if (obj.constructor?.name === 'ObjectId') return obj;
  if (obj._bsontype === 'ObjectId') return obj;
  if (typeof obj.toString === 'function' && /^[0-9a-fA-F]{24}$/.test(obj.toString())) return obj;
  
  if (Array.isArray(obj)) return obj.map((item, index) => 
    deepStripRestricted(item, `${path}[${index}]`)
  );
  
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const currentPath = path ? `${path}.${k}` : k;
    
    // Enhanced restriction checking with path awareness
    if (isRestrictedField(k, currentPath)) {
      console.warn(`Blocked restricted field: ${currentPath}`);
      continue;
    }
    
    // MongoDB operators with path context
    if (MONGO_OPERATORS.has(k)) {
      out[k] = deepStripRestricted(v, currentPath);
      continue;
    }
    
    out[k] = deepStripRestricted(v, currentPath);
  }
  return out;
}

function sanitizeCrudPayload(action, payload) {
  // Allow system flows to log past rides explicitly if action name matches
  if (action === "logPastRide") return payload;
  
  // Skip sanitization for createRideRequest to preserve ObjectIds and Dates
  if (action === "createRideRequest") return payload;
  
  return deepStripRestricted(payload);
}

async function assertSingleOpen(role, userId, context = {}) {
  try {
    if (role === "rider") {
      const activeRides = await Ride.find({ 
        riderId: userId, 
        status: { $in: ["open", "matched", "in_progress"] } 
      }).lean();
      
      if (activeRides.length > 0) {
        logSecurityEvent('MULTIPLE_RIDES_BLOCKED', {
          userId,
          role,
          activeRideCount: activeRides.length,
          rideIds: activeRides.map(r => r._id)
        });
        
        throw new Error(`You have ${activeRides.length} active ride(s). Complete them first.`);
      }
      
      return true;
    }
    
    if (role === "driver") {
      const driver = await Driver.findById(userId).lean();
      
      if (!driver) {
        throw new Error("Driver not found");
      }
      
      if (driver.availability) {
        logSecurityEvent('DOUBLE_AVAILABILITY_BLOCKED', {
          userId,
          role,
          currentAvailability: driver.availability
        });
        
        throw new Error("You're already available. Turn it off first.");
      }
      
      // Check for active rides as driver
      const activeDriverRides = await Ride.find({
        driverId: userId,
        status: { $in: ["matched", "in_progress"] }
      }).lean();
      
      if (activeDriverRides.length > 0) {
        throw new Error("Complete your current rides before becoming available.");
      }
      
      return true;
    }
    
    throw new Error(`Invalid role: ${role}`);
    
  } catch (error) {
    logSecurityEvent('BUSINESS_RULE_VIOLATION', {
      userId,
      role,
      error: error.message,
      context
    });
    throw error;
  }
}

// New: Rate limiting for sensitive operations
const rateLimits = new Map();

function checkRateLimit(userId, action, limit = 10, windowMs = 60000) {
  const key = `${userId}:${action}`;
  const now = Date.now();
  
  if (!rateLimits.has(key)) {
    rateLimits.set(key, []);
  }
  
  const attempts = rateLimits.get(key);
  const recentAttempts = attempts.filter(time => now - time < windowMs);
  
  if (recentAttempts.length >= limit) {
    logSecurityEvent('RATE_LIMIT_EXCEEDED', {
      userId,
      action,
      attempts: recentAttempts.length,
      limit,
      windowMs
    });
    
    throw new Error(`Too many ${action} attempts. Try again later.`);
  }
  
  recentAttempts.push(now);
  rateLimits.set(key, recentAttempts);
  
  return true;
}

// Enhanced payload sanitization with logging
function sanitizeCrudPayloadWithLogging(action, payload, userId = null) {
  // System actions whitelist
  const SYSTEM_ACTIONS = new Set([
    "logPastRide", 
    "createRideRequest", 
    "systemUpdate",
    "adminOperation"
  ]);
  
  if (SYSTEM_ACTIONS.has(action)) {
    logSecurityEvent('SYSTEM_ACTION_ALLOWED', { action, userId });
    return payload;
  }
  
  // Count restricted fields before sanitization
  const originalSize = JSON.stringify(payload).length;
  const sanitized = deepStripRestricted(payload);
  const sanitizedSize = JSON.stringify(sanitized).length;
  
  if (originalSize !== sanitizedSize) {
    logSecurityEvent('PAYLOAD_SANITIZED', {
      action,
      userId,
      originalSize,
      sanitizedSize,
      reduction: originalSize - sanitizedSize
    });
  }
  
  return sanitized;
}

module.exports = { 
  sanitizeCrudPayload, 
  sanitizeCrudPayloadWithLogging,
  assertSingleOpen,
  checkRateLimit,
  logSecurityEvent,
  getSecurityEvents: () => [...securityEvents]
};
