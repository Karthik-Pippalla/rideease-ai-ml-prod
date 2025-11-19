// utils/openai.js - Updated with timezone fixes
// Intent + entity parsing using OpenAI when available, with robust regex fallbacks.
// Exposes: detectIntent, parseDriverAvailability, parseRideRequest, sanitizeInput

const { parseDateTime, isValidFutureTime, formatDateTime } = require('./dateParser');

let chrono = null; // optional natural language date parser
try { chrono = require("chrono-node"); } catch (_) { /* optional */ }
let openai = null;
let hasOpenAI = false;

try {
  // Optional OpenAI client (npm i openai)
  const OpenAI = require("openai");
  if (process.env.OPENAI_API_KEY) {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    hasOpenAI = true;
  }
} catch (_) {
  // no-op: fall back to regex parsers
}

// ------------------------- helpers -------------------------
function sanitizeInput(text = "") {
  return text.replace(/[\u0000-\u001F\u007F]+/g, " ").trim();
}

function toNumber(n) {
  if (n == null) return null;
  const v = Number(String(n).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(v) ? v : null;
}

// Removed manual regex parsing functions - now relying entirely on OpenAI

function extractAddressAfter(text, cueRegex) {
  const m = text.match(cueRegex);
  if (!m) return null;
  const after = text.slice(m.index + m[0].length).trim();
  // stop at next comma-separated clause if it clearly starts a different field
  const cut = after.split(/\b(?:radius|pickup\s*distance|for|hours?|hr|hrs|minutes?|min|till|until)\b/i)[0].trim();
  return cut || null;
}

function extractKV(text, key) {
  // extracts "Key: value" tolerant to spacing, pipes, and commas
  const re = new RegExp(`\\b${key}\\s*[:\\-]\\s*([^|,\\n]+?)(?=\\s*\\||\\s*\\b(?:pickup|drop|time|bid)\\b|\\s*$)`, "i");
  const m = text.match(re);
  return m && m[1] ? sanitizeInput(m[1].trim()) : null;
}

// ---------------------- regex fallbacks ----------------------
function parseDriverAvailabilityFallback(text) {
  // Simplified fallback - only provide structure, let OpenAI handle all parsing
  return { 
    address: null, 
    radiusMiles: null, 
    hours: null, 
    errors: ["OpenAI parsing required - no manual regex fallback available"] 
  };
}

function parseRideRequestFallback(text) {
  // Simplified fallback - only provide structure, let OpenAI handle all parsing
  return { 
    pickup: null, 
    dropoff: null, 
    bid: null, 
    rideTimeISO: null, 
    errors: ["OpenAI parsing required - no manual regex fallback available"] 
  };
}

// ---------------------- OpenAI extraction ----------------------
function llmExtract(schema, userText, systemHint, callback) {
  if (!hasOpenAI) {
    return callback(null, null);
  }
  
  openai.chat.completions.create({
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
    messages: [
      { role: "system", content: systemHint || "Extract fields as JSON that matches the JSON schema." },
      { role: "user", content: userText },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "extraction",
        schema: schema,
        strict: true
      }
    },
    temperature: 0
  })
  .then(result => {
    try {
      const content = result.choices?.[0]?.message?.content;
      if (content) {
        try { 
          const parsed = JSON.parse(content);
          callback(null, parsed);
        } catch (parseError) {
          console.warn("Failed to parse OpenAI JSON response:", parseError.message);
          callback(null, null);
        }
      } else {
        callback(null, null);
      }
    } catch (e) {
      if (process.env.DEBUG) console.warn("OpenAI extract failed:", e.message);
      callback(null, null);
    }
  })
  .catch(err => {
    if (process.env.DEBUG) console.warn("OpenAI extract failed:", err.message);
    callback(null, null);
  });
}

