// utils/openai.js
// Intent + entity parsing using OpenAI when available, with robust regex fallbacks.
// Exposes: detectIntent, parseDriverAvailability, parseRideRequest, sanitizeInput

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

function extractRadiusMiles(text) {
  const m = text.match(/\b(?:radius|within|upto|up to)\s*(\d+(?:\.\d+)?)\s*(?:mi|mile|miles)?\b/i) ||
            text.match(/\b(\d+(?:\.\d+)?)\s*(?:mi|mile|miles)\b/i);
  return m ? toNumber(m[1]) : null;
}

function extractHours(text) {
  // e.g., "for 3 hours", "for 1.5 hr", "for 45 min"
  const h = text.match(/for\s*(\d+(?:\.\d+)?)\s*(?:h|hr|hour|hours)\b/i);
  if (h) return toNumber(h[1]);
  const m = text.match(/for\s*(\d+)\s*(?:m|min|minute|minutes)\b/i);
  if (m) return toNumber(m[1]) / 60;
  // Support "till 5:30 pm"
  const till = text.match(/\b(?:till|until|through)\s*([0-9:apm\s.]+)\b/i);
  if (till) {
    const target = chrono ? chrono.parseDate(till[1], new Date()) : new Date(till[1]);
    if (target && !isNaN(target)) {
      const diffMs = target.getTime() - Date.now();
      if (diffMs > 0) return diffMs / 3600000;
    }
  }
  return null;
}

function extractAddressAfter(text, cueRegex) {
  const m = text.match(cueRegex);
  if (!m) return null;
  const after = text.slice(m.index + m[0].length).trim();
  // stop at next comma-separated clause if it clearly starts a different field
  const cut = after.split(/\b(?:radius|for|hours?|hr|hrs|minutes?|min|till|until)\b/i)[0].trim();
  return cut || null;
}

function extractKV(text, key) {
  // extracts "Key: value" tolerant to spacing and pipes
  const re = new RegExp(`${key}\s*[:\-]\s*([^|\n]+)`, "i");
  const m = text.match(re);
  return m ? sanitizeInput(m[1]) : null;
}

function parseWhen(text) {
  // Prefer chrono if installed
  const base = new Date();
  const dt = (chrono && chrono.parseDate(text, base)) || new Date(text);
  if (!dt || isNaN(dt.getTime())) return null;
  return dt;
}

function ensureAtLeast30Min(dt) {
  return dt && dt.getTime() - Date.now() >= 30 * 60 * 1000;
}

// ---------------------- regex fallbacks ----------------------
function parseDriverAvailabilityFallback(text) {
  const address = extractAddressAfter(text, /(available\s+at|i'?m\s+available\s+at)\s*/i) ||
                  extractAddressAfter(text, /(at)\s+/i) || null;
  const radiusMiles = extractRadiusMiles(text);
  const hours = extractHours(text) || 1;

  const errors = [];
  if (!address) errors.push("address missing (e.g., 'available at 1251 E Sunrise Blvd')");
  if (!radiusMiles) errors.push("radius in miles missing (e.g., 'radius 10 miles')");
  if (hours <= 0) errors.push("duration must be > 0 hours");

  return { address, radiusMiles, hours, errors };
}

function parseRideRequestFallback(text) {
  // Try structured first: Pickup: A | Drop: B | Bid: 20 | Time: today 18:30
  const pickup = extractKV(text, "pickup") || extractKV(text, "from") || null;
  const dropoff = extractKV(text, "drop|dropoff|to") || extractKV(text, "to") || null;
  const bid = toNumber(extractKV(text, "bid")) || toNumber((text.match(/\$\s*(\d+(?:\.\d+)?)/) || [])[1]);
  const tRaw = extractKV(text, "time") || extractKV(text, "when") || null;

  // If still empty, try loose pattern: "pickup <addr> drop <addr> time <...> bid <...>"
  let lpick = pickup, ldrop = dropoff, ltime = tRaw;
  if (!lpick) {
    const m = text.match(/\bpick(?:up)?\s+(.*?)(?=\bdrop|\bto\b|\bbid\b|\btime\b|\n|$)/i);
    if (m) lpick = sanitizeInput(m[1]);
  }
  if (!ldrop) {
    const m = text.match(/\b(?:drop(?:off)?|to)\s+(.*?)(?=\bpick|\bbid\b|\btime\b|\n|$)/i);
    if (m) ldrop = sanitizeInput(m[1]);
  }
  if (!ltime) {
    const m = text.match(/\btime\s+(.*)$/i);
    if (m) ltime = sanitizeInput(m[1]);
  }

  const rideTime = ltime ? parseWhen(ltime) : null;
  const errors = [];
  if (!lpick) errors.push("pickup missing (e.g., 'Pickup: 123 Main St')");
  if (!ldrop) errors.push("drop missing (e.g., 'Drop: Airport')");
  if (!rideTime) errors.push("time missing or unrecognized (e.g., 'Time: today 18:30')");
  if (rideTime && !ensureAtLeast30Min(rideTime)) errors.push("time must be ≥ 30 minutes from now");

  return {
    pickup: lpick || null,
    dropoff: ldrop || null,
    bid: bid || 0,
    rideTimeISO: rideTime ? rideTime.toISOString() : null,
    errors,
  };
}

// ---------------------- OpenAI extraction ----------------------
async function llmExtract(schema, userText, systemHint) {
  if (!hasOpenAI) return null;
  try {
    const result = await openai.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      input: [
        { role: "system", content: systemHint || "Extract fields as JSON that matches the JSON schema." },
        { role: "user", content: userText },
      ],
      json_schema: { name: "extraction", schema, strict: true },
    });
    const tool = result.output?.[0]?.content?.find?.(c => c.type === "output_text");
    if (tool && tool.text) {
      try { return JSON.parse(tool.text); } catch (_) {}
    }
  } catch (e) {
    // fall back quietly
    if (process.env.DEBUG) console.warn("OpenAI extract failed:", e.message);
  }
  return null;
}

