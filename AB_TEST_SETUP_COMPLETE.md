# ✅ A/B Test Event Logging - Setup Complete

All three methods for generating A/B test events are now available!

---

## 🎯 What Was Implemented

### 1. ✅ Automatic Event Logging
The `/recommendations` endpoint now **automatically logs** `recommend` events when recommendations are served.

**Location:** `functions/pipeline/server.js`

**What it does:**
- When a user calls `/recommendations`, a `recommend` event is automatically created
- Event includes: userId, variant (control/treatment), recommended items, timestamp
- No additional code needed - it just works!

**Usage:**
```bash
# This automatically creates a recommend event
curl -X POST http://localhost:8080/recommendations \
  -H 'Content-Type: application/json' \
  -d '{"userId":"user123","limit":5}'
```

---

### 2. ✅ Test Script for Sample Events
A test script that generates realistic A/B test data with configurable parameters.

**Location:** `functions/pipeline/scripts/generateTestEvents.js`

**Usage:**
```bash
cd functions

# Default: 20 exposures per variant, 30% conversion rate
node pipeline/scripts/generateTestEvents.js

# Custom options
node pipeline/scripts/generateTestEvents.js \
  --exposures 50 \
  --conversion 40 \
  --window-hours 2
```

**What it generates:**
- Balanced `recommend` events for control and treatment variants
- `play`/`view` events based on conversion rate
- Events distributed over time window
- Proper itemId matching for success tracking

---

### 3. ✅ Manual Event Insertion Guide
Complete documentation showing multiple methods to manually insert events.

**Location:** `functions/pipeline/scripts/manualEventInsertion.md`

**Methods covered:**
1. MongoDB Shell (mongosh)
2. Node.js script
3. Test script usage
4. API endpoint usage

---

## 🚀 Quick Start Guide

### Option A: Use the Test Script (Easiest)

```bash
cd functions
node pipeline/scripts/generateTestEvents.js --exposures 30 --conversion 35

# Check results
curl 'http://localhost:8080/experiments/rec-engine/summary?windowHours=24'
```

### Option B: Make API Calls (Automatic Logging)

```bash
# Make several recommendation requests
for i in {1..20}; do
  curl -X POST http://localhost:8080/recommendations \
    -H 'Content-Type: application/json' \
    -d "{\"userId\":\"user-$i\",\"limit\":5}" &
done

# Wait a moment, then check results
sleep 2
curl 'http://localhost:8080/experiments/rec-engine/summary?windowHours=24'
```

### Option C: Manual MongoDB Insertion

See `functions/pipeline/scripts/manualEventInsertion.md` for detailed examples.

---

## 📊 Viewing Results

After generating events, check your A/B test results:

```bash
# Local server
curl 'http://localhost:8080/experiments/rec-engine/summary?windowHours=24'

# Public API
curl 'https://00f28457e389.ngrok-free.app/experiments/rec-engine/summary?windowHours=24'
```

**Example Output:**
```json
{
  "windowHours": 24,
  "variants": {
    "control": {
      "version": "v1.0.0",
      "exposures": 20,
      "successes": 6,
      "conversionRate": 0.3
    },
    "treatment": {
      "version": "v1.1.0",
      "exposures": 20,
      "successes": 8,
      "conversionRate": 0.4
    }
  },
  "stats": {
    "z": 0.77,
    "pValue": 0.44,
    "delta": 0.1,
    "ci": { "lower": -0.15, "upper": 0.35 },
    "decision": "keep-running",
    "seDelta": 0.13
  }
}
```

---

## 📝 Event Requirements

### For Statistical Results, You Need:

1. **Exposures** (`recommend` events)
   - At least some events in **both** control and treatment variants
   - Events must have `userId` field
   - Events must be within the time window

2. **Successes** (`play`/`view` events)
   - Must match a `recommend` event for the same user
   - Must occur within **15 minutes** of the recommend event
   - `itemId` must be in the recommended items list

### Current Status Check

If you see:
```json
{
  "exposures": 0,
  "successes": 0,
  "decision": "insufficient-data"
}
```

This means:
- No `recommend` events found, OR
- No `play`/`view` events found matching recommendations

**Solution:** Run the test script or make API calls to generate events.

---

## 🔧 Troubleshooting

### Events not showing up?

1. **Check time window**: Events older than `windowHours` won't be included
   ```bash
   # Try a longer window
   curl '.../experiments/rec-engine/summary?windowHours=48'
   ```

2. **Check MongoDB connection**: Ensure server can connect to MongoDB
   ```bash
   # Check server logs
   tail -f evidence/logs/server.log
   ```

3. **Verify events exist**: Check MongoDB directly
   ```bash
   mongosh "YOUR_MONGODB_URI"
   db.raw_events.count({ type: "recommend" })
   db.raw_events.count({ type: "play" })
   ```

### Need balanced data?

The test script automatically ensures balanced distribution:
- Finds users that hash to control variant
- Finds users that hash to treatment variant
- Creates equal events for both

---

## 📚 Additional Documentation

- **Event Guide:** `AB_TEST_EVENTS_GUIDE.md` - Complete explanation of events
- **Manual Insertion:** `functions/pipeline/scripts/manualEventInsertion.md` - Detailed manual methods
- **Test Script:** `functions/pipeline/scripts/generateTestEvents.js` - Script source code

---

## ✨ Next Steps

1. **Generate test data:**
   ```bash
   cd functions
   node pipeline/scripts/generateTestEvents.js
   ```

2. **Check results:**
   ```bash
   curl 'http://localhost:8080/experiments/rec-engine/summary?windowHours=24'
   ```

3. **Generate more data if needed:**
   ```bash
   node pipeline/scripts/generateTestEvents.js --exposures 100 --conversion 40
   ```

4. **View statistical analysis:**
   - Check `pValue` - statistical significance
   - Check `decision` - "ship", "rollback", or "keep-running"
   - Check `ci` - confidence intervals

---

**All set! You now have three ways to generate A/B test events.** 🎉

