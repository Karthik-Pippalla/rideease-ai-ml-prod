const Ride = require("../models/ride");
const Driver = require("../models/driver");
const { haversineMiles } = require("./distance");
const notifications = require("./notifications");

/**
 * Find available drivers for a given ride and notify them
 */
async function findDriversForRide(ride) {
  const now = new Date();
  
  // First, clean up expired availability
  await Driver.updateMany(
    { 
      availability: true,
      timeTillAvailable: { $lt: now }
    },
    {
      $set: { 
        availability: false,
        availableLocationName: undefined,
        availableLocation: undefined,
        myRadiusOfAvailabilityMiles: 0
      },
      $unset: {
        availabilityStartedAt: 1
      }
    }
  );
  
  const drivers = await Driver.find({ 
    availability: true, 
    availableLocation: { $exists: true },
    $or: [
      { timeTillAvailable: { $exists: false } }, // No expiration set
      { timeTillAvailable: null }, // No expiration set
      { timeTillAvailable: { $gt: now } } // Not expired yet
    ]
  }).lean();
  
  console.log(`🚗 MATCHING: Found ${drivers.length} available drivers in database for ride ${ride._id}`);
  
  const out = [];
  for (const d of drivers) {
    // Check if ride time falls within driver's availability window
    if (ride.timeOfRide || ride.rideTime) {
      const rideTime = new Date(ride.timeOfRide || ride.rideTime);
      const availabilityStart = d.availabilityStartedAt ? new Date(d.availabilityStartedAt) : new Date(d.updatedAt);
      const availabilityEnd = d.timeTillAvailable ? new Date(d.timeTillAvailable) : null;
      
      // If driver has a specific availability window, check if ride time is within it
      if (availabilityEnd && (rideTime < availabilityStart || rideTime > availabilityEnd)) {
        console.log(`Skipping driver ${d.telegramId} - ride time ${rideTime.toLocaleString()} outside availability window ${availabilityStart.toLocaleString()} - ${availabilityEnd.toLocaleString()}`);
        continue;
      }
      
      // Don't match rides that are more than 24 hours in the future from when driver became available
      const maxFutureTime = new Date((availabilityStart || now).getTime() + 24 * 60 * 60 * 1000);
      if (rideTime > maxFutureTime) {
        console.log(`Skipping driver ${d.telegramId} - ride time ${rideTime.toLocaleString()} too far in future from availability start ${(availabilityStart || now).toLocaleString()}`);
        continue;
      }
    }
    
    const dist = haversineMiles(
      { coordinates: d.availableLocation.coordinates },
      { coordinates: ride.pickupLocation.coordinates }
    );
    if (dist <= (d.myRadiusOfAvailabilityMiles || 0)) {
      out.push({ availability: { driverId: d._id }, distanceMi: dist, driver: d });
    }
  }
  // sort nearest first
  out.sort((a, b) => a.distanceMi - b.distanceMi);
  
  // Notify matched drivers about the new ride request
  console.log(`🚗 MATCHING: Attempting to notify ${out.length} matched drivers for ride ${ride._id}`);
  console.log(`🚗 MATCHING: Matched drivers:`, out.map(m => ({ driverId: m.driver._id, telegramId: m.driver.telegramId, availability: m.driver.availability })));
  for (const match of out) {
    const message = `🚗 **New Ride Request Available!**\n\n` +
      `📍 **Pickup:** ${ride.pickupLocationName || 'Location provided'}\n` +
      `📍 **Drop:** ${ride.dropLocationName || 'Destination provided'}\n` +
      `💰 **Bid:** $${ride.bid || 'Not specified'}\n` +
      `🕐 **Time:** ${ride.timeOfRide ? new Date(ride.timeOfRide).toLocaleString() : 'ASAP'}\n` +
      `📏 **Distance:** ${match.distanceMi.toFixed(1)} miles from you\n\n` +
      `Accept this ride directly or check your available rides menu!`;
    
    // Create interactive buttons for immediate ride acceptance
    const buttons = {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "✅ Accept This Ride", callback_data: `accept_specific_ride_${ride._id}` },
            { text: "🚗 View All Rides", callback_data: "view_available_rides" }
          ],
          [
            { text: "🔴 Go Unavailable", callback_data: "go_unavailable" }
          ]
        ]
      }
    };
    
    try {
      console.log(`🚗 MATCHING: Notifying driver ${match.driver.telegramId}`);
      const result = await notifications.notifyDriver(match.driver, message, { 
        parse_mode: "Markdown",
        ...buttons
      });
      console.log(`🚗 MATCHING: Notification result for ${match.driver.telegramId}:`, result?.ok ? 'SUCCESS' : 'FAILED');
    } catch (error) {
      console.error(`🚗 MATCHING: Failed to notify driver ${match.driver.telegramId}:`, error);
    }
  }
  
  return out;
}

