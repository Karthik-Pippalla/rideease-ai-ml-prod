// functions/utils/validation.js
const E164 = /^\+?[1-9]\d{6,14}$/;         // lenient E.164-ish
const DIGITS = /\d/g;

// Debug logging
const DEBUG = process.env.DEBUG === "true" || process.env.NODE_ENV === "development";
const debug = (message, data = null) => {
  if (DEBUG) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ✅ VALIDATION DEBUG: ${message}`);
    if (data) console.log(`[${timestamp}] ✅ VALIDATION DEBUG DATA:`, JSON.stringify(data, null, 2));
  }
};

// ==================== INPUT VALIDATION ====================

function looksLikePhone(s="") {
  const digits = (s.match(DIGITS) || []).join("");
  return digits.length >= 7 && digits.length <= 15;
}

function normalizePhone(s="") {
  const digits = (s.match(DIGITS) || []).join("");
  if (!digits) return null;
  // if US-like and length 10, prepend +1
  if (digits.length === 10) return `+1${digits}`;
  if (digits.startsWith("1") && digits.length === 11) return `+${digits}`;
  if (digits.startsWith("+")) return digits;
  return `+${digits}`;
}

function looksLikeAddress(s="") {
  return s.length > 5 && s.includes(" ") && /[a-zA-Z]/.test(s);
}

function looksLikeMoney(s="") {
  const num = Number(s.replace(/[$,]/g, ""));
  return !isNaN(num) && num > 0 && num <= 1000;
}

function looksLikeMiles(s="") {
  const num = Number(s);
  return !isNaN(num) && num > 0 && num <= 100;
}

// ==================== COMPREHENSIVE VALIDATION ====================

function validateRideRequest({ telegramId, pickupText, destinationText, bid, rideTime }) {
  const errs = [];
  
  if (!telegramId) errs.push("User ID is required");
  if (!pickupText) errs.push("Pickup location is required");
  if (!destinationText) errs.push("Destination is required");
  if (!bid) errs.push("Bid amount is required");
  
  // Validate pickup and destination
  if (pickupText && !looksLikeAddress(pickupText)) {
    errs.push("Pickup location must be a valid address");
  }
  if (destinationText && !looksLikeAddress(destinationText)) {
    errs.push("Destination must be a valid address");
  }
  
  // Validate bid amount
  const amount = Number(bid);
  if (!(amount > 0)) {
    errs.push("Bid must be a positive number");
  } else if (amount < 5) {
    errs.push("Bid must be at least $5");
  } else if (amount > 500) {
    errs.push("Bid cannot exceed $500");
  }
  
  // Validate ride time
  if (rideTime) {
    const requestedTime = new Date(rideTime);
    const now = new Date();
    const minTime = new Date(now.getTime() + 30 * 60 * 1000); // 30 minutes from now
    
    if (requestedTime <= now) {
      errs.push("Ride time must be in the future");
    } else if (requestedTime < minTime) {
      errs.push("Ride time must be at least 30 minutes in the future");
    }
  }
  
  return errs;
}

function validateDriverAvailability({ telegramId, locationText, radiusMiles, durationHours }) {
  const errs = [];
  
  if (!telegramId) errs.push("User ID is required");
  if (!locationText) errs.push("Location is required");
  
  // Validate location
  if (locationText && !looksLikeAddress(locationText)) {
    errs.push("Location must be a valid address");
  }
  
  // Validate radius
  const radius = Number(radiusMiles);
  if (!(radius > 0)) {
    errs.push("Radius must be a positive number");
  } else if (radius < 1) {
    errs.push("Radius must be at least 1 mile");
  } else if (radius > 50) {
    errs.push("Radius cannot exceed 50 miles");
  }
  
  // Validate duration
  const duration = Number(durationHours);
  if (!(duration > 0)) {
    errs.push("Duration must be a positive number");
  } else if (duration < 1) {
    errs.push("Duration must be at least 1 hour");
  } else if (duration > 24) {
    errs.push("Duration cannot exceed 24 hours");
  }
  
  return errs;
}

function validateUserRegistration({ name, phone, car }) {
  const errs = [];
  
  // Validate name
  if (!name) {
    errs.push("Name is required");
  } else if (name.length < 2) {
    errs.push("Name must be at least 2 characters");
  } else if (name.length > 50) {
    errs.push("Name cannot exceed 50 characters");
  } else if (!/^[a-zA-Z\s]+$/.test(name)) {
    errs.push("Name can only contain letters and spaces");
  }
  
  // Validate phone
  if (!phone) {
    errs.push("Phone number is required");
  } else if (!looksLikePhone(phone)) {
    errs.push("Phone number must be valid");
  }
  
  // Validate car (for drivers only)
  if (car) {
    if (car.length < 3) {
      errs.push("Car details must be at least 3 characters");
    } else if (car.length > 100) {
      errs.push("Car details cannot exceed 100 characters");
    }
  }
  
  return errs;
}

function validateRideAcceptance({ driverId, rideRequestId }) {
  const errs = [];
  
  if (!driverId) errs.push("Driver ID is required");
  if (!rideRequestId) errs.push("Ride request ID is required");
  
  // Validate ride request ID format
  if (rideRequestId && !/^[0-9a-fA-F]{24}$/.test(rideRequestId)) {
    errs.push("Invalid ride request ID format");
  }
  
  return errs;
}

function validateRideCompletion({ rideId, driverId }) {
  const errs = [];
  
  if (!rideId) errs.push("Ride ID is required");
  if (!driverId) errs.push("Driver ID is required");
  
  // Validate ride ID format
  if (rideId && !/^[0-9a-fA-F]{24}$/.test(rideId)) {
    errs.push("Invalid ride ID format");
  }
  
  return errs;
}

// ==================== INPUT SANITIZATION ====================

function sanitizeInput(s="") {
  if (typeof s !== 'string') return '';
  
  // Remove HTML tags and potentially dangerous characters
  return s
    .replace(/[<>]/g, "")
    .replace(/[&]/g, "&amp;")
    .replace(/["]/g, "&quot;")
    .replace(/[']/g, "&#x27;")
    .trim();
}

function sanitizePhone(s="") {
  const digits = (s.match(DIGITS) || []).join("");
  return normalizePhone(digits);
}

function sanitizeName(s="") {
  return s
    .replace(/[^a-zA-Z\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeAddress(s="") {
  return s
    .replace(/[<>]/g, "")
    .replace(/[&]/g, "&amp;")
    .trim();
}

function sanitizeBid(s="") {
  const num = Number(s.replace(/[$,]/g, ""));
  return isNaN(num) ? 0 : Math.max(0, Math.min(1000, num));
}

// ==================== BUSINESS LOGIC VALIDATION ====================

function validateDuplicateRequest(riderId, existingRequests) {
  if (existingRequests && existingRequests.length > 0) {
    return "You already have an active ride request. Please cancel it first or wait for a match.";
  }
  return null;
}

function validateDriverAvailability(driverId, existingAvailability) {
  if (existingAvailability && existingAvailability.length > 0) {
    return "You're already available. Please cancel your current availability first.";
  }
  return null;
}

function validateRideTime(rideTime) {
  const now = new Date();
  const requestedTime = new Date(rideTime);
  const minTime = new Date(now.getTime() + 30 * 60 * 1000); // 30 minutes from now
  
  if (requestedTime <= now) {
    return "Ride time must be in the future";
  }
  
  if (requestedTime < minTime) {
    return "Ride time must be at least 30 minutes in the future";
  }
  
  return null;
}

function validateBidAmount(bid) {
  const amount = Number(bid);
  
  if (!(amount > 0)) {
    return "Bid must be a positive number";
  }
  
  if (amount < 5) {
    return "Bid must be at least $5";
  }
  
  if (amount > 500) {
    return "Bid cannot exceed $500";
  }
  
  return null;
}

function validateRadius(radius) {
  const r = Number(radius);
  
  if (!(r > 0)) {
    return "Radius must be a positive number";
  }
  
  if (r < 1) {
    return "Radius must be at least 1 mile";
  }
  
  if (r > 50) {
    return "Radius cannot exceed 50 miles";
  }
  
  return null;
}

function validateDuration(duration) {
  const d = Number(duration);
  
  if (!(d > 0)) {
    return "Duration must be a positive number";
  }
  
  if (d < 1) {
    return "Duration must be at least 1 hour";
  }
  
  if (d > 24) {
    return "Duration cannot exceed 24 hours";
  }
  
  return null;
}

// ==================== RATE LIMITING ====================

const rateLimitMap = new Map();

function checkRateLimit(telegramId, action, limit = 5, windowMs = 60000) {
  const key = `${telegramId}:${action}`;
  const now = Date.now();
  const windowStart = now - windowMs;
  
  if (!rateLimitMap.has(key)) {
    rateLimitMap.set(key, []);
  }
  
  const timestamps = rateLimitMap.get(key);
  
  // Remove old timestamps
  while (timestamps.length > 0 && timestamps[0] < windowStart) {
    timestamps.shift();
  }
  
  // Check if limit exceeded
  if (timestamps.length >= limit) {
    return false;
  }
  
  // Add current timestamp
  timestamps.push(now);
  return true;
}

function getRateLimitRemaining(telegramId, action) {
  const key = `${telegramId}:${action}`;
  const timestamps = rateLimitMap.get(key) || [];
  return Math.max(0, 5 - timestamps.length);
}

// ==================== STATE VALIDATION ====================

function validateUserState(telegramId, requiredState) {
  // This would check if user is in the correct state for the action
  return true; // Placeholder
}

function validateRideState(rideId, requiredState) {
  // This would check if ride is in the correct state for the action
  return true; // Placeholder
}

module.exports = {
  looksLikePhone,
  normalizePhone,
  looksLikeAddress,
  looksLikeMoney,
  looksLikeMiles,
  validateRideRequest,
  validateDriverAvailability,
  validateUserRegistration,
  validateRideAcceptance,
  validateRideCompletion,
  sanitizeInput,
  sanitizePhone,
  sanitizeName,
  sanitizeAddress,
  sanitizeBid,
  validateDuplicateRequest,
  validateDriverAvailability: validateDriverAvailability,
  validateRideTime,
  validateBidAmount,
  validateRadius,
  validateDuration,
  checkRateLimit,
  getRateLimitRemaining,
  validateUserState,
  validateRideState
};
