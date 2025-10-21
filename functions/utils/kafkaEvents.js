const { rideEvents, driverEvents, notificationEvents } = require('./kafka');

/**
 * Kafka Event Producers for RideEase
 * These functions integrate Kafka event streaming with the existing application logic
 */

/**
 * Publish ride request event
 */
async function publishRideRequestEvent(ride) {
  try {
    const eventData = {
      rideId: ride._id.toString(),
      riderId: ride.riderId.toString(),
      pickupLocation: {
        name: ride.pickupLocationName,
        coordinates: ride.pickupLocation.coordinates,
        type: ride.pickupLocation.type
      },
      dropLocation: {
        name: ride.dropLocationName,
        coordinates: ride.dropLocation.coordinates,
        type: ride.dropLocation.type
      },
      bid: ride.bid || 0,
      timeOfRide: ride.timeOfRide.toISOString(),
      notes: ride.notes || ''
    };

    const result = await rideEvents.requestRide(eventData);
    console.log(`🚗 Published ride request event for ride ${ride._id}`);
    return result;
  } catch (error) {
    console.error('❌ Failed to publish ride request event:', error.message);
    // Don't throw - this shouldn't break the main flow
    return { success: false, error: error.message };
  }
}

/**
 * Publish ride matched event
 */
async function publishRideMatchedEvent(rideId, driverId, riderId) {
  try {
    const eventData = {
      rideId: rideId.toString(),
      driverId: driverId.toString(),
      riderId: riderId.toString()
    };

    const result = await rideEvents.matchRide(eventData);
    console.log(`✅ Published ride matched event for ride ${rideId}`);
    return result;
  } catch (error) {
    console.error('❌ Failed to publish ride matched event:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Publish ride accepted event
 */
async function publishRideAcceptedEvent(rideId, driverId, riderId) {
  try {
    const eventData = {
      rideId: rideId.toString(),
      driverId: driverId.toString(),
      riderId: riderId.toString()
    };

    const result = await rideEvents.acceptRide(eventData);
    console.log(`🎯 Published ride accepted event for ride ${rideId}`);
    return result;
  } catch (error) {
    console.error('❌ Failed to publish ride accepted event:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Publish ride cancelled event
 */
async function publishRideCancelledEvent(rideId, cancelledBy, reason = 'No reason provided') {
  try {
    const eventData = {
      rideId: rideId.toString(),
      cancelledBy, // 'rider', 'driver', or 'system'
      reason
    };

    const result = await rideEvents.cancelRide(eventData);
    console.log(`❌ Published ride cancelled event for ride ${rideId} by ${cancelledBy}`);
    return result;
  } catch (error) {
    console.error('❌ Failed to publish ride cancelled event:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Publish ride completed event
 */
async function publishRideCompletedEvent(rideId, driverId, riderId) {
  try {
    const eventData = {
      rideId: rideId.toString(),
      driverId: driverId.toString(),
      riderId: riderId.toString()
    };

    const result = await rideEvents.completeRide(eventData);
    console.log(`🏁 Published ride completed event for ride ${rideId}`);
    return result;
  } catch (error) {
    console.error('❌ Failed to publish ride completed event:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Publish driver available event
 */
async function publishDriverAvailableEvent(driverId, location, radius) {
  try {
    const eventData = {
      driverId: driverId.toString(),
      location: {
        coordinates: location.coordinates,
        type: location.type
      },
      radius
    };

    const result = await driverEvents.markAvailable(eventData);
    console.log(`🚗 Published driver available event for driver ${driverId}`);
    return result;
  } catch (error) {
    console.error('❌ Failed to publish driver available event:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Publish driver unavailable event
 */
async function publishDriverUnavailableEvent(driverId) {
  try {
    const eventData = {
      driverId: driverId.toString()
    };

    const result = await driverEvents.markUnavailable(eventData);
    console.log(`🚫 Published driver unavailable event for driver ${driverId}`);
    return result;
  } catch (error) {
    console.error('❌ Failed to publish driver unavailable event:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Publish notification sent event
 */
async function publishNotificationSentEvent(recipientId, recipientType, messageType, success) {
  try {
    const eventData = {
      recipientId: recipientId.toString(),
      recipientType, // 'rider' or 'driver'
      messageType, // 'ride-matched', 'ride-cancelled', etc.
      success
    };

    const result = await notificationEvents.sendNotification(eventData);
    console.log(`📨 Published notification sent event for ${recipientType} ${recipientId}`);
    return result;
  } catch (error) {
    console.error('❌ Failed to publish notification sent event:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Enhanced notification wrapper that publishes events
 */
async function sendNotificationWithEvent(notificationFn, recipient, message, messageType, opts = {}) {
  try {
    // Send the actual notification
    const result = await notificationFn(recipient, message, opts);
    
    // Determine recipient type and ID
    const recipientId = recipient._id || recipient.user?._id || recipient;
    const recipientType = recipient.user?.type || recipient.type || 'unknown';
    
    // Publish notification event
    await publishNotificationSentEvent(
      recipientId,
      recipientType,
      messageType,
      result?.ok !== false
    );
    
    return result;
  } catch (error) {
    console.error('❌ Failed to send notification with event:', error.message);
    
    // Try to publish failed notification event
    try {
      const recipientId = recipient._id || recipient.user?._id || recipient;
      const recipientType = recipient.user?.type || recipient.type || 'unknown';
      await publishNotificationSentEvent(
        recipientId,
        recipientType,
        messageType,
        false
      );
    } catch (eventError) {
      console.error('❌ Failed to publish failed notification event:', eventError.message);
    }
    
    throw error;
  }
}

/**
 * Enhanced ride matching function that publishes events
 */
async function findAndNotifyDriversWithEvents(ride, matchingFn) {
  try {
    // Find drivers using existing matching logic
    const matches = await matchingFn(ride);
    
    // Publish ride request event
    await publishRideRequestEvent(ride);
    
    console.log(`📊 Found ${matches.length} potential drivers for ride ${ride._id}`);
    return matches;
  } catch (error) {
    console.error('❌ Failed to find and notify drivers with events:', error.message);
    throw error;
  }
}

/**
 * Enhanced ride acceptance function that publishes events
 */
async function acceptRideWithEvents(rideId, driverId, riderId, acceptanceFn) {
  try {
    // Execute the acceptance logic
    const result = await acceptanceFn();
    
    // Publish events
    await Promise.all([
      publishRideMatchedEvent(rideId, driverId, riderId),
      publishRideAcceptedEvent(rideId, driverId, riderId)
    ]);
    
    console.log(`🎯 Ride ${rideId} accepted by driver ${driverId}`);
    return result;
  } catch (error) {
    console.error('❌ Failed to accept ride with events:', error.message);
    throw error;
  }
}

/**
 * Enhanced ride cancellation function that publishes events
 */
async function cancelRideWithEvents(rideId, cancelledBy, reason, cancellationFn) {
  try {
    // Execute the cancellation logic
    const result = await cancellationFn();
    
    // Publish cancellation event
    await publishRideCancelledEvent(rideId, cancelledBy, reason);
    
    console.log(`❌ Ride ${rideId} cancelled by ${cancelledBy}: ${reason}`);
    return result;
  } catch (error) {
    console.error('❌ Failed to cancel ride with events:', error.message);
    throw error;
  }
}

/**
 * Enhanced driver availability function that publishes events
 */
async function setDriverAvailabilityWithEvents(driverId, available, location, radius, availabilityFn) {
  try {
    // Execute the availability logic
    const result = await availabilityFn();
    
    // Publish appropriate event
    if (available) {
      await publishDriverAvailableEvent(driverId, location, radius);
    } else {
      await publishDriverUnavailableEvent(driverId);
    }
    
    console.log(`🚗 Driver ${driverId} availability set to ${available}`);
    return result;
  } catch (error) {
    console.error('❌ Failed to set driver availability with events:', error.message);
    throw error;
  }
}

module.exports = {
  // Event publishers
  publishRideRequestEvent,
  publishRideMatchedEvent,
  publishRideAcceptedEvent,
  publishRideCancelledEvent,
  publishRideCompletedEvent,
  publishDriverAvailableEvent,
  publishDriverUnavailableEvent,
  publishNotificationSentEvent,
  
  // Enhanced functions with event publishing
  sendNotificationWithEvent,
  findAndNotifyDriversWithEvents,
  acceptRideWithEvents,
  cancelRideWithEvents,
  setDriverAvailabilityWithEvents
};
