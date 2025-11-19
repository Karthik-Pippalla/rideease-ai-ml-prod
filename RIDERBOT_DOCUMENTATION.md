# RideEase RiderBot Documentation

## Overview

The RiderBot (`functions/riderBot.js`) is a sophisticated Telegram bot designed to handle ride requests for passengers in the RideEase platform. It provides a comprehensive command-based interface with natural language processing capabilities, allowing riders to book rides, manage their profiles, and track ride history through both structured commands and conversational interactions.

## Table of Contents

1. [Core Features](#core-features)
2. [Commands Reference](#commands-reference)
3. [Architecture Overview](#architecture-overview)
4. [Key Components](#key-components)
5. [Database Operations](#database-operations)
6. [Natural Language Processing](#natural-language-processing)
7. [State Management](#state-management)
8. [Error Handling](#error-handling)
9. [Security Features](#security-features)
10. [Performance Optimizations](#performance-optimizations)
11. [Configuration](#configuration)
12. [API Integration](#api-integration)

## Core Features

### 1. User Registration & Profile Management
- **Registration**: New users can register with name, phone, username, and optional addresses
- **Profile Updates**: Modify individual fields or complete profile updates
- **Profile Viewing**: Display comprehensive profile information including ratings and ride statistics
- **Account Deletion**: Secure profile deletion with confirmation requirements

### 2. Ride Management System
- **Ride Requests**: Create new ride requests with pickup, dropoff, time, and bid
- **Active Ride Tracking**: Monitor current ride status (open, matched, in progress)
- **Ride Cancellation**: Cancel pending or matched rides with confirmation
- **Ride Completion**: Mark completed rides and notify drivers
- **Ride History**: View complete ride history with filtering options

### 3. Smart Address Management
- **Address Shortcuts**: Use "home" and "work" shortcuts in ride requests
- **Geocoding Integration**: Automatic address validation and coordinate lookup
- **Address Storage**: Save frequently used addresses for quick access

### 4. Natural Language Processing
- **Intent Detection**: AI-powered understanding of user requests
- **Context Awareness**: Maintains conversation context across interactions
- **Flexible Input**: Accepts both structured commands and natural language

## Commands Reference

### Essential Commands

#### `/start`
- **Purpose**: Initialize bot interaction and display main menu
- **Behavior**: 
  - New users: Shows registration prompt
  - Registered users: Displays personalized main menu
- **Response Time**: Instant
- **Example**: Simply type `/start`

#### `/me`
- **Purpose**: Display complete rider profile information
- **Shows**:
  - Name, phone number, Telegram username
  - User rating and total completed rides
  - Home and work addresses (if set)
  - Current ride status (active/inactive)
  - Account creation date
- **Requirements**: Must be registered
- **Example Output**:
  ```
  👤 Rider Profile
  📝 Name: John Doe
  📞 Phone: +1-555-123-4567
  ⭐ Rating: 4.8/5
  📊 Total Rides: 12
  🏠 Home: 123 Main St Miami FL
  🏢 Work: Downtown Business Plaza
  🟢 Current Status: No active requests
  📅 Member since: 1/15/2024
  ```

### Ride Management Commands

#### `/riderequest`
- **Purpose**: Request a new ride
- **Input Formats**:
  - Structured: `"Pickup: Miami Airport | Drop: Downtown Miami | Bid: $25 | Time: today 6:30 PM"`
  - Natural: `"I need a ride from the airport to downtown at 6pm today for $25"`
  - Shortcuts: `"Take me from home to work at 8am, bid $20"`
- **Features**:
  - Time parsing (supports "now", "today 6pm", "tomorrow 9am", "in 2 hours")
  - Address shortcuts (home/work)
  - Automatic driver matching and notification
  - Prevents duplicate requests
- **Requirements**: Must be registered, no active ride requests

#### `/cancelride`
- **Purpose**: Cancel active ride request
- **Behavior**:
  - Shows current ride details
  - Requires confirmation (Yes/Keep buttons)
  - Works for both "open" and "matched" rides
  - Notifies drivers if ride was matched
- **Safety**: Confirmation dialog prevents accidental cancellation

#### `/completed`
- **Purpose**: Mark current ride as completed
- **Behavior**:
  - Updates ride status to "completed"
  - Records completion timestamp
  - Notifies the assigned driver
  - Updates user statistics
- **Requirements**: Must have a matched or in-progress ride

#### `/rides`
- **Purpose**: View ride history and active requests
- **Display Format**:
  ```
  📋 Your Rides (15)
  
  ✅ Ride 1 (COMPLETED)
     📍 Miami Airport → Downtown Miami
     🕐 Jan 15, 2024, 6:30 PM
     💰 $25
  
  🟡 Ride 2 (OPEN)
     📍 Home → Work
     🕐 Jan 16, 2024, 8:00 AM
     💰 $20
  ```
- **Features**:
  - Status indicators (✅ Completed, 🔄 Matched, 🟡 Open, ❌ Cancelled)
  - Quick action buttons for open rides
  - Pagination (shows last 10 rides)
- **Limitations**: Displays maximum 10 recent rides

### Profile Management Commands

#### `/update`
- **Purpose**: Update profile information
- **Input Methods**:
  1. **Interactive Mode**: Shows buttons for specific fields
  2. **Structured Format**: `Name | Phone | @Username | Home Address | Work Address`
  3. **Natural Language**: `"Update my phone to 555-0123"`
- **Updatable Fields**:
  - Name (2-50 characters, letters/spaces/hyphens/apostrophes)
  - Phone (7-15 digits, various formats supported)
  - Telegram Username (@username format)
  - Home Address (complete address with city/state)
  - Work Address (complete address with city/state)
- **Validation**: Real-time field validation with specific error messages

#### `/erase`
- **Purpose**: Permanently delete rider profile
- **Security Features**:
  - Requires explicit confirmation
  - Shows warning about data loss
  - Irreversible action warning
  - Deletes all associated ride history
- **Confirmation Dialog**:
  ```
  ⚠️ RIDER WARNING
  This will permanently delete your rider profile and all 
  associated data. This action cannot be undone.
  
  Are you sure you want to continue?
  [✅ Yes, Delete] [❌ Cancel]
  ```

### Utility Commands

#### `/help`
- **Purpose**: Display comprehensive command guide
- **Content**:
  - Complete command reference with examples
  - Natural language feature explanation
  - Address shortcut usage guide
  - Troubleshooting tips
  - Pro tips for optimal usage
- **Format**: Well-structured markdown with examples and use cases

#### `/time`
- **Purpose**: Show current date/time with formatting examples
- **Display**:
  ```
  🕐 Current Date & Time
  📅 Today: Wednesday, January 15, 2024
  ⏰ Time: 2:30:45 PM
  
  Time Examples for Rides:
  • "right now" = current time
  • "today 6pm" = today at 6:00 PM
  • "tomorrow 9am" = tomorrow at 9:00 AM
  • "in 2 hours" = 2 hours from now
  
  Timezone: Eastern Time (America/New_York)
  ```
- **Use Case**: Reference for booking rides with specific times

#### `/clearcache`
- **Purpose**: Clear user session cache
- **When to Use**:
  - Bot stuck in registration mode
  - Commands not responding properly
  - State management issues
- **Safety**: Only clears temporary session data, preserves profile
- **Result**: Resets bot to clean state for the user

#### `/natural`
- **Purpose**: Toggle natural language processing mode
- **Modes**:
  - **ON**: AI processes natural language inputs
  - **OFF**: Only commands and buttons work (saves processing tokens)
- **Default**: Natural language mode is OFF by default
- **Token Usage**: When enabled, uses AI processing for all non-command messages

## Architecture Overview

### File Structure and Dependencies

```javascript
// Core Dependencies
const TelegramBot = require("node-telegram-bot-api");
const mongoose = require("mongoose");
const { CloudTasksClient } = require('@google-cloud/tasks');

// Models
const Rider = require("./models/rider");
const Ride = require("./models/ride");
const Driver = require("./models/driver");

// Utilities
const openai = require("./utils/openai");
const geocode = require("./utils/geocode");
const { distanceMiles } = require("./utils/distance");
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
function initRiderBot() {
  // Singleton pattern - returns existing instance if available
  if (riderBot) return riderBot;
  
  // Environment-based configuration
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const usePolling = !process.env.FUNCTIONS_EMULATOR && 
                    process.env.NODE_ENV !== "production";
  
  // Bot creation with polling configuration
  riderBot = new TelegramBot(token, { polling: usePolling });
  
  // Handler setup
  setupRiderCommands(riderBot);
  setupRiderCallbacks(riderBot);
  setupRiderMessageHandlers(riderBot);
  
  return riderBot;
}
```

#### 2. MongoDB Connection Management
```javascript
async function ensureMongoConnection() {
  // Connection state checking
  if (mongoInitialized && mongoose.connection.readyState === 1) {
    return;
  }
  
  // Connection with retry logic and timeouts
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

### 1. Command Handler System

The bot uses a sophisticated command handling system that processes both explicit commands and natural language inputs:

```javascript
function setupRiderCommands(bot) {
  // Command registration with regex patterns
  bot.onText(/^\/start$/, async (msg) => { /* handler */ });
  bot.onText(/^\/me$/, async (msg) => { /* handler */ });
  bot.onText(/^\/riderequest$/, async (msg) => { /* handler */ });
  // ... additional commands
}
```

### 2. Callback Query System

Interactive buttons are handled through callback queries:

```javascript
function setupRiderCallbacks(bot) {
  bot.on("callback_query", async (cbq) => {
    const data = cbq.data;
    const chatId = cbq.message.chat.id;
    
    switch(data) {
      case "register_rider":
        // Handle registration
        break;
      case "request_ride":
        // Handle ride request
        break;
      // ... additional cases
    }
  });
}
```

### 3. Natural Language Processing

The bot integrates with OpenAI for natural language understanding:

```javascript
async function handleNaturalLanguage(bot, msg, text) {
  // AI intent detection
  const intent = await openai.detectIntent(text, "rider");
  
  // Intent-based routing
  switch(intent?.type) {
    case "rider_ride":
      await handleRideRequestFromIntent(bot, msg, intent);
      break;
    case "delete_ride":
      await handleRideCancellation(bot, msg);
      break;
    // ... additional intent handlers
  }
}
```

### 4. State Management

User interaction states are managed through a centralized state system:

```javascript
// State storage and retrieval
state.set(userId, { phase: "request_ride", timestamp: Date.now() });
const currentState = state.get(userId);

// State-based message routing
if (currentState?.phase === "register_rider") {
  await handleRegistration(bot, msg, text);
} else if (currentState?.phase === "request_ride") {
  await handleRideRequest(bot, msg, text);
}
```

## Database Operations

### CRUD Operation Wrapper

All database operations go through a secure wrapper system:

```javascript
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
```

### Example Database Operations

#### User Registration
```javascript
const result = await performRiderCrud("createRider", {
  name: "John Doe",
  phoneNumber: "555-123-4567",
  telegramId: "123456789",
  telegramUsername: "@johndoe",
  homeAddress: "123 Main St Miami FL",
  workAddress: "Downtown Business Plaza"
});
```

#### Ride Request Creation
```javascript
const rideData = {
  riderId: userData.user._id,
  pickupLocationName: "Miami Airport",
  pickupLocation: { type: "Point", coordinates: [-80.290556, 25.79325] },
  dropLocationName: "Downtown Miami",
  dropLocation: { type: "Point", coordinates: [-80.191788, 25.774266] },
  bid: 25,
  timeOfRide: new Date("2024-01-15T18:30:00Z"),
  status: "open"
};

const result = await performRiderCrud("createRideRequest", rideData);
```

## Natural Language Processing

### Intent Detection System

The bot uses OpenAI for sophisticated intent detection:

```javascript
// Example intent detection
const intent = await openai.detectIntent(
  "I need a ride from home to work at 8am tomorrow for $20", 
  "rider"
);

// Expected intent structure:
{
  type: "rider_ride",
  confidence: "high",
  fields: {
    pickup: "home",
    dropoff: "work", 
    time: "tomorrow 8am",
    bid: 20
  },
  timeInterpretation: "Tomorrow, January 16, 2024 at 8:00 AM"
}
```

### Address Shortcut Processing

The bot automatically replaces address shortcuts with actual addresses:

```javascript
function replaceAddressShortcuts(address, userHomeAddress, userWorkAddress) {
  const normalizedAddress = address.toLowerCase().trim();
  
  // Home address replacement
  if (normalizedAddress.includes('home')) {
    if (!userHomeAddress) {
      return { 
        address: null, 
        error: "🏠 Home address not set up yet. Use /update to add your home address first."
      };
    }
    return { address: address.replace(/\bhome\b/gi, userHomeAddress), error: null };
  }
  
  // Work address replacement
  if (normalizedAddress.includes('work')) {
    if (!userWorkAddress) {
      return { 
        address: null, 
        error: "🏢 Work address not set up yet. Use /update to add your work address first."
      };
    }
    return { address: address.replace(/\bwork\b/gi, userWorkAddress), error: null };
  }
  
  return { address, error: null };
}
```

## State Management

### State Structure

User states are managed with the following structure:

```javascript
// State object structure
{
  phase: "register_rider" | "request_ride" | "update_rider" | "update_specific_field",
  timestamp: 1705123456789,
  naturalLanguageMode: true | false,
  fieldName: "phoneNumber" | "name" | "homeAddress" | "workAddress" | "telegramUsername",
  previousState: { /* backup state */ }
}
```

### State Transitions

```javascript
// Registration flow
state.set(userId, { phase: "register_rider" });

// Ride request flow
state.set(userId, { 
  phase: "request_ride", 
  timestamp: Date.now() 
});

// Profile update flow
state.set(userId, { 
  phase: "update_specific_field", 
  fieldName: "phoneNumber" 
});

// Clear state after completion
state.clear(userId);
```

### Session Timeout Management

```javascript
// Automatic session timeout checking
await state.checkUserTimeout(userId);

// Timeout configuration
const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes
```

## Error Handling

### Error Types and Messages

The bot provides specific error messages for different failure scenarios:

```javascript
async function sendError(chatId, err, hint) {
  let userMessage = hint || "An error occurred.";
  
  // Specific error type handling
  if (err.message.includes('validation')) {
    userMessage = "❌ Registration validation failed. Please check your input format.";
  } else if (err.message.includes('phone')) {
    userMessage = "❌ Phone number format is invalid. Please use a valid phone number.";
  } else if (err.message.includes('address')) {
    userMessage = "❌ Address format is invalid. Please provide a complete address.";
  }
  
  await riderBot.sendMessage(chatId, `⚠️ ${userMessage}`, getErrorButtons());
}
```

### Error Recovery Options

Users are provided with recovery options after errors:

```javascript
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
```

## Security Features

### Input Sanitization

All user inputs are sanitized before processing:

```javascript
function sanitizeForLogging(data) {
  const sanitized = JSON.parse(JSON.stringify(data));
  const sensitiveFields = ['phoneNumber', 'telegramId', 'address', 'homeAddress', 'workAddress'];
  
  function recursiveSanitize(obj) {
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
```

### Rate Limiting

Built-in rate limiting prevents abuse:

```javascript
// Rate limit checking before processing
const rateLimitResult = checkRateLimit(userId, 'ride_request');
if (!rateLimitResult.allowed) {
  return bot.sendMessage(chatId, 
    `⏳ Rate limit exceeded. Please wait ${rateLimitResult.waitTime} seconds.`);
}
```

### Validation System

Comprehensive validation for all user inputs:

```javascript
// Registration validation example
const validationResult = validation.validateRiderRegistration({
  name,
  phoneNumber,
  telegramUsername,
  homeAddress,
  workAddress
});

if (!validationResult.isValid) {
  return bot.sendMessage(chatId,
    `❌ Validation Error:\n${validationResult.errors.map(err => `• ${err}`).join('\n')}`);
}
```

## Performance Optimizations

### Response Time Management

The bot provides user feedback about processing times:

```javascript
const MESSAGES = {
  RESPONSE_TIME: "⏱️ *Response time: 3-45 seconds due to AI processing*"
};

// Add response time info to messages requiring AI processing
function formatMessage(message) {
  return `${message}\n\n${MESSAGES.RESPONSE_TIME}`;
}
```

### Temporary Message Management

Status messages are automatically cleaned up:

```javascript
const tempMessages = new Map();

// Store temporary message for later deletion
const sentMessage = await bot.sendMessage(chatId, statusMessage);
tempMessages.set(chatId, sentMessage.message_id);

// Auto-delete after timeout
setTimeout(async () => {
  const currentMessageId = tempMessages.get(chatId);
  if (currentMessageId === sentMessage.message_id) {
    await bot.deleteMessage(chatId, sentMessage.message_id);
    tempMessages.delete(chatId);
  }
}, 20000);
```

### Database Query Optimization

Efficient database queries with proper indexing:

```javascript
// Optimized active ride checking
const rideResult = await db.getRidesByUser(userId, "rider");
const activeRides = rideResult?.success ? 
  rideResult.data?.filter(ride => 
    ride.status === "open" || ride.status === "matched"
  ) : [];
```

### Connection Pool Management

MongoDB connection pooling for better performance:

```javascript
await mongoose.connect(uri, {
  maxPoolSize: 10, // Maintain up to 10 socket connections
  serverSelectionTimeoutMS: 30_000,
  socketTimeoutMS: 45_000,
  bufferCommands: false
});
```

## Configuration

### Environment Variables

Required environment variables:

```bash
# Telegram Bot Configuration
TELEGRAM_BOT_TOKEN=your_telegram_bot_token

# Database Configuration
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/database
MONGODB_DB=rideease

# AI Processing
OPENAI_API_KEY=your_openai_api_key

# Geographic Services
GEOCODING_API_KEY=your_geocoding_service_key

# Application Environment
NODE_ENV=development|production
DEBUG=true|false
SHOW_PROGRESS_TO_USER=true|false

# Timezone Configuration
TZ=America/New_York
```

### Bot Configuration Options

```javascript
// Polling vs Webhook configuration
const usePolling = !process.env.FUNCTIONS_EMULATOR && 
                  process.env.NODE_ENV !== "production";

// Debug mode configuration
const DEBUG = process.env.DEBUG === "true" || 
              process.env.NODE_ENV === "development";

// User progress display
const SHOW_PROGRESS_TO_USER = process.env.SHOW_PROGRESS_TO_USER === "true" || DEBUG;
```

## API Integration

### External Service Integration

#### 1. Geocoding Service
```javascript
// Address geocoding for ride requests
const geocodedPickup = await geocode.geocodeAddress(pickupAddress);
const geocodedDropoff = await geocode.geocodeAddress(dropoffAddress);

// Result structure:
{
  name: "Miami International Airport",
  lat: 25.79325,
  lon: -80.290556,
  formatted_address: "2100 NW 42nd Ave, Miami, FL 33126, USA"
}
```

#### 2. OpenAI Integration
```javascript
// Natural language intent detection
const intent = await openai.detectIntent(userMessage, "rider");

// Response structure:
{
  type: "rider_ride",
  confidence: "high|medium|low",
  fields: {
    pickup: "address or shortcut",
    dropoff: "address or shortcut",
    time: "time expression",
    bid: number
  },
  timeInterpretation: "human readable time"
}
```

#### 3. Notification System
```javascript
// Driver notification for new ride requests
await notifications.notifyDriver(driver, message, options);

// Rider notification for ride updates
await notifications.notifyRider(rider, message, options);
```

### Cloud Tasks Integration

```javascript
// Asynchronous task processing
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
```

## Troubleshooting Guide

### Common Issues and Solutions

#### 1. Bot Not Responding
**Symptoms**: Commands not working, no response from bot
**Solutions**:
- Check `/clearcache` command
- Verify MongoDB connection
- Check bot token validity
- Review error logs

#### 2. Registration Failures
**Symptoms**: Registration validation errors
**Common Causes**:
- Invalid phone number format
- Missing @ in username
- Name contains invalid characters
- Address too short or invalid

**Solutions**:
- Use proper format: `Name | Phone | @Username | Home | Work`
- Ensure phone number has 7+ digits
- Include @ before username
- Provide complete addresses

#### 3. Natural Language Not Working
**Symptoms**: Bot doesn't understand natural language
**Solutions**:
- Enable natural language mode with `/natural`
- Check OpenAI API key configuration
- Verify API quota and billing
- Use structured commands as fallback

#### 4. Geocoding Failures
**Symptoms**: "Address not found" errors
**Solutions**:
- Provide more specific addresses
- Include city and state information
- Check geocoding service API key
- Use complete street addresses

### Debug Mode

Enable debug mode for detailed logging:

```bash
export DEBUG=true
export SHOW_PROGRESS_TO_USER=true
```

Debug output includes:
- Command processing steps
- Database query results  
- API call responses
- State transitions
- Error stack traces

### Performance Monitoring

Monitor these key metrics:
- Response time to user commands
- Database query execution time
- API call latency
- Error rates by command type
- Active user sessions

## Future Enhancements

### Planned Features

1. **Advanced Scheduling**
   - Recurring ride requests
   - Calendar integration
   - Smart time suggestions

2. **Enhanced Matching**
   - Preference-based driver matching
   - Route optimization
   - Multi-stop ride support

3. **Payment Integration**
   - In-app payment processing
   - Automatic billing
   - Receipt generation

4. **Social Features**
   - Ride sharing with friends
   - Group ride requests
   - Social proof and reviews

5. **Analytics Dashboard**
   - Personal ride statistics
   - Spending analytics
   - Carbon footprint tracking

### Technical Improvements

1. **Performance Optimizations**
   - Redis caching layer
   - Database query optimization
   - Response time improvements

2. **Security Enhancements**
   - Enhanced input validation
   - Rate limiting improvements
   - Security audit logging

3. **Scalability Features**
   - Horizontal scaling support
   - Load balancing
   - Regional deployment

## Contributing

### Development Setup

1. Clone the repository
2. Install dependencies: `npm install`
3. Set up environment variables
4. Configure MongoDB connection
5. Set up Telegram bot token
6. Run in development mode

### Code Standards

- Use ESLint and Prettier for code formatting
- Follow async/await patterns
- Include comprehensive error handling
- Add JSDoc comments for functions
- Write unit tests for new features

### Testing

Run the test suite:
```bash
npm test
npm run test:integration
npm run test:e2e
```

### Pull Request Process

1. Create feature branch from main
2. Implement changes with tests
3. Update documentation
4. Submit pull request with detailed description
5. Address code review feedback

---

*Last Updated: January 2024*
*Version: 2.1.0*
*Author: RideEase Development Team*
