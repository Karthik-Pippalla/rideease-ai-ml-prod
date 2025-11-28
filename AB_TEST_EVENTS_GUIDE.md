# A/B Test Events Guide

## Overview
The A/B test needs specific event types to calculate statistical results. Events are stored in MongoDB's `raw_events` collection and tracked over a time window (default: 24 hours).

---

## Required Event Types

### 1. **`recommend` Events** (Exposures)
These events count as **exposures** - when a user is shown recommendations.

**Required Fields:**
```json
{
  "type": "recommend",
  "userId": "user123",
  "ts": "2025-11-28T16:00:00Z",
  "payload": {
    "items": ["item1", "item2", "item3"]
  }
}
```

**Or with itemId:**
```json
{
  "type": "recommend",
  "userId": "user123",
  "itemId": "item1",
  "ts": "2025-11-28T16:00:00Z",
  "payload": {
    "items": [
      {"itemId": "item1"},
      {"itemId": "item2"}
    ]
  }
}
```

**What counts:**
- Each `recommend` event = 1 exposure for that user's variant (control/treatment)
- The variant is automatically assigned based on `userId` hash
- All recommended items are stored in a time window (default: 15 minutes)

---

### 2. **`play` or `view` Events** (Successes/Conversions)
These events count as **successes** - when a user interacts with a recommended item.

**Required Fields:**
```json
{
  "type": "play",  // or "view"
  "userId": "user123",
  "itemId": "item1",
  "ts": "2025-11-28T16:05:00Z"
}
```

**What counts:**
- Success = user plays/views an item that was recommended within the success window (15 minutes)
- Must match the same `userId` as the `recommend` event
- Must occur within 15 minutes of the recommendation
- The item must be in the recommended items list

---

## Success Window

**Default:** 15 minutes (configurable via `REC_SUCCESS_MINUTES` env var)

If a user gets a recommendation at 16:00:00, any `play` or `view` event before 16:15:00 for that user counts as a conversion.

---

## Statistical Calculations

The system calculates:
1. **Exposures**: Total `recommend` events per variant
2. **Successes**: Total `play`/`view` events that match recommendations within 15 minutes
3. **Conversion Rate**: `successes / exposures`
4. **Statistical Test**: Two-proportion z-test comparing control vs treatment
5. **Decision**: 
   - `ship` - Treatment is significantly better (p < 0.05, delta > 0)
   - `rollback` - Treatment is significantly worse (p < 0.05, delta < 0)
   - `keep-running` - Not enough data or no significant difference

---

## How to Generate Test Data

### Option 1: Via Kafka (Production)
Events should be published to Kafka topic (default: `app-events`), then ingested into MongoDB via the ingest pipeline.

### Option 2: Direct MongoDB Insert (Testing)
You can directly insert events into MongoDB for testing:

```javascript
// Connect to MongoDB
const mongoose = require('mongoose');
await mongoose.connect(process.env.MONGODB_URI);

// Define schema
const RawEventSchema = new mongoose.Schema({
  key: String,
  type: String,
  userId: String,
  itemId: String,
  ts: Date,
  payload: Object,
}, { strict: false });

const RawEvent = mongoose.model('RawEvent', RawEventSchema, 'raw_events');

// Create a recommend event (exposure)
await RawEvent.create({
  type: 'recommend',
  userId: 'user123',
  ts: new Date(),
  payload: {
    items: ['ride1', 'ride2', 'ride3']
  }
});

// Create a play event (success) - must be within 15 minutes
await RawEvent.create({
  type: 'play',
  userId: 'user123',
  itemId: 'ride1',
  ts: new Date(Date.now() + 5 * 60 * 1000) // 5 minutes later
});
```

### Option 3: Via API (Automatic Logging) ✅
The `/recommendations` endpoint now automatically logs `recommend` events when recommendations are served. Each API call creates a `recommend` event in the `raw_events` collection.

---

## Example: Complete A/B Test Flow

### Step 1: User gets recommendations (exposure)
```
Event: recommend
User: user123 (assigned to "control" variant)
Time: 16:00:00
Items: [ride1, ride2, ride3]
```

### Step 2: User interacts with recommendation (success)
```
Event: play
User: user123
Item: ride1
Time: 16:05:00 (within 15-minute window)
```

### Step 3: Check A/B results
```bash
curl 'https://00f28457e389.ngrok-free.app/experiments/rec-engine/summary?windowHours=24'
```

**Expected Output:**
```json
{
  "windowHours": 24,
  "variants": {
    "control": {
      "version": "v1.0.0",
      "exposures": 10,
      "successes": 3,
      "conversionRate": 0.3
    },
    "treatment": {
      "version": "v1.1.0",
      "exposures": 10,
      "successes": 5,
      "conversionRate": 0.5
    }
  },
  "stats": {
    "z": 1.29,
    "pValue": 0.197,
    "delta": 0.2,
    "ci": { "lower": -0.1, "upper": 0.5 },
    "decision": "keep-running",
    "seDelta": 0.15
  }
}
```

---

## Minimum Data Requirements

**To get statistical results:**
- Need events in **both** control AND treatment buckets
- Need at least some `recommend` events (exposures)
- Need at least some `play`/`view` events (successes) within 15 minutes

**Current Status:**
- `exposures: 0` = No `recommend` events found
- `successes: 0` = No `play`/`view` events found matching recommendations
- `decision: "insufficient-data"` = Not enough data for statistical test

---

## Quick Test Script

Create test events:

```bash
# You'll need to create a script that:
# 1. Connects to MongoDB
# 2. Creates recommend events for different users
# 3. Creates play/view events for some of them
# 4. Checks the experiment summary
```

Or use a MongoDB client to insert events directly:

```javascript
// Insert 10 control exposures
for (let i = 0; i < 10; i++) {
  await RawEvent.create({
    type: 'recommend',
    userId: `user-${i * 2}`, // Even hash = control
    ts: new Date(),
    payload: { items: ['ride1', 'ride2'] }
  });
}

// Insert 10 treatment exposures  
for (let i = 0; i < 10; i++) {
  await RawEvent.create({
    type: 'recommend',
    userId: `user-${i * 2 + 1}`, // Odd hash = treatment
    ts: new Date(),
    payload: { items: ['ride1', 'ride2'] }
  });
}

// Insert some successes (within 15 minutes)
await RawEvent.create({
  type: 'play',
  userId: 'user-0', // control user
  itemId: 'ride1',
  ts: new Date(Date.now() + 5 * 60 * 1000)
});
```

---

## Notes

- Variant assignment is deterministic (based on userId SHA1 hash)
- Same userId always gets same variant
- Time window is configurable (default 24 hours for summary, 15 minutes for success)
- Events must have `userId` to be counted (filtered out if missing)