/**
 * Find rides that match a driver's availability and notify the driver
 */
async function findMatchesForDriverAvailability(driverDoc) {
  const radius = driverDoc.myRadiusOfAvailabilityMiles || 0;
  if (!driverDoc.availableLocation || !radius) return [];
  
  // Check if driver's availability has expired
  const now = new Date();
  if (driverDoc.timeTillAvailable && now > new Date(driverDoc.timeTillAvailable)) {
    console.log(`Driver ${driverDoc.telegramId} availability has expired`);
    
    // Update driver to mark as unavailable
    await Driver.findByIdAndUpdate(driverDoc._id, {
      $set: { 
        availability: false,
        availableLocationName: undefined,
        availableLocation: undefined,
        myRadiusOfAvailabilityMiles: 0
      },
      $unset: {
        availabilityStartedAt: 1
      }
    });
    
    // Notify driver that availability has expired
    try {
      console.log("📱 DEBUG: Notifying driver about expired availability:", driverDoc.telegramId);
      await notifications.notifyDriver?.(driverDoc, "⏰ **Availability Window Closed**\n\nYour availability window has automatically ended.\n\nUse /available to set new availability hours!");
      console.log("✅ DEBUG: Driver expiration notification sent successfully");
    } catch (notifyErr) {
      console.error("❌ DEBUG: Failed to notify driver about expiration:", notifyErr);
    }
    
    return [];
  }
  
  const rides = await Ride.find({ status: "open" }).lean();
  const out = [];
  for (const r of rides) {
    // Skip rides that don't have a pickup location
    if (!r.pickupLocation || !r.pickupLocation.coordinates) {
      continue;
    }
    
    // Check if ride time falls within driver's availability window
    if (r.timeOfRide || r.rideTime) {
      const rideTime = new Date(r.timeOfRide || r.rideTime);
      const availabilityStart = driverDoc.availabilityStartedAt ? new Date(driverDoc.availabilityStartedAt) : new Date(driverDoc.updatedAt);
      const availabilityEnd = driverDoc.timeTillAvailable ? new Date(driverDoc.timeTillAvailable) : null;
      
      // If driver has a specific availability window, check if ride time is within it
      if (availabilityEnd && (rideTime < availabilityStart || rideTime > availabilityEnd)) {
        console.log(`Skipping ride ${r._id} - time ${rideTime.toLocaleString()} outside driver availability window ${availabilityStart.toLocaleString()} - ${availabilityEnd.toLocaleString()}`);
        continue;
      }
      
      // Don't match rides that are more than 24 hours in the future from when driver became available
      const maxFutureTime = new Date(availabilityStart.getTime() + 24 * 60 * 60 * 1000);
      if (rideTime > maxFutureTime) {
        console.log(`Skipping ride ${r._id} - time ${rideTime.toLocaleString()} too far in future from availability start ${availabilityStart.toLocaleString()}`);
        continue;
      }
    }
    
    const dist = haversineMiles(
      { coordinates: driverDoc.availableLocation.coordinates },
      { coordinates: r.pickupLocation.coordinates }
    );
    if (dist <= radius) out.push({ ride: r, distanceMi: dist });
  }
  out.sort((a, b) => a.distanceMi - b.distanceMi);
  
  // Notify the driver about available ride requests in their area
  if (out.length > 0) {
    let message = `🚗 You have ${out.length} ride request${out.length > 1 ? 's' : ''} in your area!\n\n`;
    
    // Show top 3 closest rides
    const topRides = out.slice(0, 3);
    topRides.forEach((match, index) => {
      message += `${index + 1}. 📍 ${match.ride.pickupLocationName || 'Pickup location'}\n` +
        `   📍 ${match.ride.dropLocationName || 'Drop location'}\n` +
        `   💰 $${match.ride.bid || 'No bid'} | 📏 ${match.distanceMi.toFixed(1)}mi away\n` +
        `   🕐 ${match.ride.timeOfRide ? new Date(match.ride.timeOfRide).toLocaleString() : 'ASAP'}\n\n`;
    });
    
    if (out.length > 3) {
      message += `... and ${out.length - 3} more rides available.\n\n`;
    }
    
    message += `Reply to any ride to accept it!`;
    
    // Note: Notification removed - the bot interface handles showing rides
    // The driver will see the rides through the bot menu instead of notifications
  }
  
  return out;
}

