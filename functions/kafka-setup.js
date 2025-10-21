#!/usr/bin/env node

/**
 * Kafka Setup Script for RideEase
 * This script helps set up Kafka topics and test the integration
 */

const { initializeTopics, initKafka, publishEvent } = require('./utils/kafka');

async function setupKafka() {
  try {
    console.log('🚀 Setting up Kafka for RideEase...');
    
    // Initialize Kafka client
    await initKafka();
    console.log('✅ Kafka client initialized');
    
    // Create all required topics
    await initializeTopics();
    console.log('✅ All topics created');
    
    console.log('\n📋 Created Topics:');
    console.log('  - rideease-ride-requested');
    console.log('  - rideease-ride-matched');
    console.log('  - rideease-ride-accepted');
    console.log('  - rideease-ride-cancelled');
    console.log('  - rideease-ride-completed');
    console.log('  - rideease-driver-available');
    console.log('  - rideease-driver-unavailable');
    console.log('  - rideease-notification-sent');
    console.log('  - rideease.watch');
    console.log('  - rideease.rate');
    console.log('  - rideease.reco_requests');
    console.log('  - rideease.reco_responses');
    
    console.log('\n✅ Kafka setup completed successfully!');
    console.log('\n💡 Next steps:');
    console.log('  1. Set KAFKA_BROKERS environment variable');
    console.log('  2. Deploy your Firebase Functions');
    console.log('  3. Test the integration with ride requests');
    
  } catch (error) {
    console.error('❌ Kafka setup failed:', error.message);
    process.exit(1);
  }
}

async function testKafka() {
  try {
    console.log('🧪 Testing Kafka integration...');
    
    await initKafka();
    
    // Test publishing a sample event
    const testEvent = {
      rideId: 'test-ride-123',
      riderId: 'test-rider-456',
      pickupLocation: {
        name: 'Test Pickup',
        coordinates: [-74.0059, 40.7128],
        type: 'Point'
      },
      dropLocation: {
        name: 'Test Dropoff',
        coordinates: [-74.0060, 40.7129],
        type: 'Point'
      },
      bid: 25.00,
      timeOfRide: new Date(Date.now() + 3600000).toISOString()
    };
    
    const result = await publishEvent('RIDE_REQUESTED', testEvent);
    console.log('✅ Test event published successfully:', result.eventId);
    
  } catch (error) {
    console.error('❌ Kafka test failed:', error.message);
  }
}

// Command line interface
const command = process.argv[2];

switch (command) {
  case 'setup':
    setupKafka();
    break;
  case 'test':
    testKafka();
    break;
  default:
    console.log('Usage: node kafka-setup.js [setup|test]');
    console.log('');
    console.log('Commands:');
    console.log('  setup  - Initialize Kafka topics');
    console.log('  test   - Test Kafka integration');
    break;
}