function parseDriverAvailability(text, callback) {
  // Always use OpenAI for parsing - no regex fallback
  if (!hasOpenAI) {
    return callback(null, {
      address: null,
      radiusMiles: null,
      hours: 1, // Default fallback when OpenAI is not available
      errors: ["OpenAI not available - cannot parse driver availability"]
    });
  }

  const schema = {
    type: "object",
    properties: {
      address: { type: "string", description: "Driver availability location address" },
      radiusMiles: { type: "number", description: "Pickup distance in miles - how far driver will travel to pick up riders" },
      hours: { type: "number", description: "Hours of availability" },
      errors: { type: "array", items: { type: "string" }, description: "Any parsing errors or warnings" },
    },
    required: ["address", "radiusMiles", "hours", "errors"],
    additionalProperties: false,
  };

  const currentDateTime = new Date();
  const currentDateTimeString = currentDateTime.toISOString();
  const currentLocalTime = currentDateTime.toLocaleString('en-US', { 
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric', 
    hour: 'numeric', 
    minute: '2-digit', 
    timeZoneName: 'short' 
  });

  const prompt = `Current date and time: ${currentLocalTime} (${currentDateTimeString})\n\nUser says: ${text}\n\nExtract: address (string), radiusMiles (number - pickup distance in miles), hours (number). Parse all time units (hrs, hours, hr, h, minutes, mins, min, m) and distance units (miles, mi, mile, km, kilometers, kilometer). Convert everything to miles and hours. Look for terms like "radius", "pickup distance", "service radius", "driving distance", or just "miles" after an address. When parsing time references like "until 6:30 pm", "for 3 hours", "2 hrs", "45 minutes", use the current date and time provided above as context. If something is missing, put a brief message into errors[].`;
  
  llmExtract(schema, prompt, "You are a precise information extractor for driver availability. Parse all time and distance units accurately and convert to standard units (miles, hours). Use the provided current date and time to properly interpret relative time references.", (err, out) => {
    if (err || !out) {
      return callback(null, {
        address: null,
        radiusMiles: null, 
        hours: 1,
        errors: ["Failed to parse with OpenAI"]
      });
    }

    // normalize + basic checks
    const res = {
      address: sanitizeInput(out.address),
      radiusMiles: toNumber(out.radiusMiles),
      hours: toNumber(out.hours) || 1,
      errors: Array.isArray(out.errors) ? out.errors.slice(0) : [],
    };
    if (!res.address) res.errors.push("address missing");
    if (!res.radiusMiles) res.errors.push("pickup distance missing");
    if (!(res.hours > 0)) res.errors.push("hours must be > 0");
    callback(null, res);
  });
}