/**
 * Notify rider when a driver accepts their ride
 */
async function notifyRiderOfMatch(rideId, driverInfo) {
  const Rider = require("../models/rider");
  
  try {
    const ride = await Ride.findById(rideId).lean();
    if (!ride) return false;
    
    const rider = await Rider.findById(ride.riderId).lean();
    if (!rider) return false;
    
    const message = `🎉 Your ride has been matched!\n\n` +
      `🚗 Driver: ${driverInfo.name}\n` +
      `📱 Contact: ${driverInfo.phoneNumber}\n` +
      `🚙 Vehicle: ${driverInfo.licensePlateNumber} (${driverInfo.vehicleColour})\n\n` +
      `📍 Pickup: ${ride.pickupLocationName}\n` +
      `📍 Drop: ${ride.dropLocationName}\n` +
      `🕐 Time: ${new Date(ride.timeOfRide).toLocaleString()}\n\n` +
      `Your driver will contact you shortly!`;
    
    await notifications.notifyRider(rider, message);
    return true;
  } catch (error) {
    console.error('Failed to notify rider of match:', error);
    return false;
  }
}

/**
 * Broadcast ride cancellation to interested drivers
 */
async function notifyDriversOfCancellation(rideId, reason = "Rider cancelled") {
  try {
    const ride = await Ride.findById(rideId).lean();
    if (!ride) return false;
    
    // Find drivers who might have been interested (within reasonable distance)
    const drivers = await Driver.find({ 
      availability: true, 
      availableLocation: { $exists: true } 
    }).lean();
    
    const message = `❌ Ride Cancelled\n\n` +
      `📍 Pickup: ${ride.pickupLocationName}\n` +
      `💰 Fare: $${ride.bid}\n` +
      `Reason: ${reason}\n\n` +
      `Keep looking for other rides!`;
    
    // Only notify drivers within a reasonable distance (e.g., 10 miles)
    for (const driver of drivers) {
      const dist = haversineMiles(
        { coordinates: driver.availableLocation.coordinates },
        { coordinates: ride.pickupLocation.coordinates }
      );
      
      if (dist <= 10) { // Within 10 miles
        try {
          await notifications.notifyDriver(driver, message);
        } catch (error) {
          console.error(`Failed to notify driver ${driver.telegramId} of cancellation:`, error);
        }
      }
    }
    
    return true;
  } catch (error) {
    console.error('Failed to notify drivers of cancellation:', error);
    return false;
  }
}

module.exports = { 
  findDriversForRide, 
  findMatchesForDriverAvailability,
  notifyRiderOfMatch,
  notifyDriversOfCancellation
};