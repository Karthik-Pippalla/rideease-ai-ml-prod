#!/usr/bin/env node
/**
 * Generate test events for A/B testing
 * 
 * This script creates sample 'recommend' and 'play'/'view' events
 * to populate the A/B test with data.
 * 
 * Usage:
 *   node pipeline/scripts/generateTestEvents.js [options]
 * 
 * Options:
 *   --exposures N      Number of recommend events per variant (default: 20)
 *   --conversion N     Conversion rate percentage (default: 30)
 *   --window-hours N   Time window in hours for events (default: 1)
 */

require('dotenv').config();
const { connect, disconnect } = require('../db');
const { RawEvent } = require('../ingest');
const { assignVariant } = require('../experimentation');

async function generateTestEvents({ 
  exposuresPerVariant = 20, 
  conversionRate = 0.3,
  windowHours = 1 
} = {}) {
  await connect();
  
  const now = new Date();
  const startTime = new Date(now.getTime() - windowHours * 60 * 60 * 1000);
  const events = [];
  const itemIds = ['ride-1', 'ride-2', 'ride-3', 'ride-4', 'ride-5'];
  
  // Generate users for control and treatment
  const controlUsers = [];
  const treatmentUsers = [];
  let userId = 0;
  
  // Find users that hash to control vs treatment
  while (controlUsers.length < exposuresPerVariant || treatmentUsers.length < exposuresPerVariant) {
    const testUserId = `test-user-${userId}`;
    const variant = assignVariant(testUserId);
    
    if (variant === 'control' && controlUsers.length < exposuresPerVariant) {
      controlUsers.push(testUserId);
    } else if (variant === 'treatment' && treatmentUsers.length < exposuresPerVariant) {
      treatmentUsers.push(testUserId);
    }
    
    userId++;
    
    // Safety limit
    if (userId > 10000) {
      console.error('Could not find enough users for both variants');
      break;
    }
  }
  
  console.log(`📊 Generating events:`);
  console.log(`   Control users: ${controlUsers.length}`);
  console.log(`   Treatment users: ${treatmentUsers.length}`);
  console.log(`   Conversion rate: ${(conversionRate * 100).toFixed(0)}%`);
  
  // Generate recommend events (exposures)
  const recommendEvents = [];
  
  // Control exposures
  for (const userId of controlUsers) {
    const timeOffset = Math.random() * windowHours * 60 * 60 * 1000;
    const ts = new Date(startTime.getTime() + timeOffset);
    const recommendedItems = itemIds.slice(0, 3 + Math.floor(Math.random() * 3));
    
    recommendEvents.push({
      type: 'recommend',
      userId,
      ts,
      payload: {
        items: recommendedItems,
        source: 'test-script',
      },
    });
  }
  
  // Treatment exposures
  for (const userId of treatmentUsers) {
    const timeOffset = Math.random() * windowHours * 60 * 60 * 1000;
    const ts = new Date(startTime.getTime() + timeOffset);
    const recommendedItems = itemIds.slice(0, 3 + Math.floor(Math.random() * 3));
    
    recommendEvents.push({
      type: 'recommend',
      userId,
      ts,
      payload: {
        items: recommendedItems,
        source: 'test-script',
      },
    });
  }
  
  // Insert recommend events
  console.log(`\n📤 Creating ${recommendEvents.length} recommend events...`);
  await RawEvent.insertMany(recommendEvents);
  console.log(`✅ Created recommend events`);
  
  // Generate play/view events (successes) - within 15 minute window
  const playEvents = [];
  const successWindowMs = 15 * 60 * 1000; // 15 minutes
  
  // Determine which users will have successes
  const controlSuccessCount = Math.floor(controlUsers.length * conversionRate);
  const treatmentSuccessCount = Math.floor(treatmentUsers.length * conversionRate);
  
  // Control successes
  const controlSuccessUsers = controlUsers
    .sort(() => Math.random() - 0.5)
    .slice(0, controlSuccessCount);
  
  for (const userId of controlSuccessUsers) {
    const recommendEvent = recommendEvents.find(e => e.userId === userId && e.type === 'recommend');
    if (!recommendEvent) continue;
    
    // Play event within 15 minutes
    const playOffset = Math.random() * Math.min(successWindowMs, windowHours * 60 * 60 * 1000);
    const playTs = new Date(recommendEvent.ts.getTime() + playOffset);
    
    // Random item from recommendations
    const items = recommendEvent.payload?.items || itemIds;
    const playedItem = items[Math.floor(Math.random() * items.length)];
    
    playEvents.push({
      type: Math.random() > 0.5 ? 'play' : 'view',
      userId,
      itemId: playedItem,
      ts: playTs,
      payload: {
        source: 'test-script',
      },
    });
  }
  
  // Treatment successes (can have different conversion rate)
  const treatmentSuccessUsers = treatmentUsers
    .sort(() => Math.random() - 0.5)
    .slice(0, treatmentSuccessCount);
  
  for (const userId of treatmentSuccessUsers) {
    const recommendEvent = recommendEvents.find(e => e.userId === userId && e.type === 'recommend');
    if (!recommendEvent) continue;
    
    const playOffset = Math.random() * Math.min(successWindowMs, windowHours * 60 * 60 * 1000);
    const playTs = new Date(recommendEvent.ts.getTime() + playOffset);
    
    const items = recommendEvent.payload?.items || itemIds;
    const playedItem = items[Math.floor(Math.random() * items.length)];
    
    playEvents.push({
      type: Math.random() > 0.5 ? 'play' : 'view',
      userId,
      itemId: playedItem,
      ts: playTs,
      payload: {
        source: 'test-script',
      },
    });
  }
  
  // Insert play/view events
  if (playEvents.length > 0) {
    console.log(`\n📤 Creating ${playEvents.length} play/view events...`);
    await RawEvent.insertMany(playEvents);
    console.log(`✅ Created play/view events`);
  }
  
  console.log(`\n✅ Test events generated successfully!`);
  console.log(`\n📊 Summary:`);
  console.log(`   Total recommend events: ${recommendEvents.length}`);
  console.log(`   Total play/view events: ${playEvents.length}`);
  console.log(`   Expected control conversions: ${controlSuccessCount}`);
  console.log(`   Expected treatment conversions: ${treatmentSuccessCount}`);
  console.log(`\n💡 Run this to check A/B test results:`);
  console.log(`   curl 'http://localhost:8080/experiments/rec-engine/summary?windowHours=${windowHours + 1}'`);
}

// Parse command line arguments
const args = process.argv.slice(2);
const options = {};

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--exposures' && args[i + 1]) {
    options.exposuresPerVariant = parseInt(args[i + 1], 10);
    i++;
  } else if (args[i] === '--conversion' && args[i + 1]) {
    options.conversionRate = parseInt(args[i + 1], 10) / 100;
    i++;
  } else if (args[i] === '--window-hours' && args[i + 1]) {
    options.windowHours = parseInt(args[i + 1], 10);
    i++;
  }
}

generateTestEvents(options)
  .then(() => disconnect())
  .catch((err) => {
    console.error('Failed to generate test events:', err);
    disconnect().finally(() => process.exit(1));
  });