async function parseDriverAvailability(text) {
  const fallback = parseDriverAvailabilityFallback(text);
  if (!hasOpenAI) return fallback;

  const schema = {
    type: "object",
    properties: {
      address: { type: "string" },
      radiusMiles: { type: "number" },
      hours: { type: "number" },
      errors: { type: "array", items: { type: "string" } },
    },
    required: ["address", "radiusMiles", "hours"],
    additionalProperties: false,
  };

  const prompt = `User says: ${text}\nExtract: address (string), radiusMiles (number), hours (number). If something is missing, put a brief message into errors[].`;
  const out = await llmExtract(schema, prompt, "You are a precise information extractor for driver availability.");
  if (!out) return fallback;

  // normalize + basic checks
  const res = {
    address: sanitizeInput(out.address || fallback.address),
    radiusMiles: toNumber(out.radiusMiles) || fallback.radiusMiles,
    hours: toNumber(out.hours) || fallback.hours || 1,
    errors: Array.isArray(out.errors) ? out.errors.slice(0) : [],
  };
  if (!res.address) res.errors.push("address missing");
  if (!res.radiusMiles) res.errors.push("radius missing");
  if (!(res.hours > 0)) res.errors.push("hours must be > 0");
  return res;
}

async function parseRideRequest(text) {
  const fallback = parseRideRequestFallback(text);
  if (!hasOpenAI) return fallback;

  const schema = {
    type: "object",
    properties: {
      pickup: { type: "string" },
      dropoff: { type: "string" },
      bid: { type: "number" },
      rideTime: { type: "string", description: "ISO 8601" },
      errors: { type: "array", items: { type: "string" } },
    },
    required: ["pickup", "dropoff", "rideTime"],
    additionalProperties: false,
  };

  const prompt = `User says: ${text}\nExtract: pickup (string), dropoff (string), bid (number if present), rideTime (ISO 8601). If time is < 30 minutes from now or any field is missing, add a short note to errors[].`;
  const out = await llmExtract(schema, prompt, "You are a precise information extractor for rider ride requests.");
  if (!out) return fallback;

  const rideTime = out.rideTime ? new Date(out.rideTime) : null;
  const res = {
    pickup: sanitizeInput(out.pickup || fallback.pickup),
    dropoff: sanitizeInput(out.dropoff || fallback.dropoff),
    bid: toNumber(out.bid) ?? fallback.bid ?? 0,
    rideTimeISO: rideTime && !isNaN(rideTime) ? rideTime.toISOString() : fallback.rideTimeISO,
    errors: Array.isArray(out.errors) ? out.errors.slice(0) : [],
  };
  if (!res.pickup) res.errors.push("pickup missing");
  if (!res.dropoff) res.errors.push("dropoff missing");
  if (!res.rideTimeISO) res.errors.push("time missing");
  if (res.rideTimeISO && !ensureAtLeast30Min(new Date(res.rideTimeISO))) res.errors.push("time must be ≥ 30 minutes from now");
  return res;
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
        "• I'm available at 1251 E Sunrise Blvd, Fort Lauderdale, radius 10 miles, for 3 hours.",
        "• Available at Miami International Airport, radius 8 miles, for 90 min.",
        "• I'm available at 350 5th Ave, NY, radius 5 mi, until 6:30 pm.",
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
        "• Matching is based on your radius around the location you shared.",
        "\n",
        ...common,
      ].join("\n")
    );
  }

  if (role === "rider") {
    return (
      [
        "Rider quick help:",
        "\nRequest a ride (examples):",
        "• Pickup: 123 Main St | Drop: JFK Airport | Bid: 25 | Time: today 18:30",
        "• Pickup: 1600 Amphitheatre Pkwy | Drop: SFO | Bid: 60 | Time: tomorrow 09:15",
        "• Pickup: Downtown Miami | Drop: MIA | Bid: 30 | Time: 7pm",
        "\nManage rides:",
        "• View your rides: my rides",
        "• Update a ride: update ride",
        "• Cancel a ride: tap 'Cancel' in ride menu or 'delete ride'",
        "\nTips:",
        "• Time must be at least 30 minutes from now.",
        "• Be specific with addresses for better matches.",
        "• Delete your open request: /delete_ride",
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
      "• Driver: I'm available at <address>, radius <miles>, for <hours>.",
      "• Rider: Pickup: <addr> | Drop: <addr> | Bid: <amt> | Time: <today 18:30>",
      "\n",
      ...common,
    ].join("\n")
  );
}

