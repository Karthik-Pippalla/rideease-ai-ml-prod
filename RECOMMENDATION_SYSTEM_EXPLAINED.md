# What Are Recommendations in RideEase?

## Overview

The recommendation system in RideEase is a **generic popularity-based recommender** that's part of the MLOps pipeline. Currently, it's a **framework/placeholder** that can be customized for different use cases.

---

## Current Implementation

### What It Does

The recommendation system:
1. **Tracks user interactions** via `view` and `play` events with `itemId`
2. **Builds popularity counts** - counts how many times each item was viewed/played
3. **Recommends top items** - returns the most popular items sorted by interaction count
4. **Supports A/B testing** - compares different model versions

### Current Model Structure

```javascript
{
  modelName: "rideease-recommender",
  version: "v1.0.0",
  counts: {
    "item-1": 15,  // popularity count
    "item-2": 12,
    "item-3": 8,
    // ... more items
  }
}
```

**Recommendations returned:**
```json
{
  "recommendations": [
    { "itemId": "item-1", "score": 15 },
    { "itemId": "item-2", "score": 12 },
    { "itemId": "item-3", "score": 8 }
  ]
}
```

---

## What Could Be Recommended in RideEase?

Since RideEase is a **ride-sharing application**, the recommendation system could be customized to recommend:

### 1. **Popular Ride Routes**
- Frequent pickup → dropoff combinations
- Example: "Times Square → JFK Airport"
- `itemId` = route identifier (e.g., `"times-square-jfk"`)

### 2. **Popular Pickup/Dropoff Locations**
- Most requested locations
- Example: `"itemId": "grand-central-station"`
- Could suggest locations based on user's home/work

### 3. **Drivers (For Riders)**
- Highly-rated drivers
- Example: `"itemId": "driver-123"`
- **Note:** Current RideEase uses a matching system, not recommendations for drivers

### 4. **Ride Options**
- Different ride types or pricing tiers
- Example: `"itemId": "economy"`, `"itemId": "premium"`

### 5. **Popular Destinations**
- Based on historical ride data
- Example: `"itemId": "airport"`, `"itemId": "downtown"`

---

## Current Status: Generic Framework

Right now, the recommendation system is **not fully customized** for RideEase. It's a generic MLOps framework that:

✅ **Works as a system:**
- Tracks interactions (`view`/`play` events)
- Builds popularity models
- Serves recommendations
- Supports A/B testing

❌ **Not customized:**
- ItemIds are generic (e.g., `"ride-1"`, `"ride-2"` in test data)
- No integration with actual RideEase ride matching
- No real ride data feeding the model

---

## How It Works (Current Implementation)

### Training
```javascript
// From train.js
// Counts interactions from events
for (const e of events) {
  if (e.type === 'view' || e.type === 'play') {
    counts[e.itemId] = (counts[e.itemId] || 0) + 1;
  }
}
// Most popular items become recommendations
```

### Serving
```javascript
// From serve.js
// Returns top N items by popularity
const entries = Object.entries(model.counts);
entries.sort((a, b) => b[1] - a[1]);  // Sort by count
const recommendations = entries.slice(0, n);
```

### API
```bash
POST /recommendations
{
  "userId": "user123",
  "limit": 5
}

Response:
{
  "recommendations": [
    { "itemId": "popular-item-1", "score": 50 },
    { "itemId": "popular-item-2", "score": 45 }
  ]
}
```

---

## Real-World Integration Example

To make this work for RideEase, you could:

### Step 1: Define What to Recommend
```javascript
// Example: Recommend popular pickup locations
// itemId = "location:grand-central-station"
// itemId = "location:times-square"
```

### Step 2: Generate Events from Real Data
```javascript
// When a rider requests a ride from a location:
await RawEvent.create({
  type: 'view',
  userId: riderId,
  itemId: 'location:grand-central-station',
  ts: new Date()
});

// When a rider actually books from that location:
await RawEvent.create({
  type: 'play',
  userId: riderId,
  itemId: 'location:grand-central-station',
  ts: new Date()
});
```

### Step 3: Train Model
```bash
npm run pipeline:train
# Model learns which locations are popular
```

### Step 4: Serve Recommendations
```bash
# User gets recommendations for popular locations
curl -X POST /recommendations -d '{"userId":"rider123"}'
# Returns: ["location:times-square", "location:jfk", ...]
```

---

## Current Test Data

In the test script, we use generic itemIds:
```javascript
const itemIds = ['ride-1', 'ride-2', 'ride-3', 'ride-4', 'ride-5'];
```

These are **placeholder items** - they could represent:
- Routes
- Locations  
- Drivers
- Ride types
- Anything with an identifier

---

## Summary

**What are recommendations?**
- Currently: Generic items with popularity scores
- Framework: Popularity-based recommender system
- Status: Working but not customized for RideEase domain

**What could they be?**
- Popular ride routes
- Popular locations
- Popular drivers
- Ride options
- Customized based on your use case

**The system is ready** - you just need to:
1. Define what "items" mean for RideEase
2. Generate real events with real itemIds
3. Train models on real data
4. Customize the recommendation logic if needed

---

## Checking Your Current Recommendations

```bash
# Make a request
curl -X POST http://localhost:8080/recommendations \
  -H 'Content-Type: application/json' \
  -d '{"userId":"demo-user","limit":5}'

# Response shows:
# - itemId: The item identifier
# - score: Popularity count (interactions)
```

If the model is empty or has no data, recommendations will be `[]` (empty array).

---

**The recommendation system is a flexible framework - it can recommend anything you define as an "item" with itemIds!**