function parseRideRequest(text, callback) {
  console.log("🐛 DEBUG: parseRideRequest called with text:", text);
  
  // Always use OpenAI for parsing - no regex fallback
  if (!hasOpenAI) {
    return callback(null, {
      pickup: null,
      dropoff: null,
      bid: null,
      rideTimeISO: null,
      errors: ["OpenAI not available - cannot parse ride request"]
    });
  }

  const schema = {
    type: "object",
    properties: {
      pickup: { type: "string", description: "Pickup location address" },
      dropoff: { type: "string", description: "Drop-off location address" },
      bid: { type: "number", description: "Bid amount in dollars" },
      rideTime: { type: "string", description: "Ride time in ISO 8601 format" },
      confidence: { type: "string", enum: ["high", "medium", "low"], description: "Confidence in time parsing" },
      timeInterpretation: { type: "string", description: "Human readable interpretation of the time" },
      errors: { type: "array", items: { type: "string" }, description: "Any parsing errors or warnings" },
    },
    required: ["pickup", "dropoff", "rideTime", "bid", "confidence", "timeInterpretation", "errors"],
    additionalProperties: false,
  };

  const currentDateTime = new Date();
  const currentDateTimeString = currentDateTime.toISOString();
  const currentLocalTime = currentDateTime.toLocaleString('en-US', { 
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric', 
    hour: 'numeric', 
    minute: '2-digit', 
    timeZoneName: 'short' 
  });
  
  const prompt = `CURRENT TIME: ${currentLocalTime} (${currentDateTimeString})

User ride request: "${text}"

CRITICAL TIMEZONE CONVERSION RULES:
- User is in Eastern Time (America/New_York)
- Eastern Time is CURRENTLY UTC-4 (EDT - Eastern Daylight Time)
- To convert Eastern Time to UTC: ADD 4 hours
- Examples:
  * 8:18 PM EDT = 8:18 PM + 4 hours = 12:18 AM UTC (next day)
  * 7:50 PM EDT = 7:50 PM + 4 hours = 11:50 PM UTC (same day)
  * 1:00 PM EDT = 1:00 PM + 4 hours = 5:00 PM UTC (same day)

VALIDATION: Current time is ${currentLocalTime}
- If user says "8:18 pm" today, the UTC time should be properly converted
- Double-check timezone conversion: Eastern Time + 4 hours = UTC

Extract the following information:
- pickup: pickup location address (clean, without extra words like "at")
- dropoff: drop-off location address (clean, without extra words like "at")  
- bid: bid amount in dollars (REQUIRED - rider must specify their bid)
- rideTime: convert time to ISO 8601 UTC format by ADDING 4 hours to Eastern Time
- confidence: "high" if time is specific (e.g. "7pm today"), "medium" if relative but clear (e.g. "in 2 hours"), "low" if ambiguous
- timeInterpretation: human-readable version of when the ride is (e.g. "Today at 7:00 PM Eastern", "Tomorrow at 9:00 AM Eastern")
- errors: list any missing required fields or invalid times (times in the past should be flagged)

Time parsing examples (current time is provided above):
- User says "8:18 pm" → interpret as "today 8:18 PM Eastern" → convert to UTC correctly
- User says "tomorrow 9am" → interpret as "tomorrow 9:00 AM Eastern" → convert to UTC correctly
- User says "7pm" without "today" or "tomorrow": if 7pm today has passed, interpret as tomorrow 7pm
- "now" or "right now" = current time
- "in 2 hours" = 2 hours from current time

Always provide ALL fields even if some are missing or invalid.`;

  console.log("🐛 DEBUG: Using OpenAI for ride request parsing");
  llmExtract(schema, prompt, "You are a precise ride request parser for a rideshare app. Extract all information accurately and handle timezone conversion properly.", (err, out) => {
    if (err || !out) {
      console.log("🐛 DEBUG: OpenAI extraction failed:", err?.message || "No output");
      return callback(null, {
        pickup: null,
        dropoff: null,
        bid: null,
        rideTimeISO: null,
        errors: ["Failed to parse with OpenAI"]
      });
    }

    console.log("🐛 DEBUG: OpenAI extraction result:", JSON.stringify(out, null, 2));

    // Normalize and validate the OpenAI result
    const result = {
      pickup: sanitizeInput(out.pickup),
      dropoff: sanitizeInput(out.dropoff),
      bid: toNumber(out.bid),
      rideTimeISO: out.rideTime,
      confidence: out.confidence || "medium",
      timeInterpretation: out.timeInterpretation,
      errors: Array.isArray(out.errors) ? out.errors : [],
    };

    // Additional validation
    if (!result.pickup) result.errors.push("pickup missing (e.g., 'Pickup: 123 Main St')");
    if (!result.dropoff) result.errors.push("dropoff missing (e.g., 'Drop: Airport')");
    if (!result.bid) result.errors.push("bid amount missing (e.g., 'Bid: $25')");
    if (!result.rideTimeISO) result.errors.push("time missing or unrecognized (e.g., 'Time: today 6pm')");

    // Validate time is not in the past (if provided)
    if (result.rideTimeISO) {
      try {
        const rideTime = new Date(result.rideTimeISO);
        const now = new Date();
        const buffer = 2 * 60 * 1000; // 2 minutes buffer
        if (rideTime.getTime() < (now.getTime() - buffer)) {
          result.errors.push("ride time cannot be in the past");
        }
      } catch (e) {
        result.errors.push("invalid time format");
      }
    }

    console.log("🐛 DEBUG: Final OpenAI result:", result);
    callback(null, result);
  });
}