// Parse driver profile updates
async function parseDriverUpdate(text) {
  if (!hasOpenAI) {
    // Fallback parsing
    const updates = {};
    if (text.includes("phone")) {
      const phoneMatch = text.match(/phone\s+(?:to\s+)?(\+?[\d\-\(\)\s]+)/i);
      if (phoneMatch) updates.phoneNumber = phoneMatch[1].trim();
    }
    if (text.includes("name")) {
      const nameMatch = text.match(/name\s+(?:to\s+)?([a-z\s]+)/i);
      if (nameMatch) updates.name = nameMatch[1].trim();
    }
    return updates;
  }

  const schema = {
    type: "object",
    properties: {
      name: { type: "string" },
      phoneNumber: { type: "string" },
      telegramUsername: { type: "string" },
      rideArea: { type: "string" },
      licensePlateNumber: { type: "string" },
      vehicleColour: { type: "string" },
    },
    additionalProperties: false,
  };

  const prompt = `User wants to update their driver profile. Extract any fields they want to change: ${text}`;
  const out = await llmExtract(schema, prompt, "Extract driver profile updates from user message.");
  return out || {};
}

// Parse rider profile updates
async function parseRiderUpdate(text) {
  if (!hasOpenAI) {
    // Fallback parsing
    const updates = {};
    if (text.includes("phone")) {
      const phoneMatch = text.match(/phone\s+(?:to\s+)?(\+?[\d\-\(\)\s]+)/i);
      if (phoneMatch) updates.phoneNumber = phoneMatch[1].trim();
    }
    if (text.includes("name")) {
      const nameMatch = text.match(/name\s+(?:to\s+)?([a-z\s]+)/i);
      if (nameMatch) updates.name = nameMatch[1].trim();
    }
    return updates;
  }

  const schema = {
    type: "object",
    properties: {
      name: { type: "string" },
      phoneNumber: { type: "string" },
      telegramUsername: { type: "string" },
      homeAddress: { type: "string" },
      workAddress: { type: "string" },
    },
    additionalProperties: false,
  };

  const prompt = `User wants to update their rider profile. Extract any fields they want to change: ${text}`;
  const out = await llmExtract(schema, prompt, "Extract rider profile updates from user message.");
  return out || {};
}

// Parse ride updates
async function parseRideUpdate(text) {
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
      const rideTime = parseWhen(timeRaw);
      if (rideTime) updates.timeOfRide = rideTime.toISOString();
    }
    return updates;
  }

  const schema = {
    type: "object",
    properties: {
      pickup: { type: "string" },
      dropoff: { type: "string" },
      bid: { type: "number" },
      rideTime: { type: "string", description: "ISO 8601" },
    },
    additionalProperties: false,
  };

  const prompt = `User wants to update their ride details. Extract any fields they want to change: ${text}`;
  const out = await llmExtract(schema, prompt, "Extract ride update details from user message.");
  
  const updates = {};
  if (out.pickup) updates.pickupLocationName = out.pickup;
  if (out.dropoff) updates.dropLocationName = out.dropoff;
  if (out.bid) updates.bid = out.bid;
  if (out.rideTime) {
    const rideTime = new Date(out.rideTime);
    if (!isNaN(rideTime)) updates.timeOfRide = rideTime.toISOString();
  }
  
  return updates;
}

