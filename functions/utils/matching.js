const Ride = require("../models/ride");
const Driver = require("../models/driver");
const { haversineMiles } = require("./distance");
const { sendTelegramMessage } = require("./notifications");

/**
 * Find available drivers for a given ride and notify them
 */
async function findDriversForRide(ride) {
  const drivers = await Driver.find({ availability: true, availableLocation: { $exists: true } }).lean();
  const out = [];
  for (const d of drivers) {
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
  for (const match of out) {
    const message = `🚗 New Ride Request Available!\n\n` +
      `📍 Pickup: ${ride.pickupLocationName || 'Location provided'}\n` +
      `📍 Drop: ${ride.dropLocationName || 'Destination provided'}\n` +
      `💰 Bid: $${ride.bid || 'Not specified'}\n` +
      `🕐 Time: ${ride.timeOfRide ? new Date(ride.timeOfRide).toLocaleString() : 'ASAP'}\n` +
      `📏 Distance: ${match.distanceMi.toFixed(1)} miles from you\n\n` +
      `Reply to accept this ride!`;
    
    try {
      await sendTelegramMessage(match.driver.telegramId, message);
    } catch (error) {
      console.error(`Failed to notify driver ${match.driver.telegramId}:`, error);
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
  const rides = await Ride.find({ status: "open" }).lean();
  const out = [];
  for (const r of rides) {
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
    
    try {
      await sendTelegramMessage(driverDoc.telegramId, message);
    } catch (error) {
      console.error(`Failed to notify driver ${driverDoc.telegramId}:`, error);
    }
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
    
    await sendTelegramMessage(rider.telegramId, message);
    return true;
  } catch (error) {
    console.error('Failed to notify rider of match:', error);
    return false;
  }
}

/**
 * Notify driver when they successfully accept a ride
 */
async function notifyDriverOfAcceptance(driverId, rideInfo) {
  try {
    const driver = await Driver.findById(driverId).lean();
    if (!driver) return false;
    
    const message = `✅ Ride Accepted Successfully!\n\n` +
      `📍 Pickup: ${rideInfo.pickupLocationName}\n` +
      `📍 Drop: ${rideInfo.dropLocationName}\n` +
      `💰 Fare: $${rideInfo.bid}\n` +
      `🕐 Time: ${new Date(rideInfo.timeOfRide).toLocaleString()}\n\n` +
      `Please contact the rider and head to the pickup location.`;
    
    await sendTelegramMessage(driver.telegramId, message);
    return true;
  } catch (error) {
    console.error('Failed to notify driver of acceptance:', error);
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
          await sendTelegramMessage(driver.telegramId, message);
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
  notifyDriverOfAcceptance,
  notifyDriversOfCancellation
};