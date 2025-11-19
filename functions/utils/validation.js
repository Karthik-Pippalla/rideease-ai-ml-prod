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

// ==================== SECURITY VALIDATION ====================

function validateTelegramId(id) {
  if (!id) {
    throw new Error('Telegram ID is required');
  }
  
  if (typeof id !== 'number' && typeof id !== 'string') {
    throw new Error('Invalid Telegram ID type');
  }
  
  const numId = Number(id);
  if (isNaN(numId) || numId <= 0 || numId > Number.MAX_SAFE_INTEGER) {
    throw new Error('Invalid Telegram ID format');
  }
  
  return true;
}

function validateCoordinates(coords) {
  if (!coords) {
    throw new Error('Coordinates are required');
  }
  
  if (typeof coords !== 'object' || !coords.coordinates || !Array.isArray(coords.coordinates)) {
    throw new Error('Invalid coordinates format');
  }
  
  if (coords.coordinates.length !== 2) {
    throw new Error('Coordinates must have exactly 2 values [longitude, latitude]');
  }
  
  const [lng, lat] = coords.coordinates;
  
  if (typeof lng !== 'number' || typeof lat !== 'number') {
    throw new Error('Coordinates must be numbers');
  }
  
  if (lat < -90 || lat > 90) {
    throw new Error('Latitude must be between -90 and 90');
  }
  
  if (lng < -180 || lng > 180) {
    throw new Error('Longitude must be between -180 and 180');
  }
  
  return true;
}

function sanitizeInput(input, maxLength = 1000) {
  if (typeof input !== 'string') {
    return String(input);
  }
  
  // Remove potential XSS
  let sanitized = input
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+\s*=/gi, '');
  
  // Limit length
  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength);
  }
  
  return sanitized.trim();
}

