# Manual Event Insertion Guide

This guide shows how to manually insert events into MongoDB for A/B testing.

## Prerequisites

1. MongoDB connection string in `.env` file
2. Node.js installed
3. Access to the project directory

## Method 1: Using MongoDB Shell (mongosh)

### Connect to MongoDB

```bash
mongosh "YOUR_MONGODB_URI"
```

### Insert a Recommend Event (Exposure)

```javascript
// Switch to your database
use your_database_name

// Insert a recommend event
db.raw_events.insertOne({
  type: "recommend",
  userId: "user123",
  ts: new Date(),
  payload: {
    items: ["ride-1", "ride-2", "ride-3"]
  }
})
```

### Insert a Play/View Event (Success)

```javascript
// Insert a play event (must be within 15 minutes of recommend event)
db.raw_events.insertOne({
  type: "play",
  userId: "user123",
  itemId: "ride-1",
  ts: new Date(), // Should be within 15 minutes of recommend event
  payload: {}
})
```

### Batch Insert Example

```javascript
// Insert multiple recommend events for control variant
const controlUsers = ["user-0", "user-2", "user-4", "user-6", "user-8"];
const now = new Date();

controlUsers.forEach((userId, index) => {
  db.raw_events.insertOne({
    type: "recommend",
    userId: userId,
    ts: new Date(now.getTime() - (index * 60000)), // 1 minute apart
    payload: {
      items: ["ride-1", "ride-2", "ride-3"]
    }
  });
});

// Insert some successes
db.raw_events.insertOne({
  type: "play",
  userId: "user-0",
  itemId: "ride-1",
  ts: new Date(now.getTime() - 5000), // 5 seconds after recommend
  payload: {}
})
```

---

## Method 2: Using Node.js Script

Create a file `insertEvents.js`:

```javascript
require('dotenv').config();
const mongoose = require('mongoose');

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

async function insertEvents() {
  await mongoose.connect(process.env.MONGODB_URI);
  
  // Insert recommend event
  await RawEvent.create({
    type: 'recommend',
    userId: 'user123',
    ts: new Date(),
    payload: {
      items: ['ride-1', 'ride-2', 'ride-3']
    }
  });
  
  // Insert play event (within 15 minutes)
  await RawEvent.create({
    type: 'play',
    userId: 'user123',
    itemId: 'ride-1',
    ts: new Date(Date.now() + 5 * 60 * 1000), // 5 minutes later
    payload: {}
  });
  
  console.log('Events inserted successfully!');
  await mongoose.disconnect();
}

insertEvents().catch(console.error);
```

Run it:
```bash
cd functions
node insertEvents.js
```

---

## Method 3: Using the Test Script

Use the provided test script:

```bash
cd functions

# Generate 20 exposures per variant with 30% conversion rate
node pipeline/scripts/generateTestEvents.js

# Custom options
node pipeline/scripts/generateTestEvents.js --exposures 50 --conversion 40 --window-hours 2
```

---

## Method 4: Using curl + API (if endpoint exists)

You could create a simple endpoint to insert events, or use the recommendations endpoint which now automatically logs events.

```bash
# This will automatically log a recommend event
curl -X POST http://localhost:8080/recommendations \
  -H 'Content-Type: application/json' \
  -d '{"userId":"user123","limit":5}'
```

---

## Understanding Variants

The variant (control/treatment) is assigned based on userId hash. To check which variant a user belongs to:

### Using Node.js

```javascript
const crypto = require('crypto');

function assignVariant(userId) {
  if (!userId) return 'control';
  const hash = crypto.createHash('sha1').update(String(userId)).digest();
  return hash[0] % 2 === 0 ? 'control' : 'treatment';
}

console.log(assignVariant('user123')); // 'control' or 'treatment'
```

### Test Different Users

```javascript
// Find users that hash to control
for (let i = 0; i < 100; i++) {
  const userId = `user-${i}`;
  if (assignVariant(userId) === 'control') {
    console.log(`${userId} -> control`);
  }
}
```

---

## Verification

After inserting events, check the A/B test results:

```bash
curl 'http://localhost:8080/experiments/rec-engine/summary?windowHours=24'
```

Or check directly in MongoDB:

```javascript
// Count events by type
db.raw_events.aggregate([
  { $group: { _id: "$type", count: { $sum: 1 } } }
])

// Count by variant (requires checking userId hash)
db.raw_events.find({ type: "recommend" }).limit(10)
```

---

## Event Schema Reference

### Recommend Event

```javascript
{
  type: "recommend",           // Required
  userId: "user123",           // Required
  ts: new Date(),              // Required
  payload: {                   // Required
    items: ["item1", "item2"]  // Array of recommended item IDs
  }
}
```

### Play/View Event

```javascript
{
  type: "play",                // or "view" - Required
  userId: "user123",           // Required (must match recommend event)
  itemId: "item1",             // Required (must be in recommended items)
  ts: new Date(),              // Required (within 15 min of recommend)
  payload: {}                  // Optional
}
```

---

## Common Issues

### Events not showing up in A/B test

1. **Check time window**: Events must be within the windowHours parameter (default 24 hours)
2. **Check userId**: Events without userId are filtered out
3. **Check success window**: Play/view events must be within 15 minutes of recommend event
4. **Check itemId**: Play/view itemId must match one of the recommended items

### Need events in both variants

Make sure you have events for users that hash to both control and treatment. Use the test script to ensure balanced distribution.

---

## Clean Up Test Data

```javascript
// Remove test events (be careful!)
db.raw_events.deleteMany({
  "payload.source": "test-script"
})
```

---

## Best Practices

1. **Use realistic timestamps**: Don't create all events at the same time
2. **Maintain balance**: Ensure roughly equal events in control and treatment
3. **Use proper itemIds**: Make sure itemIds in play/view events match recommended items
4. **Respect time windows**: Success events must be within 15 minutes of recommendations
5. **Clean up**: Remove test data when done testing