async function detectIntent(text, role) {
  const t = sanitizeInput(text).toLowerCase();
  
  // Enhanced command patterns
  if (/(^|\b)(help|what can i do|how to|commands)\b/.test(t)) return { type: "help", helpText: getHelpText(role) };
  if (/\b(delete my ride|cancel ride|delete ride|remove ride|cancel my ride)\b/.test(t)) return { type: "delete_ride" };
  if (/\b(availability off|go offline|stop availability|off now|unavailable|done for today|i'?m done)\b/.test(t)) return { type: "availability_off" };
  if (/\b(my rides|show rides|list rides|view rides|rides history)\b/.test(t)) return { type: "view_my_rides" };
  if (/\b(update ride|modify ride|change ride|edit ride)\b/.test(t)) return { type: "update_ride_details" };

  // Profile update patterns
  if (/\b(update|change|modify)\b.*\b(name|phone|username|area|plate|color|colour|address)\b/i.test(t)) {
    if (role === "driver") {
      const updates = await parseDriverUpdate(text);
      return { type: "driver_update", fields: updates };
    } else if (role === "rider") {
      const updates = await parseRiderUpdate(text);
      return { type: "rider_update", fields: updates };
    }
  }

  // Role-specific patterns
  if (role === "driver") {
    // Enhanced availability patterns
    if (/\b(i'?m\s+available|available\s+at|i'?m\s+at|working\s+at|driving\s+at|radius\b|miles?\b.*radius|ready\s+to\s+drive)\b/i.test(t)) {
      const parsed = await parseDriverAvailability(text);
      return { type: "driver_availability", fields: parsed, errors: parsed.errors };
    }
  }
  
  if (role === "rider") {
    // Enhanced ride request patterns
    if (/\b(pick\s*up|pickup:|drop|dropoff|time:|bid[:$]?|need\s+a\s+ride|book\s+a\s+ride|request\s+ride|ride\s+to|ride\s+from|go\s+to|take\s+me)\b/i.test(t)) {
      const parsed = await parseRideRequest(text);
      return { type: "rider_ride", fields: parsed, errors: parsed.errors };
    }
  }

  // OpenAI-powered classification as fallback
  if (hasOpenAI) {
    try {
      const intents = [
        "driver_availability", "rider_ride", "delete_ride", "availability_off", 
        "view_my_rides", "update_ride_details", "driver_update", "rider_update", "help", "unknown"
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
      const out = await llmExtract(schema, prompt, "Classify user intent with confidence.");
      
      if (!out || out.confidence < 0.5) {
        return { type: "help", helpText: getHelpText(role) };
      }
      
      switch (out.intent) {
        case "driver_availability": {
          const parsed = await parseDriverAvailability(text);
          return { type: "driver_availability", fields: parsed, errors: parsed.errors };
        }
        case "rider_ride": {
          const parsed = await parseRideRequest(text);
          return { type: "rider_ride", fields: parsed, errors: parsed.errors };
        }
        case "driver_update": {
          const updates = await parseDriverUpdate(text);
          return { type: "driver_update", fields: updates };
        }
        case "rider_update": {
          const updates = await parseRiderUpdate(text);
          return { type: "rider_update", fields: updates };
        }
        case "delete_ride": return { type: "delete_ride" };
        case "availability_off": return { type: "availability_off" };
        case "view_my_rides": return { type: "view_my_rides" };
        case "update_ride_details": return { type: "update_ride_details" };
        case "help": return { type: "help", helpText: getHelpText(role) };
        default: return { type: "help", helpText: getHelpText(role) };
      }
    } catch (err) {
      console.warn("OpenAI intent detection failed:", err.message);
    }
  }

  return { type: "help", helpText: getHelpText(role) };
}

module.exports = {
  sanitizeInput,
  parseDriverAvailability,
  parseRideRequest,
  parseDriverUpdate,
  parseRiderUpdate,
  parseRideUpdate,
  detectIntent,
  getHelpText,
};