function validateObjectId(id) {
  if (!id) {
    throw new Error('ObjectId is required');
  }
  
  const objectIdPattern = /^[0-9a-fA-F]{24}$/;
  const idString = String(id);
  
  if (!objectIdPattern.test(idString)) {
    throw new Error('Invalid ObjectId format');
  }
  
  return true;
}

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
    
    if (requestedTime <= now) {
      errs.push("Ride time must be in the future");
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
    errs.push("Pickup distance must be a positive number");
  } else if (radius < 1) {
    errs.push("Pickup distance must be at least 1 mile");
  } else if (radius > 50) {
    errs.push("Pickup distance cannot exceed 50 miles");
  }
  
  // Validate duration
  const duration = Number(durationHours);
  if (!(duration > 0)) {
    errs.push("Duration must be a positive number");
  } else if (duration < 1) {
    if (duration >= 0.5) {
      errs.push("Duration must be at least 1 hour. Did you mean 1 hour instead of minutes?");
    } else {
      errs.push("Duration must be at least 1 hour. Please use hours instead of minutes (e.g., '2 hours')");
    }
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
  
  if (requestedTime <= now) {
    return "Ride time must be in the future";
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

// Driver registration validation
function validateDriverRegistration({ name, phoneNumber, telegramUsername, licensePlateNumber, vehicleColour }) {
  const errs = [];
  
  debug("Validating driver registration", { name, phoneNumber, telegramUsername, licensePlateNumber, vehicleColour });
  
  // Validate name
  if (!name || name.trim() === "") {
    errs.push("Name is required");
  } else if (name.length < 2) {
    errs.push("Name must be at least 2 characters long");
  } else if (name.length > 50) {
    errs.push("Name cannot exceed 50 characters");
  } else if (!/^[a-zA-Z\s'-]+$/.test(name)) {
    errs.push("Name can only contain letters, spaces, hyphens, and apostrophes");
  }
  
  // Validate phone number
  if (!phoneNumber || phoneNumber.trim() === "") {
    errs.push("Phone number is required");
  } else if (!looksLikePhone(phoneNumber)) {
    errs.push("Phone number must be a valid format (7-15 digits)");
  }
  
  // Validate telegram username
  if (!telegramUsername || telegramUsername.trim() === "") {
    errs.push("Telegram username is required");
  } else {
    const cleanUsername = telegramUsername.replace('@', '');
    if (cleanUsername.length < 5) {
      errs.push("Telegram username must be at least 5 characters long");
    } else if (cleanUsername.length > 32) {
      errs.push("Telegram username cannot exceed 32 characters");
    } else if (!/^[a-zA-Z0-9_]+$/.test(cleanUsername)) {
      errs.push("Telegram username can only contain letters, numbers, and underscores");
    }
  }
  

  
  // Validate license plate
  if (!licensePlateNumber || licensePlateNumber.trim() === "") {
    errs.push("License plate number is required");
  } else if (licensePlateNumber.length < 2) {
    errs.push("License plate must be at least 2 characters long");
  } else if (licensePlateNumber.length > 15) {
    errs.push("License plate cannot exceed 15 characters");
  } else if (!/^[a-zA-Z0-9\s-]+$/.test(licensePlateNumber)) {
    errs.push("License plate can only contain letters, numbers, spaces, and hyphens");
  }
  
  // Validate vehicle color
  if (!vehicleColour || vehicleColour.trim() === "") {
    errs.push("Vehicle color is required");
  } else if (vehicleColour.length < 3) {
    errs.push("Vehicle color must be at least 3 characters long");
  } else if (vehicleColour.length > 30) {
    errs.push("Vehicle color cannot exceed 30 characters");
  } else if (!/^[a-zA-Z\s]+$/.test(vehicleColour)) {
    errs.push("Vehicle color can only contain letters and spaces");
  }
  
  debug("Driver registration validation complete", { errorsCount: errs.length, errors: errs });
  return errs;
}

// Rider registration validation
function validateRiderRegistration({ name, phoneNumber, telegramUsername, homeAddress, workAddress }) {
  const errs = [];
  
  debug("Validating rider registration", { name, phoneNumber, telegramUsername, homeAddress, workAddress });
  
  // Validate name (same as driver)
  if (!name || name.trim() === "") {
    errs.push("Name is required");
    debug("Name validation failed: empty or missing");
  } else if (name.length < 2) {
    errs.push("Name must be at least 2 characters long");
    debug(`Name validation failed: too short (${name.length} characters)`);
  } else if (name.length > 50) {
    errs.push("Name cannot exceed 50 characters");
    debug(`Name validation failed: too long (${name.length} characters)`);
  } else if (!/^[a-zA-Z\s'-]+$/.test(name)) {
    errs.push("Name can only contain letters, spaces, hyphens, and apostrophes");
    debug(`Name validation failed: invalid characters in "${name}"`);
  } else {
    debug("Name validation passed");
  }
  
  // Validate phone number (same as driver)
  if (!phoneNumber || phoneNumber.trim() === "") {
    errs.push("Phone number is required");
    debug("Phone validation failed: empty or missing");
  } else if (!looksLikePhone(phoneNumber)) {
    errs.push(`Phone number "${phoneNumber}" must be a valid format (7-15 digits). Examples: +1234567890, 123-456-7890, (123) 456-7890`);
    debug(`Phone validation failed: "${phoneNumber}" doesn't look like a phone number`);
  } else {
    debug(`Phone validation passed: "${phoneNumber}"`);
  }
  
  // Validate telegram username (same as driver)
  if (!telegramUsername || telegramUsername.trim() === "") {
    errs.push("Telegram username is required");
    debug("Username validation failed: empty or missing");
  } else {
    const cleanUsername = telegramUsername.replace('@', '');
    if (cleanUsername.length < 5) {
      errs.push(`Telegram username "${telegramUsername}" must be at least 5 characters long`);
      debug(`Username validation failed: too short (${cleanUsername.length} characters)`);
    } else if (cleanUsername.length > 32) {
      errs.push(`Telegram username "${telegramUsername}" cannot exceed 32 characters`);
      debug(`Username validation failed: too long (${cleanUsername.length} characters)`);
    } else if (!/^[a-zA-Z0-9_]+$/.test(cleanUsername)) {
      errs.push(`Telegram username "${telegramUsername}" can only contain letters, numbers, and underscores`);
      debug(`Username validation failed: invalid characters in "${cleanUsername}"`);
    } else {
      debug(`Username validation passed: "${telegramUsername}"`);
    }
  }
  
  // Validate home address (optional)
  if (homeAddress && homeAddress.trim() !== "") {
    if (!looksLikeAddress(homeAddress)) {
      errs.push(`Home address "${homeAddress}" must be a valid address format (include street, city, state)`);
      debug(`Home address validation failed: "${homeAddress}" doesn't look like an address`);
    } else if (homeAddress.length > 200) {
      errs.push(`Home address cannot exceed 200 characters (currently ${homeAddress.length})`);
      debug(`Home address validation failed: too long (${homeAddress.length} characters)`);
    } else {
      debug(`Home address validation passed: "${homeAddress}"`);
    }
  } else {
    debug("Home address is empty (optional field)");
  }
  
  // Validate work address (optional)
  if (workAddress && workAddress.trim() !== "") {
    if (!looksLikeAddress(workAddress)) {
      errs.push(`Work address "${workAddress}" must be a valid address format (include street, city, state)`);
      debug(`Work address validation failed: "${workAddress}" doesn't look like an address`);
    } else if (workAddress.length > 200) {
      errs.push(`Work address cannot exceed 200 characters (currently ${workAddress.length})`);
      debug(`Work address validation failed: too long (${workAddress.length} characters)`);
    } else {
      debug(`Work address validation passed: "${workAddress}"`);
    }
  } else {
    debug("Work address is empty (optional field)");
  }
  
  debug("Rider registration validation complete", { errorsCount: errs.length, errors: errs });
  return {
    isValid: errs.length === 0,
    errors: errs
  };
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
  validateDriverRegistration,
  validateRiderRegistration,
  validateDuplicateRequest,
  validateDriverAvailability: validateDriverAvailability,
  validateRideTime,
  validateBidAmount,
  validateRadius,
  validateDuration,
  checkRateLimit,
  getRateLimitRemaining,
  validateUserState,
  validateRideState,
  // New security validations
  validateTelegramId,
  validateCoordinates,
  sanitizeInput,
  validateObjectId
};