function getHelpText(role) {
  const common = [
    "Commands:",
    "• /start — begin or reopen the bot",
    "• /me — show your role",
  ];

  if (role === "driver") {
    return (
      [
        "Driver quick help:",
        "\nAvailability (examples):",
        "• I'm available at 1251 E Sunrise Blvd, Fort Lauderdale, pickup distance 10 miles, for 3 hours.",
        "• Available at Miami International Airport, pickup distance 8 miles, for 90 min.",
        "• I'm available at 350 5th Ave, NY, pickup distance 5 mi, until 6:30 pm.",
        "\nWhile available:",
        "• You’ll get a list of nearby rides without rider identity.",
        "• Tap Ride N to accept; rider username is revealed only after you pick.",
        "• To stop availability: /availability_off",
        "\nManage rides:",
        "• View your rides: my rides",
        "• Complete a ride: tap 'Complete' in ride menu",
        "• Cancel a ride: tap 'Cancel' in ride menu",
        "\nRules:",
        "• Your availability auto-expires at the end time.",
        "• Matching is based on your pickup distance around the location you shared.",
        "\n",
        ...common,
      ].join("\n")
    );
  }

  if (role === "rider") {
    return (
      [
        "Rider quick help:",
        "\nRequest a ride (smart natural language):",
        "• \"I need a ride from Miami Airport to Downtown at 7pm today, bid $30\"",
        "• \"Pickup: Fort Lauderdale | Drop: Boca Raton | Time: tomorrow 9am | Bid: $25\"",
        "• \"Take me from the airport to mall right now, $40\"",
        "• \"Pickup downtown, drop at beach, 6pm today, bid 20\"",
        "\nTime examples that work:",
        "• \"today 7pm\", \"tomorrow 9am\", \"right now\"",
        "• \"in 2 hours\", \"at 6:30 PM\", \"this evening\"",
        "• Bot will ask for confirmation if time is unclear!",
        "\nManage rides:",
        "• View your rides: my rides",
        "• Update a ride: update ride",
        "• Cancel a ride: tap 'Cancel' in ride menu or 'delete ride'",
        "\nTips:",
        "• Just describe your ride naturally - the bot understands context!",
        "• Be specific with addresses for better driver matches.",
        "• The bot will confirm ambiguous times before booking.",
        "\n",
        ...common,
      ].join("\n")
    );
  }

  // Unregistered / unknown role
  return (
    [
      "Welcome! Please register to continue.",
      "Choose a role: Driver or Rider.",
      "\nDriver can: share availability to see nearby ride requests.",
      "Rider can: post ride requests with pickup, drop, bid, and time.",
      "\nAfter registering, try:",
      "• Driver: I'm available at <address>, pickup distance <miles>, for <hours>.",
      "• Rider: Pickup: <addr> | Drop: <addr> | Bid: <amt> | Time: <today 6pm|right now|tomorrow 9am>",
      "\n",
      ...common,
    ].join("\n")
  );
}

// Parse driver profile updates - Prioritize OpenAI over regex
function parseDriverUpdate(text, callback) {
  const schema = {
    type: "object",
    properties: {
      name: { type: ["string", "null"], description: "Driver's full name (if mentioned for update)" },
      phoneNumber: { type: ["string", "null"], description: "Driver's phone number (if mentioned for update)" },
      licensePlateNumber: { type: ["string", "null"], description: "Vehicle license plate number (if mentioned for update)" },
      vehicleColour: { type: ["string", "null"], description: "Vehicle color (if mentioned for update)" },
    },
    required: [],
    additionalProperties: false,
  };

  if (hasOpenAI) {
    const prompt = `The user is a driver who wants to update their profile. Parse this message and extract ONLY the fields they want to update. Extract ONLY the actual NEW VALUE without any connecting words like "is", "to", etc.

User message: "${text}"

Field mapping rules:
- name/full name → name
- phone/number/mobile/cell → phoneNumber  
- car model/vehicle model → vehicleModel
- license plate/plate number → licensePlateNumber
- car color/vehicle color/colour → vehicleColour

NOTE: Username updates are automatically handled by the system - ignore username update requests.

Examples:
- "update my name to John Smith" → name: "John Smith"
- "my name is John Smith" → name: "John Smith" 
- "change my phone number to 555-0123" → phoneNumber: "555-0123"
- "my phone is 555-1234" → phoneNumber: "555-1234"
- "my car model is Honda Civic" → vehicleModel: "Honda Civic"
- "update license plate to ABC123" → licensePlateNumber: "ABC123"
- "change car color to blue" → vehicleColour: "blue"
- "my license plate is ABC123" → licensePlateNumber: "ABC123"

IMPORTANT: Extract only the actual value after words like "is", "to", ignoring connecting words.`;

    llmExtract(schema, prompt, "You are an expert at parsing driver profile update requests. Extract only the NEW VALUES that the user wants to change, removing all instruction words.", (err, out) => {
      if (err || !out) {
        // Fall back to regex parsing if OpenAI fails
        return parseDriverUpdateFallback(text, callback);
      }
      
      // Filter out null values - only return fields that were actually updated
      const filteredUpdates = {};
      Object.keys(out).forEach(key => {
        if (out[key] !== null && out[key] !== undefined && out[key].trim() !== '') {
          filteredUpdates[key] = out[key].trim();
        }
      });
      
      callback(null, filteredUpdates);
    });
  } else {
    // No OpenAI available, use regex fallback
    parseDriverUpdateFallback(text, callback);
  }
}

