const { subscribeToTopic } = require('./kafka');
const notifications = require('./notifications');
const db = require('./database');


async function handleRideRequestedEvent(event, metadata) {
  try {
    console.log('📨 Processing ride requested event:', event.data.rideId);
    
    const { rideId, riderId, pickupLocation, dropLocation, bid, timeOfRide } = event.data;
    
    // Get the full ride object from database
    const Ride = require('../models/ride');
    const ride = await Ride.findById(rideId).populate('riderId');
    
    if (!ride) {
      console.warn(`⚠️ Ride ${rideId} not found in database`);
      return;
    }
    
    // Find and notify drivers
    const matching = require('./matching');
    const matches = await matching.findDriversForRide(ride);
    
    console.log(`🚗 Found ${matches.length} potential drivers for ride ${rideId}`);
    
    // Log analytics data
    console.log('📊 Ride Request Analytics:', {
      rideId,
      pickupLocation: pickupLocation.name,
      dropLocation: dropLocation.name,
      bid,
      timeOfRide,
      potentialDrivers: matches.length,
      timestamp: event.data.timestamp
    });
    
  } catch (error) {
    console.error('❌ Error processing ride requested event:', error.message);
  }
}

/**
 * Handle ride matched events - send notifications
 */
async function handleRideMatchedEvent(event, metadata) {
  try {
    console.log('📨 Processing ride matched event:', event.data.rideId);
    
    const { rideId, driverId, riderId } = event.data;
    
    // Get ride, driver, and rider details
    const Ride = require('../models/ride');
    const Driver = require('../models/driver');
    const Rider = require('../models/rider');
    
    const [ride, driver, rider] = await Promise.all([
      Ride.findById(rideId),
      Driver.findById(driverId),
      Rider.findById(riderId)
    ]);
    
    if (!ride || !driver || !rider) {
      console.warn(`⚠️ Missing data for ride match ${rideId}`);
      return;
    }
    
    // Send notifications using existing notification system
    const matching = require('./matching');
    await matching.notifyRiderOfMatch(rideId, driver);
    
    console.log(`✅ Notified rider ${riderId} about matched ride ${rideId}`);
    
  } catch (error) {
    console.error('❌ Error processing ride matched event:', error.message);
  }
}

/**
 * Handle ride accepted events - finalize matching
 */
async function handleRideAcceptedEvent(event, metadata) {
  try {
    console.log('📨 Processing ride accepted event:', event.data.rideId);
    
    const { rideId, driverId, riderId } = event.data;
    
    // Update ride status to matched
    const Ride = require('../models/ride');
    await Ride.findByIdAndUpdate(rideId, { 
      status: 'matched',
      driverId: driverId
    });
    
    console.log(`✅ Ride ${rideId} status updated to matched`);
    
    // Log analytics
    console.log('📊 Ride Acceptance Analytics:', {
      rideId,
      driverId,
      riderId,
      timestamp: event.data.timestamp
    });
    
  } catch (error) {
    console.error('❌ Error processing ride accepted event:', error.message);
  }
}

/**
 * Handle ride cancelled events - notify affected parties
 */
async function handleRideCancelledEvent(event, metadata) {
  try {
    console.log('📨 Processing ride cancelled event:', event.data.rideId);
    
    const { rideId, cancelledBy, reason } = event.data;
    
    // Get ride details
    const Ride = require('../models/ride');
    const ride = await Ride.findById(rideId).populate('riderId driverId');
    
    if (!ride) {
      console.warn(`⚠️ Ride ${rideId} not found`);
      return;
    }
    
    // Notify relevant parties based on who cancelled
    if (cancelledBy === 'rider' && ride.driverId) {
      // Notify driver that rider cancelled
      await notifications.notifyDriver(
        ride.driverId,
        `❌ Ride Cancelled\n\nRider has cancelled the ride.\nReason: ${reason}\n\nYou can now accept other rides.`
      );
    } else if (cancelledBy === 'driver' && ride.riderId) {
      // Notify rider that driver cancelled
      await notifications.notifyRider(
        ride.riderId,
        `❌ Ride Cancelled\n\nDriver has cancelled the ride.\nReason: ${reason}\n\nYour ride request is now open for other drivers.`
      );
    }
    
    // Update ride status
    await Ride.findByIdAndUpdate(rideId, { status: 'cancelled' });
    
    console.log(`❌ Ride ${rideId} cancelled by ${cancelledBy}: ${reason}`);
    
  } catch (error) {
    console.error('❌ Error processing ride cancelled event:', error.message);
  }
}

/**
 * Handle ride completed events - finalize ride and send notifications
 */
