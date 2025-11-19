# RideEase DriverBot Documentation

## Overview

The DriverBot (`functions/driverBot.js`) is a sophisticated Telegram bot designed specifically for drivers in the RideEase platform. It provides a comprehensive command-based interface with natural language processing capabilities, allowing drivers to manage their availability, accept rides, update profiles, and track earnings through both structured commands and conversational interactions.

## Table of Contents

1. [Core Features](#core-features)
2. [Commands Reference](#commands-reference)
3. [Architecture Overview](#architecture-overview)
4. [Key Components](#key-components)
5. [Database Operations](#database-operations)
6. [Availability Management](#availability-management)
7. [Ride Management System](#ride-management-system)
8. [Natural Language Processing](#natural-language-processing)
9. [State Management](#state-management)
10. [Error Handling](#error-handling)
11. [Security Features](#security-features)
12. [Performance Optimizations](#performance-optimizations)
13. [Configuration](#configuration)
14. [API Integration](#api-integration)

## Core Features

### 1. Driver Registration & Profile Management
- **Registration**: New drivers can register with name, phone, username, vehicle details, and license plate
- **Profile Updates**: Modify individual fields (phone, name, vehicle model, color, license plate, username)
- **Profile Viewing**: Display comprehensive profile with ratings, ride statistics, and availability status
- **Account Deletion**: Secure profile deletion with confirmation requirements

### 2. Availability Management System
- **Set Availability**: Define location, service radius, and duration for accepting rides
- **Location-Based Matching**: Automatic matching with nearby ride requests
- **Dynamic Availability**: Real-time availability status with expiration handling
- **Availability Control**: Easy toggle between available/unavailable states

### 3. Ride Management & Earnings
- **Ride Acceptance**: View and accept available ride requests in service area
- **Ride Completion**: Mark rides as completed and notify riders
- **Ride Cancellation**: Cancel matched rides with rider notification
- **Earnings Tracking**: View statistics, total earnings, and performance metrics
- **Ride History**: Complete history of accepted, completed, and cancelled rides

### 4. Advanced Driver Features
- **Smart Matching**: Automatic matching based on location, radius, and availability
- **Conflict Prevention**: Prevents availability when active rides exist
- **Performance Analytics**: Success rates, earnings per ride, completion statistics
- **Real-time Notifications**: Instant notifications for new ride requests

## Commands Reference

### Essential Commands

#### `/start`
- **Purpose**: Initialize bot interaction and display main driver menu
- **Behavior**: 
  - New drivers: Shows registration prompt
  - Registered drivers: Displays personalized main menu with availability options
- **Response Time**: Instant
- **Example**: Simply type `/start`

#### `/me`
- **Purpose**: Display complete driver profile information
- **Shows**:
  - Name, phone number, Telegram username
  - Vehicle details (color, license plate)
  - Driver rating and total completed rides
  - Current availability status and location
  - Service radius and availability duration
  - Account creation date
- **Requirements**: Must be registered
- **Example Output**:
  ```
  👤 Driver Profile
  📝 Name: John Smith
  📞 Phone: +1-555-123-4567
  🔢 License Plate: ABC123
  🎨 Vehicle Color: Blue Honda
  ⭐ Rating: 4.9/5
  📊 Total Rides: 45
  
  🟢 Status: Available
  📍 Current Location: Set
  📏 Service Radius: 10 miles
  ⏰ Available until: 6:00 PM
  
  📅 Driver since: 1/10/2024
  ```

### Availability Management Commands

#### `/available`
- **Purpose**: Set driver availability to start accepting rides
- **Input Formats**:
  - Natural: `"I'm available at 1251 E Sunrise Blvd, Fort Lauderdale, radius 10 miles, for 3 hours"`
  - Simple: `"Available at downtown Miami, 5 miles, 2 hours"`
  - Address only: `"123 Main Street Miami"` (bot will ask for radius and duration)
- **Features**:
  - Geocoding for address validation
  - Conflict checking (prevents availability with active rides)
  - Duration management with automatic expiration
  - Immediate ride matching and notification
- **Requirements**: Must be registered, no active rides
- **Safety**: Prevents conflicts with existing matched rides

#### `/unavailable`
- **Purpose**: Stop accepting new ride requests
- **Behavior**:
  - Closes current availability session
  - Stops receiving new ride notifications
  - Does not affect already matched rides
  - Updates status to unavailable
- **Use Cases**: End of driving session, break time, off-duty

### Ride Management Commands

#### `/completed`
- **Purpose**: Mark current matched ride as completed
- **Behavior**:
  - Updates ride status to "completed"
  - Records completion timestamp
  - Notifies the rider automatically
  - Updates driver statistics and earnings
  - Returns driver to available status (if availability exists)
- **Requirements**: Must have a matched or in-progress ride
- **Example Response**:
  ```
  ✅ Ride Completed!
  📍 From: Miami Airport
  📍 To: Downtown Miami
  🕐 Time: Jan 15, 2024, 6:30 PM
  💰 Amount: $25
  
  Great job! The rider has been notified.
  ```

#### `/canceled`
- **Purpose**: Cancel current matched ride
- **Behavior**:
  - Shows ride details for confirmation
  - Requires explicit confirmation (Yes/Keep buttons)
  - Notifies rider of cancellation
  - Returns ride to open status for other drivers
  - May affect driver rating/statistics
- **Safety**: Confirmation dialog prevents accidental cancellation
- **Impact**: May result in rating penalties for frequent cancellations

#### `/rides`
- **Purpose**: View complete ride history and statistics
- **Display Format**:
  ```
  🚗 Your Rides (25)
  
  ✅ Ride 1 (COMPLETED)
     📍 Miami Airport → Downtown Miami
     🕐 Jan 15, 2024, 6:30 PM
     💰 $25
  
  🔄 Ride 2 (MATCHED)
     📍 Brickell → South Beach
     🕐 Jan 16, 2024, 8:00 AM
     💰 $30
  ```
- **Features**:
  - Status indicators (✅ Completed, 🔄 Matched, 🟡 Open, ❌ Cancelled)
  - Chronological listing with earnings
  - Pagination (shows last 10 rides)
- **Limitations**: Displays maximum 10 recent rides

#### `/stats`
- **Purpose**: View comprehensive driver performance statistics
- **Display**:
  ```
  📊 Driver Statistics
  
  👤 Driver: John Smith
  ⭐ Rating: 4.9/5
  
  🚗 Ride Summary:
  📈 Total Rides: 45
  ✅ Completed: 42
  🔄 Matched: 2
  ❌ Cancelled: 1
  
  📊 Performance:
  ✅ Success Rate: 93.3%
  💰 Total Earned: $1,125
  📈 Avg Per Ride: $26.79
  
  📅 Driver since: 1/10/2024
  ```
- **Metrics**:
  - Total and completed ride counts
  - Success rate and completion percentage
  - Total earnings and average per ride
  - Rating and performance trends

### Profile Management Commands

#### `/update`
- **Purpose**: Update driver profile information
- **Interactive Options**:
  - 📱 Phone Number
  - 👤 Name
  - 🚗 Vehicle Model
  - 🎨 Vehicle Color
  - 🔢 License Plate
  - @️⃣ Username
- **Input Methods**:
  1. **Button Selection**: Choose specific field to update
  2. **Natural Language**: `"Update my phone to 555-0123"`
  2. **Structured Format**: `Name | Phone | @Username | Plate | Color`
- **Validation**: Real-time field validation with specific error messages

#### `/erase`
- **Purpose**: Permanently delete driver profile
- **Security Features**:
  - Requires explicit confirmation
  - Shows warning about data loss
  - Irreversible action warning
  - Deletes all associated ride history and earnings data
- **Confirmation Dialog**:
  ```
  ⚠️ WARNING
  This will permanently delete your driver profile and all 
  associated data. This action cannot be undone.
  
  Are you sure you want to continue?
  [✅ Yes, Delete] [❌ Cancel]
  ```

### Utility Commands

#### `/help`
- **Purpose**: Display comprehensive driver command guide
- **Content**:
  - Complete command reference with examples
  - Step-by-step driving workflow
  - Natural language feature explanation
  - Troubleshooting tips
  - Best practices for drivers
- **Sections**:
  - Basic Commands
  - Driver Commands
  - Profile Management
  - How to Drive (workflow)
  - Troubleshooting
  - Natural Language Examples

#### `/clearcache`
- **Purpose**: Clear driver session cache
- **When to Use**:
  - Bot stuck in availability mode
  - Commands not responding properly
  - State management issues
  - After system updates
- **Safety**: Only clears temporary session data, preserves profile and statistics
- **Result**: Resets bot to clean state for the driver

#### `/natural`
- **Purpose**: Toggle natural language processing mode
- **Modes**:
  - **ON**: AI processes natural language inputs for availability, updates, and ride management
  - **OFF**: Only commands and buttons work (saves processing tokens)
- **Default**: Natural language mode is OFF by default
- **Example Natural Commands When Enabled**:
  - `"I'm available at downtown, 5 miles, for 3 hours"`
  - `"Mark my current ride as completed"`
  - `"I'm done for the day"`
  - `"Update my phone number to 555-0123"`

## Architecture Overview

### File Structure and Dependencies

```javascript
// Core Dependencies
const TelegramBot = require("node-telegram-bot-api");
const mongoose = require("mongoose");
const { CloudTasksClient } = require('@google-cloud/tasks');

// Models
const Driver = require("./models/driver");
const Ride = require("./models/ride"); 
const Rider = require("./models/rider");

// Utilities
const openai = require("./utils/openai");
const geocode = require("./utils/geocode");
const db = require("./utils/database");
const matching = require("./utils/matching");
const notifications = require("./utils/notifications");
const { formatDateTime } = require("./utils/dateParser");
const state = require("./utils/state");
const validation = require("./utils/validation");
```

### Core Architecture Components

#### 1. Bot Initialization
```javascript
function initDriverBot() {
  // Singleton pattern with separate driver token
  if (driverBot) return driverBot;
  
  // Uses dedicated driver bot token
  const token = process.env.TELEGRAM_BOT_TOKEN_DRIVER;
  const usePolling = !process.env.FUNCTIONS_EMULATOR && 
                    process.env.NODE_ENV !== "production";
  
  // Bot creation with polling configuration
  driverBot = new TelegramBot(token, { polling: usePolling });
  
  // Handler setup
  setupDriverCommands(driverBot);
  setupDriverCallbacks(driverBot);
  setupDriverMessageHandlers(driverBot);
  
  return driverBot;
}
```

#### 2. MongoDB Connection Management
```javascript
async function ensureMongoConnection() {
  // Connection state checking with driver-specific logging
  if (mongoInitialized && mongoose.connection.readyState === 1) {
    return;
  }
  
  // Connection with optimized settings for driver operations
  await mongoose.connect(uri, {
    dbName: process.env.MONGODB_DB || undefined,
    serverSelectionTimeoutMS: 30_000,
    socketTimeoutMS: 45_000,
    bufferCommands: false,
    maxPoolSize: 10,
    serverApi: { version: '1', strict: true, deprecationErrors: true }
  });
}
```

## Key Components

### 1. Driver Registration System

Driver registration requires specific vehicle-related information:

```javascript
// Registration data structure
{
  name: "John Smith",
  phoneNumber: "555-123-4567", 
  telegramId: "123456789",
  telegramUsername: "@johnsmith",
  licensePlateNumber: "ABC123",
  vehicleColour: "Blue Honda"
}
```

### 2. Availability Management System

Sophisticated availability tracking with location and time constraints:

```javascript
// Availability object structure
{
  driverId: ObjectId,
  isAvailable: true,
  availableLocation: {
    type: "Point",
    coordinates: [longitude, latitude]
  },
  availableLocationName: "1251 E Sunrise Blvd, Fort Lauderdale",
  myRadiusOfAvailabilityMiles: 10,
  timeTillAvailable: new Date("2024-01-15T21:00:00Z"), // availability end time
  createdAt: new Date(),
  status: "open"
}
```

### 3. Ride Matching and Acceptance

Automatic matching system with driver acceptance workflow:

```javascript
async function showDriverRideMenu(ctx, availability) {
  // Find matches within driver's service area
  const matches = await matching.findMatchesForDriverAvailability(availability);
  
  if (!matches.length) {
    return bot.sendMessage(ctx.chat.id, 
      "🔍 No ride requests match your current availability.");
  }
  
  // Display available rides with accept buttons
  const rideMenu = matches.map((match, index) => [
    { text: `🚗 Accept Ride ${index + 1}`, callback_data: `accept_ride_${index + 1}` }
  ]);
}
```

### 4. Ride Completion and Earnings

Comprehensive ride completion with automatic notifications:

```javascript
async function completeRide(driverId, rideId) {
  // Update ride status
  const updatedRide = await Ride.findOneAndUpdate(
    { _id: rideId, driverId: driverId },
    { 
      status: "completed",
      completedAt: new Date()
    }
  );
  
  // Update driver statistics and earnings
  await updateDriverStats(driverId, updatedRide);
  
  // Notify rider of completion
  await notifyRiderOfCompletion(updatedRide);
  
  return updatedRide;
}
```

## Database Operations

### Driver-Specific CRUD Operations

All database operations go through a secure wrapper system:

```javascript
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
```

### Example Database Operations

#### Driver Registration
```javascript
const result = await performDriverCrud("createDriver", {
  name: "John Smith",
  phoneNumber: "555-123-4567",
  telegramId: "123456789",
  telegramUsername: "@johnsmith",
  licensePlateNumber: "ABC123",
  vehicleColour: "Blue Honda"
});
```

#### Set Driver Availability
```javascript
const availabilityResult = await performDriverCrud("setDriverAvailability", {
  telegramId: "123456789",
  isAvailable: true,
  currentLocation: {
    type: "Point",
    coordinates: [-80.191788, 25.774266],
    name: "Downtown Miami"
  },
  radiusMiles: 10,
  durationHours: 3
});
```

#### Accept Ride Request
```javascript
const acceptResult = await performDriverCrud("acceptRide", {
  rideId: "ride_object_id",
  driverId: "driver_object_id"
});
```

## Availability Management

### Availability State Machine

The availability system follows a state machine pattern:

```javascript
// States: unavailable -> setting -> available -> matched -> unavailable
const AvailabilityStates = {
  UNAVAILABLE: 'unavailable',
  SETTING: 'setting_availability', 
  AVAILABLE: 'available',
  MATCHED: 'matched_with_ride',
  EXPIRED: 'availability_expired'
};

// State transitions
async function setAvailability(driverId, location, radius, duration) {
  // Check for conflicts (active rides)
  const activeRide = await checkActiveRides(driverId);
  if (activeRide) {
    throw new Error("Cannot go available with active rides");
  }
  
  // Calculate expiration time
  const expirationTime = new Date();
  expirationTime.setHours(expirationTime.getHours() + duration);
  
  // Create availability record
  const availability = await createAvailability({
    driverId,
    location,
    radius,
    expirationTime
  });
  
  // Start matching process
  await initiateRideMatching(availability);
  
  return availability;
}
```

### Automatic Expiration Handling

Availability automatically expires based on driver-specified duration:

```javascript
// Check availability expiration
function isAvailabilityValid(availability) {
  if (!availability.timeTillAvailable) return true;
  
  const now = new Date();
  const expirationTime = new Date(availability.timeTillAvailable);
  
  return expirationTime > now;
}

// Automatic cleanup of expired availability
async function cleanupExpiredAvailability() {
  const expiredAvailabilities = await Availability.find({
    timeTillAvailable: { $lt: new Date() },
    status: 'open'
  });
  
  for (const availability of expiredAvailabilities) {
    await closeDriverAvailability(availability.driverId);
  }
}
```

## Ride Management System

### Ride Lifecycle for Drivers

1. **Discovery**: Available rides shown when driver goes available
2. **Acceptance**: Driver accepts specific ride from menu
3. **Matching**: Ride status changes to "matched", rider notified
4. **In Progress**: Optional status during ride execution
5. **Completion**: Driver marks ride complete, both parties notified
6. **Payment/Rating**: System updates earnings and ratings

### Ride Matching Algorithm

Drivers see rides based on sophisticated matching:

```javascript
async function findMatchesForDriverAvailability(availability) {
  const driverLocation = availability.availableLocation.coordinates;
  const radiusMiles = availability.myRadiusOfAvailabilityMiles;
  
  // Find open ride requests within radius
  const nearbyRides = await Ride.find({
    status: 'open',
    pickupLocation: {
      $geoWithin: {
        $centerSphere: [driverLocation, radiusMiles / 3963.2]
      }
    }
  });
  
  // Calculate distances and sort by proximity/bid
  const matches = nearbyRides.map(ride => ({
    ride,
    distanceMi: calculateDistance(driverLocation, ride.pickupLocation.coordinates),
    bidValue: ride.bid || 0
  }));
  
  // Sort by combination of distance and bid
  return matches.sort((a, b) => {
    const scoreA = (a.bidValue / 10) - a.distanceMi; // Higher bid, closer distance = higher score
    const scoreB = (b.bidValue / 10) - b.distanceMi;
    return scoreB - scoreA;
  });
}
```

### Conflict Prevention

The system prevents availability conflicts:

```javascript
async function checkRideConflicts(driverId) {
  const mongoose = require('mongoose');
  const driverObjectId = mongoose.Types.ObjectId.isValid(driverId) ? 
    new mongoose.Types.ObjectId(driverId) : driverId;
  
  // Check for active rides
  const activeRide = await Ride.findOne({
    driverId: driverObjectId,
    status: { $in: ["matched", "in_progress"] }
  });
  
  if (activeRide) {
    throw new ConflictError(`Active ride exists: ${activeRide.pickupLocationName} → ${activeRide.dropLocationName}`);
  }
  
  return null;
}
```

## Natural Language Processing

### Driver-Specific Intent Detection

The bot understands driver-specific intents:

```javascript
// Example intent detection for drivers
const intent = await openai.detectIntent(
  "I'm available at downtown Miami, 5 mile radius, for 2 hours", 
  "driver"
);

// Expected intent structure:
{
  type: "driver_availability",
  confidence: "high",
  fields: {
    location: "downtown Miami",
    radius: 5,
    duration: 2,
    unit: "hours"
  },
  locationInterpretation: "Downtown Miami, FL"
}
```

### Availability Command Processing

Natural language availability setting:

```javascript
function parseAvailabilityFromIntent(intent) {
  const { location, radius, duration, unit } = intent.fields;
  
  // Convert duration to hours
  let durationHours = duration;
  if (unit === 'minutes') {
    durationHours = duration / 60;
  }
  
  return {
    location: location,
    radiusMiles: radius || 5, // Default 5 miles
    durationHours: durationHours || 3 // Default 3 hours
  };
}
```

### Driver Intent Types

```javascript
const DriverIntentTypes = {
  SET_AVAILABILITY: 'driver_availability',
  STOP_AVAILABILITY: 'availability_off', 
  COMPLETE_RIDE: 'complete_ride',
  CANCEL_RIDE: 'cancel_ride',
  UPDATE_PROFILE: 'driver_update',
  VIEW_STATS: 'view_stats',
  VIEW_RIDES: 'view_rides',
  HELP: 'help'
};
```

## State Management

### Driver State Structure

Driver states are managed with availability-specific context:

```javascript
// Driver state object structure
{
  phase: "register_driver" | "set_availability" | "update_driver_phone" | "update_driver_name" | "update_driver_vehicle_model" | "update_driver_vehicle_color" | "update_driver_license_plate" | "update_driver_username",
  timestamp: 1705123456789,
  naturalLanguageMode: true | false,
  availabilityData: {
    location: "pending_geocoding",
    radius: 10,
    duration: 3
  },
  updateField: "phoneNumber" | "name" | "vehicleModel" | "vehicleColor" | "licensePlate" | "username"
}
```

### Availability State Transitions

```javascript
// Availability setting flow
state.set(driverId, { 
  phase: "set_availability",
  timestamp: Date.now(),
  availabilityData: { location: null, radius: null, duration: null }
});

// Update state with parsed location
state.set(driverId, {
  ...currentState,
  availabilityData: {
    ...currentState.availabilityData,
    location: geocodedLocation
  }
});

// Clear state after successful availability setting
state.clear(driverId);
```

### Session Timeout Management

```javascript
// Driver-specific session timeout
const DRIVER_SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes

async function checkDriverTimeout(driverId) {
  const currentState = state.get(driverId);
  if (!currentState?.timestamp) return;
  
  const elapsed = Date.now() - currentState.timestamp;
  if (elapsed > DRIVER_SESSION_TIMEOUT) {
    state.clear(driverId);
    
    // Send timeout notification
    await bot.sendMessage(chatId, 
      "⏰ **Session Timeout**\n\nYour session has expired. Please start over with a new command.",
      getDriverMainMenu()
    );
  }
}
```

## Error Handling

### Driver-Specific Error Types

The bot provides specific error handling for driver scenarios:

```javascript
async function sendDriverError(chatId, err, hint) {
  let userMessage = hint || "An error occurred.";
  
  // Driver-specific error handling
  if (err.message.includes('active ride')) {
    userMessage = "❌ Cannot go available with active rides. Complete or cancel current ride first.";
  } else if (err.message.includes('license plate')) {
    userMessage = "❌ Invalid license plate format. Please use standard plate format (e.g., ABC123).";
  } else if (err.message.includes('vehicle')) {
    userMessage = "❌ Vehicle information is invalid. Please provide valid vehicle details.";
  } else if (err.message.includes('availability expired')) {
    userMessage = "❌ Your availability has expired. Please set availability again.";
  } else if (err.message.includes('no rides available')) {
    userMessage = "🔍 No ride requests in your area. You'll be notified when rides become available.";
  }
  
  await driverBot.sendMessage(chatId, `⚠️ ${userMessage}`, getErrorButtons());
}
```

### Conflict Resolution

Special handling for driver conflicts:

```javascript
class ConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConflictError';
    this.isConflict = true;
  }
}

// Handle ride conflicts
try {
  await setDriverAvailability(driverId, location, radius, duration);
} catch (err) {
  if (err.isConflict) {
    await bot.sendMessage(chatId,
      `⚠️ **Cannot Go Available**\n\n${err.message}\n\nPlease complete or cancel your active ride first.`,
      getRideCompletionButtons()
    );
  } else {
    throw err;
  }
}
```

## Security Features

### Driver-Specific Security

Enhanced security measures for driver operations:

```javascript
// Rate limiting for availability changes
const AVAILABILITY_RATE_LIMIT = {
  maxChanges: 10,
  timeWindow: 60000, // 1 minute
  cooldown: 300000   // 5 minutes after limit exceeded
};

// Validate driver authorization for ride operations
async function validateDriverRideAccess(driverId, rideId) {
  const ride = await Ride.findById(rideId);
  
  if (!ride) {
    throw new Error('Ride not found');
  }
  
  if (ride.driverId.toString() !== driverId.toString()) {
    logSecurityEvent('unauthorized_ride_access', { driverId, rideId });
    throw new Error('Unauthorized ride access');
  }
  
  return ride;
}
```

### Input Sanitization for Vehicle Data

```javascript
function sanitizeVehicleData(vehicleData) {
  return {
    licensePlateNumber: vehicleData.licensePlateNumber?.replace(/[^A-Z0-9]/gi, '').toUpperCase(),
    vehicleColour: vehicleData.vehicleColour?.replace(/[^a-zA-Z\s]/g, '').trim(),
    vehicleModel: vehicleData.vehicleModel?.replace(/[^a-zA-Z0-9\s]/g, '').trim()
  };
}
```

## Performance Optimizations

### Driver-Specific Optimizations

#### Efficient Availability Queries

```javascript
// Optimized availability checking with indexes
async function getDriverAvailabilityStatus(driverId) {
  // Use compound index on driverId + status + timeTillAvailable
  const availability = await Availability.findOne({
    driverId: driverId,
    status: 'open',
    $or: [
      { timeTillAvailable: { $exists: false } },
      { timeTillAvailable: { $gt: new Date() } }
    ]
  }).lean(); // Use lean() for better performance
  
  return availability;
}
```

#### Ride Matching Optimization

```javascript
// Geospatial queries with proper indexing
async function findNearbyRides(driverLocation, radiusMiles) {
  return await Ride.find({
    status: 'open',
    pickupLocation: {
      $geoWithin: {
        $centerSphere: [driverLocation, radiusMiles / 3963.2]
      }
    }
  })
  .sort({ createdAt: 1, bid: -1 }) // Sort by creation time and bid
  .limit(10) // Limit results for performance
  .lean();
}
```

#### Caching Strategy

```javascript
// Cache driver availability status
const driverAvailabilityCache = new Map();

async function getCachedDriverAvailability(driverId) {
  const cacheKey = `driver_availability_${driverId}`;
  const cached = driverAvailabilityCache.get(cacheKey);
  
  if (cached && (Date.now() - cached.timestamp) < 30000) { // 30 second cache
    return cached.data;
  }
  
  const availability = await getDriverAvailabilityStatus(driverId);
  driverAvailabilityCache.set(cacheKey, {
    data: availability,
    timestamp: Date.now()
  });
  
  return availability;
}
```

## Configuration

### Environment Variables

Required environment variables for driver bot:

```bash
# Driver Bot Configuration (Separate from Rider Bot)
TELEGRAM_BOT_TOKEN_DRIVER=your_driver_bot_token

# Database Configuration
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/database
MONGODB_DB=rideease

# AI Processing
OPENAI_API_KEY=your_openai_api_key

# Geographic Services
GEOCODING_API_KEY=your_geocoding_service_key

# Google Cloud Tasks (for notifications)
GCLOUD_PROJECT=your_project_id

# Application Environment
NODE_ENV=development|production
DEBUG=true|false
SHOW_PROGRESS_TO_USER=true|false

# Timezone Configuration
TZ=America/New_York
```

### Driver-Specific Configuration

```javascript
// Driver bot configuration options
const DRIVER_CONFIG = {
  // Default availability settings
  DEFAULT_RADIUS_MILES: 5,
  DEFAULT_DURATION_HOURS: 3,
  MAX_RADIUS_MILES: 50,
  MAX_DURATION_HOURS: 12,
  
  // Rate limiting
  MAX_AVAILABILITY_CHANGES_PER_HOUR: 20,
  MAX_RIDE_ACCEPTANCES_PER_HOUR: 10,
  
  // Session management
  SESSION_TIMEOUT_MINUTES: 30,
  AVAILABILITY_REFRESH_INTERVAL: 60000, // 1 minute
  
  // Matching preferences
  MAX_RIDES_SHOWN: 10,
  RIDE_SORT_PREFERENCE: 'distance_and_bid' // 'distance', 'bid', 'time', 'distance_and_bid'
};
```

## API Integration

### External Service Integration

#### 1. Geocoding Service for Driver Locations
```javascript
// Driver location geocoding with validation
async function geocodeDriverLocation(address) {
  const result = await geocode.geocodeAddress(address);
  
  if (!result || !result.lat || !result.lon) {
    throw new Error('Unable to locate the specified address');
  }
  
  // Validate location is in service area
  if (!isLocationInServiceArea(result.lat, result.lon)) {
    throw new Error('Location is outside our service area');
  }
  
  return {
    name: result.formatted_address,
    coordinates: [result.lon, result.lat],
    type: "Point"
  };
}
```

#### 2. Driver Notification System
```javascript
// Specialized driver notifications
async function notifyDriverOfNewRide(driver, rideDetails) {
  const message = `🚗 **New Ride Request!**\n\n` +
    `📍 **Pickup:** ${rideDetails.pickupLocationName}\n` +
    `📍 **Drop:** ${rideDetails.dropLocationName}\n` +
    `💰 **Bid:** $${rideDetails.bid}\n` +
    `🕐 **Time:** ${formatDateTime(rideDetails.timeOfRide)}\n` +
    `📏 **Distance:** ~${rideDetails.distanceFromDriver.toFixed(1)} miles\n\n` +
    `⏰ **Respond quickly - first come, first served!**`;
  
  const keyboard = {
    reply_markup: {
      inline_keyboard: [[
        { text: "✅ Accept Ride", callback_data: `accept_ride_${rideDetails._id}` },
        { text: "❌ Decline", callback_data: `decline_ride_${rideDetails._id}` }
      ]]
    }
  };
  
  await notifications.notifyDriver(driver, message, { 
    parse_mode: "Markdown", 
    ...keyboard 
  });
}
```

#### 3. Real-time Matching Integration
```javascript
// Integration with matching service
async function initiateDriverMatching(availability) {
  // Find potential rides
  const matches = await matching.findMatchesForDriverAvailability(availability);
  
  if (matches.length > 0) {
    // Show available rides to driver
    await showDriverRideMenu(driverBot, availability.driverId, matches);
    
    // Log matching event for analytics
    await analytics.logMatchingEvent({
      driverId: availability.driverId,
      matchCount: matches.length,
      location: availability.availableLocationName,
      radius: availability.myRadiusOfAvailabilityMiles
    });
  }
  
  return matches;
}
```

### Cloud Tasks Integration for Driver Operations

```javascript
// Asynchronous driver task processing
const cloudTasksClient = new CloudTasksClient({
  timeout: 30000,
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

// Create task for availability expiration
async function scheduleAvailabilityExpiration(driverId, expirationTime) {
  const task = {
    httpRequest: {
      httpMethod: 'POST',
      url: `${process.env.CLOUD_FUNCTION_URL}/expire-availability`,
      body: Buffer.from(JSON.stringify({ driverId })).toString('base64'),
      headers: {
        'Content-Type': 'application/json',
      },
    },
    scheduleTime: {
      seconds: Math.floor(expirationTime.getTime() / 1000),
    },
  };
  
  await cloudTasksClient.createTask({
    parent: `projects/${projectId}/locations/us-central1/queues/driver-tasks`,
    task
  });
}
```

## Troubleshooting Guide

### Common Driver Issues and Solutions

#### 1. Cannot Go Available
**Symptoms**: "Cannot go available" error when trying to set availability
**Common Causes**:
- Active matched or in-progress ride exists
- Previous availability not properly closed
- Database connection issues

**Solutions**:
1. Check for active rides with `/rides` command
2. Complete or cancel active ride first
3. Use `/clearcache` to clear session state
4. Try `/unavailable` then `/available` again

#### 2. No Rides Appearing
**Symptoms**: Available but not receiving ride notifications
**Possible Causes**:
- No ride requests in service area
- Availability expired
- Network connectivity issues
- Bot notification issues

**Solutions**:
1. Check availability status with `/me`
2. Expand service radius
3. Move to busier location
4. Reset availability with `/unavailable` and `/available`

#### 3. Ride Acceptance Failures  
**Symptoms**: Cannot accept rides from menu
**Common Causes**:
- Ride already accepted by another driver
- Availability changed during acceptance
- Network timeout during acceptance process

**Solutions**:
1. Refresh ride list immediately
2. Accept rides quickly when they appear
3. Check network connection
4. Use `/clearcache` if persistent issues

#### 4. Location/Geocoding Issues
**Symptoms**: "Address not found" errors when setting availability
**Solutions**:
- Provide complete addresses with city and state
- Use specific landmarks or business names
- Include street numbers and direction (N, S, E, W)
- Try alternate address formats

### Debug Mode for Drivers

Enable detailed logging for driver operations:

```bash
export DEBUG=true
export SHOW_PROGRESS_TO_USER=true
```

Debug information includes:
- Availability setting process
- Ride matching results
- Database query performance
- Geocoding API responses
- State transition logging

### Performance Monitoring

Key metrics to monitor for driver operations:
- Average time from availability to first ride match
- Ride acceptance rate by location and time
- Availability session duration vs. ride completion
- Driver earnings per hour/session
- Geographic distribution of active drivers

## Future Enhancements

### Planned Driver Features

1. **Advanced Scheduling**
   - Recurring availability schedules
   - Planned break management
   - Shift scheduling integration

2. **Enhanced Earnings**
   - Dynamic pricing suggestions
   - Surge pricing notifications
   - Weekly/monthly earning reports
   - Tax document generation

3. **Driver Performance Tools**
   - Route optimization suggestions
   - Traffic-aware availability zones
   - Performance benchmarking vs. other drivers
   - Customer feedback and ratings

4. **Smart Matching Improvements**
   - Driver preference learning
   - Predictive ride demand
   - Multi-ride batching
   - Premium ride categories

5. **Fleet Management Integration**
   - Vehicle maintenance tracking
   - Fuel expense logging
   - Insurance integration
   - Vehicle inspection reminders

### Technical Improvements

1. **Real-time Features**
   - WebSocket integration for instant notifications
   - Real-time location tracking
   - Live ride status updates
   - Push notification optimization

2. **Advanced Analytics**
   - Machine learning for demand prediction
   - Driver behavior analysis
   - Optimal availability zone suggestions
   - Earnings optimization recommendations

3. **Integration Enhancements**
   - Navigation app integration
   - Payment platform integration
   - Calendar synchronization
   - Fleet management system APIs

## Contributing

### Development Setup for Driver Bot

1. Set up driver-specific environment variables
2. Configure separate driver bot token
3. Set up MongoDB with driver-specific indexes
4. Configure geocoding and notification services
5. Set up Google Cloud Tasks for driver operations

### Testing Driver Functionality

```bash
# Run driver-specific tests
npm run test:driver
npm run test:driver:integration

# Test availability system
npm run test:availability

# Test ride matching
npm run test:matching:driver
```

### Code Standards for Driver Operations

- Use TypeScript types for driver-specific operations
- Implement proper error handling for driver scenarios
- Add comprehensive logging for driver state changes
- Include performance monitoring for availability operations
- Write integration tests for ride matching workflows

---

*Last Updated: January 2024*
*Version: 2.1.0*
*Author: RideEase Development Team*