// Regex fallback for driver updates when OpenAI is not available
function parseDriverUpdateFallback(text, callback) {
  const updates = {};
  
  // Enhanced phone number patterns
  if (/\b(phone|number|mobile|cell)\b/i.test(text)) {
    const phoneMatch = text.match(/(?:my\s+)?(?:phone|number|mobile|cell)(?:\s+to\s+|\s+)(\+?[\d\-\(\)\s]+)/i) ||
                      text.match(/(?:phone|number|mobile|cell)\s*[:=]\s*(\+?[\d\-\(\)\s]+)/i);
    if (phoneMatch) updates.phoneNumber = phoneMatch[1].trim();
  }
  
  // Enhanced name patterns
  if (/\b(name)\b/i.test(text)) {
    const nameMatch = text.match(/(?:my\s+)?name(?:\s+to\s+|\s+)([a-zA-Z\s'-]+)/i);
    if (nameMatch) updates.name = nameMatch[1].trim();
  }
  
  // Note: Username updates are automatically handled by the system
  
  // License plate patterns
  if (/\b(plate|license|tag)\b/i.test(text)) {
    const plateMatch = text.match(/(?:my\s+)?(?:license\s+plate|plate|license|tag)(?:\s+to\s+|\s+)([a-zA-Z0-9\s-]+)/i);
    if (plateMatch) updates.licensePlateNumber = plateMatch[1].trim();
  }
  
  // Vehicle color patterns
  if (/\b(color|colour|vehicle)\b/i.test(text)) {
    const colorMatch = text.match(/(?:my\s+)?(?:vehicle\s+color|vehicle\s+colour|color|colour)(?:\s+to\s+|\s+)([a-zA-Z\s]+)/i);
    if (colorMatch) updates.vehicleColour = colorMatch[1].trim();
  }
  
  callback(null, updates);
}

// Parse rider profile updates - Prioritize OpenAI over regex
function parseRiderUpdate(text, callback) {
  const schema = {
    type: "object",
    properties: {
      name: { type: ["string", "null"], description: "Rider's full name (if mentioned for update)" },
      phoneNumber: { type: ["string", "null"], description: "Rider's phone number (if mentioned for update)" },
      homeAddress: { type: ["string", "null"], description: "Rider's home address (if mentioned for update)" },
      workAddress: { type: ["string", "null"], description: "Rider's work address (if mentioned for update)" },
    },
    required: [],
    additionalProperties: false,
  };

  if (hasOpenAI) {
    const prompt = `The user is a rider who wants to update their profile. Parse this message and extract ONLY the fields they want to update. Extract ONLY the actual NEW VALUE without any connecting words like "is", "to", etc.

User message: "${text}"

Field mapping rules:
- name/full name → name
- phone/number/mobile/cell → phoneNumber
- home address/home → homeAddress
- work address/work → workAddress

NOTE: Username updates are automatically handled by the system - ignore username update requests.

Examples:
- "update my name to Jane Smith" → name: "Jane Smith"
- "my name is Jane Smith" → name: "Jane Smith"
- "change my phone number to 555-0123" → phoneNumber: "555-0123"
- "my phone is 555-1234" → phoneNumber: "555-1234"
- "change my home address to 123 Main St Miami" → homeAddress: "123 Main St Miami"
- "my home address is 456 Oak Street" → homeAddress: "456 Oak Street"
- "update my work address to 456 Office Blvd" → workAddress: "456 Office Blvd"
- "my work address is 789 Corporate Dr" → workAddress: "789 Corporate Dr"
- "set my home to Downtown Miami" → homeAddress: "Downtown Miami"

IMPORTANT: Extract only the actual value after words like "is", "to", ignoring connecting words.`;

    llmExtract(schema, prompt, "You are an expert at parsing rider profile update requests. Extract only the NEW VALUES that the user wants to change, removing all instruction words.", (err, out) => {
      if (err || !out) {
        // Fall back to regex parsing if OpenAI fails
        return parseRiderUpdateFallback(text, callback);
      }
      
      // Filter out null values - only return fields that were actually updated
      const filteredUpdates = {};
      Object.keys(out).forEach(key => {
        if (out[key] !== null && out[key] !== undefined && out[key].trim() !== '') {
          filteredUpdates[key] = out[key].trim();
        }
      });
      
      callback(null, filteredUpdates);
    });
  } else {
    // No OpenAI available, use regex fallback
    parseRiderUpdateFallback(text, callback);
  }
}

// Regex fallback for rider updates when OpenAI is not available
function parseRiderUpdateFallback(text, callback) {
  const updates = {};
  
  // Enhanced phone number patterns
  if (/\b(phone|number|mobile|cell)\b/i.test(text)) {
    const phoneMatch = text.match(/(?:my\s+)?(?:phone|number|mobile|cell)(?:\s+to\s+|\s+)(\+?[\d\-\(\)\s]+)/i) ||
                      text.match(/(?:phone|number|mobile|cell)\s*[:=]\s*(\+?[\d\-\(\)\s]+)/i);
    if (phoneMatch) updates.phoneNumber = phoneMatch[1].trim();
  }
  
  // Enhanced name patterns
  if (/\b(name)\b/i.test(text)) {
    const nameMatch = text.match(/(?:my\s+)?name\s+(?:to\s+)?([a-zA-Z\s'-]+)/i);
    if (nameMatch) updates.name = nameMatch[1].trim();
  }
  
  // Note: Username updates are automatically handled by the system
  
  // Home address patterns
  if (/\b(home)\b/i.test(text)) {
    const homeMatch = text.match(/(?:my\s+)?home\s+(?:address\s+)?(?:to\s+)?(.+)/i);
    if (homeMatch) updates.homeAddress = homeMatch[1].trim();
  }
  
  // Work address patterns
  if (/\b(work|office)\b/i.test(text)) {
    const workMatch = text.match(/(?:my\s+)?(?:work|office)\s+(?:address\s+)?(?:to\s+)?(.+)/i);
    if (workMatch) updates.workAddress = workMatch[1].trim();
  }
  
  callback(null, updates);
}

// Parse ride updates
function parseRideUpdate(text, callback) {
  if (!hasOpenAI) {
    // Simple fallback for ride updates
    const updates = {};
    const pickup = extractKV(text, "pickup") || extractKV(text, "from");
    const dropoff = extractKV(text, "drop|dropoff|to");
    const bid = toNumber(extractKV(text, "bid")) || toNumber((text.match(/\$\s*(\d+(?:\.\d+)?)/) || [])[1]);
    const timeRaw = extractKV(text, "time") || extractKV(text, "when");
    
    if (pickup) updates.pickupLocationName = pickup;
    if (dropoff) updates.dropLocationName = dropoff;
    if (bid) updates.bid = bid;
    if (timeRaw) {
      const rideTime = parseDateTime(timeRaw);
      if (rideTime) updates.timeOfRide = rideTime.toISOString();
    }
    return callback(null, updates);
  }

  const schema = {
    type: "object",
    properties: {
      pickup: { type: ["string", "null"], description: "Pickup location address" },
      dropoff: { type: ["string", "null"], description: "Drop-off location address" },
      bid: { type: ["number", "null"], description: "Bid amount in dollars" },
      rideTime: { type: ["string", "null"], description: "Ride time in ISO 8601 format" },
    },
    required: ["pickup", "dropoff", "bid", "rideTime"],
    additionalProperties: false,
  };

  const prompt = `User wants to update their ride details. Extract any fields they want to change: ${text}`;
  llmExtract(schema, prompt, "Extract ride update details from user message.", (err, out) => {
    const updates = {};
    if (out && out.pickup) updates.pickupLocationName = out.pickup;
    if (out && out.dropoff) updates.dropLocationName = out.dropoff;
    if (out && out.bid) updates.bid = out.bid;
    if (out && out.rideTime) {
      const rideTime = new Date(out.rideTime);
      if (!isNaN(rideTime)) updates.timeOfRide = rideTime.toISOString();
    }
    
    callback(null, updates);
  });
}

function detectIntent(text, role, callback) {
  console.log("🐛 DEBUG: detectIntent called with text:", text, "role:", role);
  const intentStartTime = Date.now();
  const t = sanitizeInput(text).toLowerCase();
  console.log("🐛 DEBUG: normalized text:", t);
  
  // Enhanced command patterns
  if (/(^|\b)(help|what can i do|how to|commands)\b/.test(t)) {
    console.log("🤖 PERF: Pattern match (help) took:", Date.now() - intentStartTime, "ms");
    return callback(null, { type: "help", helpText: getHelpText(role) });
  }
  if (/\b(delete my ride|cancel ride|delete ride|remove ride|cancel my ride)\b/.test(t)) {
    console.log("🤖 PERF: Pattern match (delete_ride) took:", Date.now() - intentStartTime, "ms");
    return callback(null, { type: "delete_ride" });
  }
  if (/\b(availability off|go offline|stop availability|off now|unavailable|done for today|i'?m done)\b/.test(t)) {
    console.log("🤖 PERF: Pattern match (availability_off) took:", Date.now() - intentStartTime, "ms");
    return callback(null, { type: "availability_off" });
  }
  if (/\b(my rides|show rides|list rides|view rides|rides history)\b/.test(t)) {
    console.log("🤖 PERF: Pattern match (view_my_rides) took:", Date.now() - intentStartTime, "ms");
    return callback(null, { type: "view_my_rides" });
  }
  if (/\b(update ride|modify ride|change ride|edit ride)\b/.test(t)) {
    console.log("🤖 PERF: Pattern match (update_ride_details) took:", Date.now() - intentStartTime, "ms");
    return callback(null, { type: "update_ride_details" });
  }
  if (/\b(ride\s+(complete|completed|done|finished|over)|completed?\s+the\s+ride|finished\s+the\s+ride|drop\s*off\s+(complete|completed|done)|delivered\s+the\s+rider|trip\s+(complete|completed|done))\b/.test(t)) {
    console.log("🤖 PERF: Pattern match (complete_ride) took:", Date.now() - intentStartTime, "ms");
    return callback(null, { type: "complete_ride" });
  }
  if (/\b(cancel\s+ride|cancelled?\s+ride|abort\s+ride|no\s+show|rider\s+not\s+found|cancel\s+this\s+ride|something\s+wrong)\b/.test(t)) {
    console.log("🤖 PERF: Pattern match (cancel_ride) took:", Date.now() - intentStartTime, "ms");
    return callback(null, { type: "cancel_ride" });
  }

  // Profile update patterns - expanded to catch more natural language
  if (/\b(update|change|modify|set|edit|fix)\b.*\b(name|phone|number|mobile|cell|username|telegram|area|plate|license|color|colour|address|home|work|office|profile|info|information)\b/i.test(t) ||
      /\b(my|the)\s+(name|phone|number|mobile|cell|username|telegram|area|plate|license|color|colour|address|home|work)\b.*\b(to|is|should be)\b/i.test(t)) {
    if (role === "driver") {
      parseDriverUpdate(text, (err, updates) => {
        callback(null, { type: "driver_update", fields: updates });
      });
      return;
    } else if (role === "rider") {
      parseRiderUpdate(text, (err, updates) => {
        callback(null, { type: "rider_update", fields: updates });
      });
      return;
    }
  }

  // Role-specific patterns
  if (role === "driver") {
    // Enhanced availability patterns
    if (/\b(i'?m\s+available|available\s+at|i'?m\s+at|working\s+at|driving\s+at|radius\b|pickup\s*distance|miles?\b.*radius|miles?\b.*pickup|ready\s+to\s+drive)\b/i.test(t)) {
      parseDriverAvailability(text, (err, parsed) => {
        callback(null, { type: "driver_availability", fields: parsed, errors: parsed ? parsed.errors : [] });
      });
      return;
    }
  }
  
  if (role === "rider") {
    // Enhanced ride request patterns
    console.log("🐛 DEBUG: Checking rider patterns for:", text);
    const ridePattern = /\b(pick\s*up|pickup:|drop|dropoff|time:|bid[:$]?|need\s+a\s+ride|book\s+a\s+ride|request\s+ride|ride\s+to|ride\s+from|go\s+to|take\s+me)\b/i;
    const matches = ridePattern.test(t);
    console.log("🐛 DEBUG: Ride pattern matches:", matches);
    if (matches) {
      console.log("🐛 DEBUG: Calling parseRideRequest");
      parseRideRequest(text, (err, parsed) => {
        console.log("🐛 DEBUG: parseRideRequest result:", err, parsed);
        callback(null, { type: "rider_ride", fields: parsed, errors: parsed ? parsed.errors : [] });
      });
      return;
    }
  }

  // OpenAI-powered classification as fallback
  if (hasOpenAI) {
    const intents = [
      "driver_availability", "rider_ride", "delete_ride", "availability_off", 
      "view_my_rides", "update_ride_details", "complete_ride", "cancel_ride", 
      "driver_update", "rider_update", "help", "unknown"
    ];
    
    const schema = {
      type: "object",
      properties: {
        intent: { type: "string", enum: intents },
        confidence: { type: "number", minimum: 0, maximum: 1 },
      },
      required: ["intent"],
      additionalProperties: false,
    };
    
    const roleContext = role === "driver" 
      ? "The user is a driver who can set availability, view rides, and update profile."
      : "The user is a rider who can request rides, cancel rides, and update profile.";
    
    const prompt = `${roleContext}\nClassify this message: "${text}"\nPossible intents: ${intents.join(", ")}`;
    
    llmExtract(schema, prompt, "Classify user intent with confidence.", (err, out) => {
      if (err || !out || (out.confidence && out.confidence < 0.5)) {
        callback(null, { type: "help", helpText: getHelpText(role) });
        return;
      }
      
      switch (out.intent) {
        case "driver_availability":
          parseDriverAvailability(text, (err, parsed) => {
            callback(null, { type: "driver_availability", fields: parsed, errors: parsed ? parsed.errors : [] });
          });
          return;
        case "rider_ride":
          parseRideRequest(text, (err, parsed) => {
            callback(null, { type: "rider_ride", fields: parsed, errors: parsed ? parsed.errors : [] });
          });
          return;
        case "driver_update":
          parseDriverUpdate(text, (err, updates) => {
            callback(null, { type: "driver_update", fields: updates });
          });
          return;
        case "rider_update":
          parseRiderUpdate(text, (err, updates) => {
            callback(null, { type: "rider_update", fields: updates });
          });
          return;
        case "delete_ride": 
          callback(null, { type: "delete_ride" }); 
          return;
        case "availability_off": 
          callback(null, { type: "availability_off" }); 
          return;
        case "view_my_rides": 
          callback(null, { type: "view_my_rides" }); 
          return;
        case "update_ride_details": 
          callback(null, { type: "update_ride_details" }); 
          return;
        case "complete_ride": 
          callback(null, { type: "complete_ride" }); 
          return;
        case "cancel_ride": 
          callback(null, { type: "cancel_ride" }); 
          return;
        case "help": 
          callback(null, { type: "help", helpText: getHelpText(role) }); 
          return;
        default: 
          callback(null, { type: "help", helpText: getHelpText(role) }); 
          return;
      }
    });
    return;
  }

  return callback(null, { type: "help", helpText: getHelpText(role) });
}

// Promise wrapper for detectIntent to support both callback and async/await usage
function detectIntentAsync(text, role) {
  return new Promise((resolve, reject) => {
    detectIntent(text, role, (err, result) => {
      if (err) {
        reject(err);
      } else {
        resolve(result);
      }
    });
  });
}

module.exports = {
  sanitizeInput,
  parseDriverAvailability,
  parseRideRequest,
  parseDriverUpdate,
  parseRiderUpdate,
  parseRideUpdate,
  detectIntent: detectIntentAsync, // Export the async version
  getHelpText,
};