async function handleRideCompletedEvent(event, metadata) {
  try {
    console.log('📨 Processing ride completed event:', event.data.rideId);
    
    const { rideId, driverId, riderId } = event.data;
    
    // Get ride details
    const Ride = require('../models/ride');
    const ride = await Ride.findById(rideId);
    
    if (!ride) {
      console.warn(`⚠️ Ride ${rideId} not found`);
      return;
    }
    
    // Update ride status
    await Ride.findByIdAndUpdate(rideId, { status: 'completed' });
    
    // Send completion notifications
    const Driver = require('../models/driver');
    const Rider = require('../models/rider');
    
    const [driver, rider] = await Promise.all([
      Driver.findById(driverId),
      Rider.findById(riderId)
    ]);
    
    if (driver) {
      await notifications.notifyDriver(
        driver,
        `✅ Ride Completed\n\n📍 ${ride.pickupLocationName} → ${ride.dropLocationName}\n💰 $${ride.bid || 0}\n\nThank you for using RideEase!`
      );
    }
    
    if (rider) {
      await notifications.notifyRider(
        rider,
        `✅ Ride Completed\n\n📍 ${ride.pickupLocationName} → ${ride.dropLocationName}\n💰 $${ride.bid || 0}\n\nThank you for using RideEase!`
      );
    }
    
    console.log(`🏁 Ride ${rideId} completed successfully`);
    
    // Log analytics
    console.log('📊 Ride Completion Analytics:', {
      rideId,
      driverId,
      riderId,
      bid: ride.bid,
      timestamp: event.data.timestamp
    });
    
  } catch (error) {
    console.error('❌ Error processing ride completed event:', error.message);
  }
}

/**
 * Handle driver available events - trigger ride matching
 */
async function handleDriverAvailableEvent(event, metadata) {
  try {
    console.log('📨 Processing driver available event:', event.data.driverId);
    
    const { driverId, location, radius } = event.data;
    
    // Get driver details
    const Driver = require('../models/driver');
    const driver = await Driver.findById(driverId);
    
    if (!driver) {
      console.warn(`⚠️ Driver ${driverId} not found`);
      return;
    }
    
    // Find nearby rides for this driver
    const matching = require('./matching');
    const matches = await matching.findMatchesForDriverAvailability(driver);
    
    console.log(`🚗 Found ${matches.length} nearby rides for driver ${driverId}`);
    
    // Log analytics
    console.log('📊 Driver Availability Analytics:', {
      driverId,
      location: location.coordinates,
      radius,
      nearbyRides: matches.length,
      timestamp: event.data.timestamp
    });
    
  } catch (error) {
    console.error('❌ Error processing driver available event:', error.message);
  }
}

/**
 * Handle driver unavailable events - cleanup
 */
async function handleDriverUnavailableEvent(event, metadata) {
  try {
    console.log('📨 Processing driver unavailable event:', event.data.driverId);
    
    const { driverId } = event.data;
    
    // Log analytics
    console.log('📊 Driver Unavailability Analytics:', {
      driverId,
      timestamp: event.data.timestamp
    });
    
  } catch (error) {
    console.error('❌ Error processing driver unavailable event:', error.message);
  }
}

/**
 * Handle notification sent events - analytics and monitoring
 */
async function handleNotificationSentEvent(event, metadata) {
  try {
    console.log('📨 Processing notification sent event:', event.data.recipientId);
    
    const { recipientId, recipientType, messageType, success } = event.data;
    
    // Log notification analytics
    console.log('📊 Notification Analytics:', {
      recipientId,
      recipientType,
      messageType,
      success,
      timestamp: event.data.timestamp
    });
    
    // Track notification success rates
    if (!success) {
      console.warn(`⚠️ Failed notification: ${messageType} to ${recipientType} ${recipientId}`);
      
      // Could implement retry logic here or alert monitoring systems
    }
    
  } catch (error) {
    console.error('❌ Error processing notification sent event:', error.message);
  }
}

/**
 * Initialize all Kafka consumers
 */
async function initializeConsumers() {
  try {
    console.log('🚀 Initializing Kafka consumers...');
    
    // Ride event consumers
    await Promise.all([
      subscribeToTopic('rideease-ride-requested', handleRideRequestedEvent, 'rideease-ride-consumer'),
      subscribeToTopic('rideease-ride-matched', handleRideMatchedEvent, 'rideease-ride-consumer'),
      subscribeToTopic('rideease-ride-accepted', handleRideAcceptedEvent, 'rideease-ride-consumer'),
      subscribeToTopic('rideease-ride-cancelled', handleRideCancelledEvent, 'rideease-ride-consumer'),
      subscribeToTopic('rideease-ride-completed', handleRideCompletedEvent, 'rideease-ride-consumer'),
      
      // Driver event consumers
      subscribeToTopic('rideease-driver-available', handleDriverAvailableEvent, 'rideease-driver-consumer'),
      subscribeToTopic('rideease-driver-unavailable', handleDriverUnavailableEvent, 'rideease-driver-consumer'),
      
      // Notification event consumers
      subscribeToTopic('rideease-notification-sent', handleNotificationSentEvent, 'rideease-notification-consumer')
    ]);
    
    console.log('✅ All Kafka consumers initialized successfully');
  } catch (error) {
    console.error('❌ Failed to initialize Kafka consumers:', error.message);
    throw error;
  }
}

/**
 * Error handling for consumer failures
 */
function handleConsumerError(error, topic, event) {
  console.error(`❌ Consumer error for topic ${topic}:`, error.message);
  console.error('Event data:', event);
  
  // In production, you might want to:
  // 1. Send to a dead letter queue
  // 2. Alert monitoring systems
  // 3. Implement retry logic
  // 4. Log to external monitoring service
}

module.exports = {
  // Event handlers
  handleRideRequestedEvent,
  handleRideMatchedEvent,
  handleRideAcceptedEvent,
  handleRideCancelledEvent,
  handleRideCompletedEvent,
  handleDriverAvailableEvent,
  handleDriverUnavailableEvent,
  handleNotificationSentEvent,
  
  // Initialization
  initializeConsumers,
  handleConsumerError
};
