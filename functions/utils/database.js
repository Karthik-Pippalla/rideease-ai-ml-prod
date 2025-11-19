const Rider = require("../models/rider");
const Driver = require("../models/driver");
const Ride = require("../models/ride");
const { haversineMiles } = require("./distance");
const { getRouteInfo } = require("./routeDistance");
const geocode = require("./geocode");
const mongoose = require("mongoose");



// Debug logging
const DEBUG = process.env.DEBUG === "true" || process.env.NODE_ENV === "development";
const debug = (message, data = null) => {
  if (DEBUG) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] 🗄️ DB DEBUG: ${message}`);
    if (data) console.log(`[${timestamp}] 🗄️ DB DEBUG DATA:`, JSON.stringify(data, null, 2));
  }
};

// Helper function to count completed rides for a user
async function countCompletedRides(userId, userType) {
  try {
    const query = userType === 'driver' 
      ? { driverId: userId, status: 'completed' }
      : { riderId: userId, status: 'completed' };
    
    const count = await Ride.countDocuments(query);
    debug(`Counted completed rides for ${userType}`, { userId, count });
    return count;
  } catch (error) {
    debug(`Failed to count rides for ${userType}`, { userId, error: error.message });
    return 0;
  }
}



async function findUserByTelegramId(telegramId) {
  debug("Finding user by telegram ID", { telegramId });
  try {
    const [rider, driver] = await Promise.all([
      Rider.findOne({ telegramId }).exec(),
      Driver.findOne({ telegramId }).exec()
    ]);
    
    // Return both found records and let the caller decide which one to use
    const result = { 
      rider: rider || null,
      driver: driver || null,
      user: rider || driver || null, 
      type: rider && driver ? "both" : rider ? "rider" : driver ? "driver" : null 
    };
    debug("User lookup result", { telegramId, hasRider: !!rider, hasDriver: !!driver, type: result.type });
    return result;
  } catch (error) {
    debug("Database error in findUserByTelegramId", { error: error.message, telegramId });
    console.error("Database error:", error);
    return { rider: null, driver: null, user: null, type: null };
  }
}

// Specific functions for finding riders and drivers
async function findRiderByTelegramId(telegramId) {
  debug("Finding rider by telegram ID", { telegramId });
  try {
    const rider = await Rider.findOne({ telegramId }).exec();
    const result = { user: rider, type: rider ? "rider" : null };
    debug("Rider lookup result", { telegramId, hasUser: !!result.user });
    return result;
  } catch (error) {
    debug("Database error in findRiderByTelegramId", { error: error.message, telegramId });
    console.error("Database error:", error);
    return { user: null, type: null };
  }
}

async function findDriverByTelegramId(telegramId) {
  debug("Finding driver by telegram ID", { telegramId });
  try {
    const driver = await Driver.findOne({ telegramId }).exec();
    const result = { user: driver, type: driver ? "driver" : null };
    debug("Driver lookup result", { telegramId, hasUser: !!result.user });
    return result;
  } catch (error) {
    debug("Database error in findDriverByTelegramId", { error: error.message, telegramId });
    console.error("Database error:", error);
    return { user: null, type: null };
  }
}

async function createRider(data) {
  debug("Creating rider", { telegramId: data.telegramId, name: data.name });
  try {
    // Clean up the data to only include basic registration fields
    const cleanData = {
      name: data.name,
      phoneNumber: data.phoneNumber,
      telegramId: data.telegramId,
      telegramUsername: data.telegramUsername,
    };

    // Geocode home address if provided
    if (data.homeAddress && data.homeAddress.trim()) {
      try {
        debug("Geocoding home address", { homeAddress: data.homeAddress });
        const homePoint = await geocode.getCoordsFromAddress(data.homeAddress);
        cleanData.homeAddress = data.homeAddress;
        // Only add homeGeo if geocoding was successful and has valid coordinates
        if (homePoint && homePoint.coordinates && Array.isArray(homePoint.coordinates) && homePoint.coordinates.length === 2) {
          cleanData.homeGeo = homePoint;
        }
        debug("Home address geocoded successfully", { homeAddress: data.homeAddress, homeGeo: homePoint });
      } catch (err) {
        debug("Failed to geocode home address", { error: err.message, homeAddress: data.homeAddress });
        // Still include the address even if geocoding fails
        cleanData.homeAddress = data.homeAddress;
      }
    }

    // Geocode work address if provided
    if (data.workAddress && data.workAddress.trim()) {
      try {
        debug("Geocoding work address", { workAddress: data.workAddress });
        const workPoint = await geocode.getCoordsFromAddress(data.workAddress);
        cleanData.workAddress = data.workAddress;
        // Only add workGeo if geocoding was successful and has valid coordinates
        if (workPoint && workPoint.coordinates && Array.isArray(workPoint.coordinates) && workPoint.coordinates.length === 2) {
          cleanData.workGeo = workPoint;
        }
        debug("Work address geocoded successfully", { workAddress: data.workAddress, workGeo: workPoint });
      } catch (err) {
        debug("Failed to geocode work address", { error: err.message, workAddress: data.workAddress });
        // Still include the address even if geocoding fails
        cleanData.workAddress = data.workAddress;
      }
    }

    // DO NOT create pickupLocation/dropLocation fields during registration
    // These should only be created when making a ride request
    
    const r = await Rider.create(cleanData);
    debug("Rider created successfully", { telegramId: data.telegramId, riderId: r._id });
    return { success: true, data: r };
  } catch (e) {
    debug("Rider creation failed", { error: e.message, code: e.code, telegramId: data.telegramId });
    if (e.code === 11000) return { success: false, error: "User already registered" };
    return { success: false, error: e.message };
  }
}

async function createDriver(data) {
  debug("Creating driver", { telegramId: data.telegramId, name: data.name });
  try {
    // Clean up the data and map to correct schema fields
    const cleanData = {
      name: data.name,
      phoneNumber: data.phoneNumber,
      telegramId: data.telegramId,
      telegramUsername: data.telegramUsername,
      // Map vehicle fields correctly
      licensePlateNumber: data.licensePlateNumber,
      vehicleColour: data.vehicleColour,
      // Don't set availableLocation unless we have valid coordinates
      // This prevents empty GeoPoint objects that cause validation errors
    };
    
    debug("Attempting to create driver with data", cleanData);
    
    const d = await Driver.create(cleanData);
    debug("Driver created successfully", { telegramId: data.telegramId, driverId: d._id });
    return { success: true, data: d };
  } catch (e) {
    debug("Driver creation failed", { error: e.message, code: e.code, stack: e.stack, telegramId: data.telegramId });
    console.error("Driver creation error:", e);
    if (e.code === 11000) return { success: false, error: "User already registered" };
    return { success: false, error: e.message };
  }
}

async function setDriverAvailability(telegramId, isOnline, location = null, radiusMiles = null, durationHours = null) {
  debug("Setting driver availability", { telegramId, isOnline, location, radiusMiles, durationHours });
  console.log("🔍 DEBUG: Location object received:", JSON.stringify(location));
  console.log("🔍 DEBUG: Location name:", location?.name);
  
  // Validate radius limits (server-side validation)
  if (radiusMiles !== null && (radiusMiles > 50 || radiusMiles < 1)) {
    return {
      success: false,
      error: `Invalid radius: ${radiusMiles} miles. Must be between 1-50 miles.`
    };
  }
  
  const update = { 
    availableLocation: location, 
    myRadiusOfAvailabilityMiles: radiusMiles, 
    availability: isOnline 
  };
  
  // Set location name if location object has a name
  if (location && location.name) {
    update.availableLocationName = location.name;
    console.log("✅ DEBUG: Setting availableLocationName to:", location.name);
  } else {
    console.log("❌ DEBUG: No location name found in:", location);
  }
  
  // Set start time when driver goes online
  if (isOnline) {
    update.availabilityStartedAt = new Date();
  } else {
    // Clear start time and location data when going offline
    update.availabilityStartedAt = null;
    update.availableLocationName = null;
    update.availableLocation = null;
    update.myRadiusOfAvailabilityMiles = null;
  }
  
  // Set end time if duration is provided and driver is going online
  if (isOnline && durationHours && durationHours > 0) {
    const endTime = new Date(Date.now() + durationHours * 60 * 60 * 1000);
    update.timeTillAvailable = endTime;
    debug("Setting availability end time", { endTime: endTime.toISOString() });
  } else if (!isOnline) {
    // Clear end time when going offline
    update.timeTillAvailable = null;
  }
  
  console.log("🔍 DEBUG: Update object to be saved:", JSON.stringify(update));
  
  const d = await Driver.findOneAndUpdate({ telegramId }, { $set: update }, { new: true });
  if (!d) {
    debug("Driver not found for availability update", { telegramId });
    return { success: false, error: "Driver not found" };
  }
  
  console.log("✅ DEBUG: Driver updated in database");
  console.log("🔍 DEBUG: Updated driver availableLocationName:", d.availableLocationName);
  console.log("🔍 DEBUG: Updated driver myRadiusOfAvailabilityMiles:", d.myRadiusOfAvailabilityMiles);
  
  // Invalidate cache for this user since availability changed
  await clearUserCache(telegramId);
  
  debug("Driver availability updated successfully", { telegramId, isOnline, endTime: update.timeTillAvailable });
  return { success: true, data: d };
}

async function findAvailableDriversNearLocation(point) {
  debug("Finding available drivers near location", { point });
  const now = new Date();
  
  // Clean up expired availability first
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
      }
    }
  );
  
  // Use MongoDB's geospatial query for initial filtering with a reasonable max distance
  // This leverages the 2dsphere index for fast geospatial queries
  const maxReasonableDistance = 50 * 1609.34; // 50 miles in meters (reasonable upper bound)

  const drivers = await Driver.find({ 
    availability: true, 
    availableLocation: { 
      $near: { 
        $geometry: point, 
        $maxDistance: maxReasonableDistance 
      } 
    },
    myRadiusOfAvailabilityMiles: { $gt: 0 }, // Must have a valid radius set
    $or: [
      { timeTillAvailable: { $exists: false } }, // No expiration set
      { timeTillAvailable: null }, // No expiration set
      { timeTillAvailable: { $gt: now } } // Not expired yet
    ]
  })
  .select('telegramId name phoneNumber availableLocation availableLocationName myRadiusOfAvailabilityMiles rating') // Only fetch needed fields
  .limit(100) // Pre-limit to avoid huge result sets
  .lean();
  
  // Filter drivers based on their individual radius settings
  // This is now a much smaller set thanks to MongoDB's geospatial pre-filtering
  const driversWithDistance = [];
  for (const driver of drivers) {
    const distance = haversineMiles(point, driver.availableLocation);
    const driverRadius = driver.myRadiusOfAvailabilityMiles || 0;
    
    // Only include drivers if the pickup location is within their service radius
    if (distance <= driverRadius) {
      driversWithDistance.push({
        ...driver,
        distanceMiles: distance
      });
    }
  }
  
  // Sort by distance (closest first) and limit final results
  driversWithDistance.sort((a, b) => a.distanceMiles - b.distanceMiles);
  const limitedResults = driversWithDistance.slice(0, 30);
  
  debug("Found available drivers", { 
    totalDriversPreFiltered: drivers.length,
    driversWithinRadius: limitedResults.length,
    point 
  });
  return limitedResults;
}

async function findNearbyRides(driverPoint, radiusMiles) {
  debug("Finding nearby rides", { driverPoint, radiusMiles });
  const maxMeters = Math.min(radiusMiles, 50) * 1609.34;
  const rides = await Ride.find({ status: "open", pickupLocation: { $near: { $geometry: driverPoint, $maxDistance: maxMeters } } })
    .sort({ bid: -1, createdAt: -1 })
    .limit(20);
  
  // Add distance calculation for each ride using haversineMiles
  const ridesWithDistance = rides.map(ride => {
    const distance = haversineMiles(driverPoint, ride.pickupLocation);
    return {
      ...ride.toObject(),
      distanceMiles: distance
    };
  });
  
  debug("Found nearby rides", { count: ridesWithDistance.length, maxMeters });
  return { success: true, data: ridesWithDistance };
}

async function updateRideStatus(rideId, toStatus, extra = {}) {
  debug("Updating ride status", { rideId, toStatus, extra });
  // atomic guard transitions
  const guards = {
    matched: { from: "open" },
    completed: { from: ["matched", "open"] },
    cancelled: { from: ["open", "matched"] },
  };
  const g = guards[toStatus];
  const from = g?.from ? (Array.isArray(g.from) ? { $in: g.from } : g.from) : { $exists: true };

  const ride = await Ride.findOneAndUpdate(
    { _id: rideId, status: from },
    { $set: { status: toStatus, ...extra } },
    { new: true }
  );
  if (!ride) {
    debug("Ride status update failed", { rideId, toStatus, error: "Not found or invalid transition" });
    return { success: false, error: "Not found or invalid transition" };
  }
  debug("Ride status updated successfully", { rideId, toStatus });
  return { success: true, data: ride };
}

async function getUserStats(telegramId, role) {
  if (role === "rider") {
    const rider = await Rider.findOne({ telegramId });
    if (!rider) return { success: false, error: "Rider not found" };
    const totalRides = await Ride.countDocuments({ riderId: rider._id });
    const completedRides = await Ride.countDocuments({ riderId: rider._id, status: "completed" });
    const spent = await Ride.aggregate([
      { $match: { riderId: rider._id, status: "completed" } },
      { $group: { _id: null, sum: { $sum: "$bid" } } },
    ]);
    const totalSpent = spent[0]?.sum || 0;
    const successRate = totalRides ? Math.round((completedRides / totalRides) * 100) : 0;
    return { success: true, data: { totalRides, completedRides, totalSpent, successRate } };
  } else {
    const driver = await Driver.findOne({ telegramId });
    if (!driver) return { success: false, error: "Driver not found" };
    const totalRides = await Ride.countDocuments({ driverId: driver._id });
    const completedRides = await Ride.countDocuments({ driverId: driver._id, status: "completed" });
    const earned = await Ride.aggregate([
      { $match: { driverId: driver._id, status: "completed" } },
      { $group: { _id: null, sum: { $sum: "$bid" } } },
    ]);
    const totalEarned = earned[0]?.sum || 0;
    const successRate = totalRides ? Math.round((completedRides / totalRides) * 100) : 0;
    return { success: true, data: { totalRides, completedRides, totalEarned, successRate } };
  }
}

async function getDriverStats(driverId) {
  debug("Getting driver stats", { driverId });
  try {
    // Convert driverId to ObjectId if it's a string
    const mongoose = require('mongoose');
    const objectId = mongoose.Types.ObjectId.isValid(driverId) ? 
      new mongoose.Types.ObjectId(driverId) : driverId;

    const driver = await Driver.findById(objectId);
    if (!driver) {
      debug("Driver not found for stats", { driverId });
      return { success: false, error: "Driver not found" };
    }

    const totalRides = await Ride.countDocuments({ driverId: objectId });
    const completedRides = await Ride.countDocuments({ driverId: objectId, status: "completed" });
    const matchedRides = await Ride.countDocuments({ driverId: objectId, status: "matched" });
    const cancelledRides = await Ride.countDocuments({ driverId: objectId, status: "cancelled" });
    
    const earned = await Ride.aggregate([
      { $match: { driverId: objectId, status: "completed" } },
      { $group: { _id: null, sum: { $sum: "$bid" } } },
    ]);
    const totalEarned = earned[0]?.sum || 0;
    
    const successRate = totalRides ? Math.round((completedRides / totalRides) * 100) : 0;
    const avgEarningsPerRide = completedRides ? Math.round((totalEarned / completedRides) * 100) / 100 : 0;
    
    debug("Driver stats calculated successfully", { driverId, totalRides, completedRides, totalEarned });
    return { 
      success: true, 
      data: { 
        totalRides, 
        completedRides, 
        matchedRides,
        cancelledRides,
        totalEarned, 
        successRate,
        avgEarningsPerRide,
        rating: driver.rating || 0
      } 
    };
  } catch (e) {
    debug("Failed to get driver stats", { error: e.message, driverId });
    return { success: false, error: e.message };
  }
}

// ---- Stubs to satisfy SAFE_CRUD in bot (implement as needed) ----
async function closeDriverAvailability(driverIdOrDoc) {
  const driverId = typeof driverIdOrDoc === "object" && driverIdOrDoc?._id ? driverIdOrDoc._id : driverIdOrDoc;
  const driver = await Driver.findById(driverId);
  if (!driver) return null;
  
  driver.availability = false;
  driver.availableLocation = undefined;
  driver.availableLocationName = undefined;
  driver.myRadiusOfAvailabilityMiles = 0;
  driver.timeTillAvailable = undefined;
  driver.availabilityStartedAt = undefined;
  await driver.save();
  
  // Invalidate cache for this user
  await clearUserCache(driver.telegramId);
  debug("Driver availability closed and cache invalidated", { telegramId: driver.telegramId, driverId });
  
  return driver;
}

async function getOpenAvailabilityByDriver(driverId) {
  const driver = await Driver.findById(driverId).lean();
  if (!driver || !driver.availability || !driver.availableLocation) return null;
  if (driver.timeTillAvailable && new Date(driver.timeTillAvailable) <= new Date()) return null;
  return driver; // treat driver doc as availability
}

async function listOpenAvailabilities() {
  const now = new Date();
  return Driver.find({
    availability: true,
    availableLocation: { $exists: true },
    $or: [ { timeTillAvailable: { $gt: now } }, { timeTillAvailable: { $exists: false } } ],
  }).lean();
}

// Get available rides for a driver based on their availability location and radius
async function getAvailableRidesForDriver(driverId) {
  const driver = await Driver.findById(driverId).lean();
  if (!driver || !driver.availability || !driver.availableLocation) {
    return [];
  }

  // Find open rides within the driver's availability radius
  const rides = await Ride.find({
    status: "open",
    pickupLocation: {
      $near: {
        $geometry: driver.availableLocation,
        $maxDistance: driver.myRadiusOfAvailabilityMiles * 1609.34 // Convert miles to meters
      }
    }
  }).populate('riderId', 'name telegramUsername').lean();

  return rides;
}

// Get available rides for a driver by availability ID (legacy compatibility)
async function getAvailabilityMenu(availabilityId) {
  // availabilityId is actually the driver ID in the old system
  const rides = await getAvailableRidesForDriver(availabilityId);
  return rides.map(ride => ride._id); // Return just the IDs for compatibility
}

// Legacy function for compatibility - now does nothing since we query directly
async function addAvailabilityMenu({ availabilityId, rideIds }) {
  // This function is no longer needed since we query rides directly
  // based on driver location and availability radius
  return true;
}

async function setRideMatched({ rideId, driverId }) {
  return await Ride.findOneAndUpdate(
    { _id: rideId, status: "open" },
    { $set: { status: "matched", driverId } },
    { new: true }
  );
}

async function listOpenRideRequests() {
  return Ride.find({ status: "open" }).lean();
}

async function deleteRideRequest(id) {
  return Ride.findOneAndUpdate({ _id: id, status: { $in: ["open", "failed"] } }, { $set: { status: "cancelled" } }, { new: true });
}

async function markRideFailed({ rideId, reason }) {
  debug("Marking ride as failed", { rideId, reason });
  try {
    const result = await Ride.findOneAndUpdate(
      { _id: rideId, status: "open" }, 
      { 
        $set: { 
          status: "failed", 
          failureReason: reason,
          failedAt: new Date(),
          notes: reason 
        } 
      }, 
      { new: true }
    );
    debug("Ride marked as failed", { rideId, success: !!result });
    return result;
  } catch (e) {
    debug("Failed to mark ride as failed", { error: e.message, rideId });
    throw e;
  }
}

async function logPastRide({ riderId, rideRequestId, reason }) {
  // With single Ride model, we keep status=failed as history; no separate PastRide collection needed.
  return true;
}

async function createRideRequest(data) {
  debug("Creating ride request", { riderId: data.riderId });
  try {
    // Calculate route information before creating the ride
    let routeInfo = null;
    if (data.pickupLocation && data.dropLocation && data.timeOfRide) {
      try {
        debug("Calculating route information", {
          pickup: data.pickupLocation.coordinates,
          dropoff: data.dropLocation.coordinates,
          departureTime: data.timeOfRide
        });
        
        routeInfo = await getRouteInfo(
          data.pickupLocation,
          data.dropLocation,
          new Date(data.timeOfRide)
        );
        
        debug("Route information calculated successfully", routeInfo);
      } catch (routeError) {
        debug("Route calculation failed, proceeding without route data", { error: routeError.message });
        // Don't fail the entire ride creation if route calculation fails
        // The ride will be created without route information
      }
    }

    // Prepare ride data with route information if available
    const rideData = { ...data };
    if (routeInfo) {
      rideData.routeDistance = routeInfo.distance;
      rideData.routeDuration = routeInfo.duration;
      rideData.estimatedDropoffTime = routeInfo.estimatedDropoffTime;
      rideData.hasTrafficData = routeInfo.hasTrafficData;
    }

    const ride = await Ride.create(rideData);
    debug("Ride request created successfully", { 
      rideId: ride._id,
      hasRouteInfo: !!routeInfo,
      distance: routeInfo?.distance?.text,
      duration: routeInfo?.duration?.text,
      estimatedDropoff: routeInfo?.estimatedDropoffTime?.toISOString()
    });
    
    return ride;
  } catch (e) {
    debug("Ride request creation failed", { error: e.message });
    throw e;
  }
}

async function getRideById(rideId) {
  debug("Getting ride by ID", { rideId });
  try {
    const ride = await Ride.findById(rideId).lean();
    debug("Ride retrieved successfully", { rideId, found: !!ride });
    return ride;
  } catch (e) {
    debug("Failed to get ride", { error: e.message, rideId });
    throw e;
  }
}

async function updateRideDetails(rideId, userId, userType, updateData) {
  debug("Updating ride details", { rideId, userId, userType, updateData });
  try {
    // Only allow the ride owner to update details
    const query = { _id: rideId, status: "open" };
    if (userType === "rider") {
      query.riderId = userId;
    } else {
      // Drivers can only update rides they've accepted
      query.driverId = userId;
    }

    const allowedFields = userType === "rider" 
      ? ['pickupLocationName', 'pickupLocation', 'dropLocationName', 'dropLocation', 'bid', 'timeOfRide']
      : ['notes']; // Drivers can only update notes

    const safeUpdate = {};
    for (const field of allowedFields) {
      if (updateData[field] !== undefined) {
        safeUpdate[field] = updateData[field];
      }
    }

    const ride = await Ride.findOneAndUpdate(query, { $set: safeUpdate }, { new: true });
    if (!ride) {
      debug("Ride update failed - not found or unauthorized", { rideId, userId, userType });
      return { success: false, error: "Ride not found or unauthorized" };
    }
    
    debug("Ride updated successfully", { rideId, updatedFields: Object.keys(safeUpdate) });
    return { success: true, data: ride };
  } catch (e) {
    debug("Ride update failed", { error: e.message, rideId });
    return { success: false, error: e.message };
  }
}

async function acceptRide(rideId, driverId) {
  debug("Driver accepting ride", { rideId, driverId });
  const session = await mongoose.startSession();
  
  try {
    session.startTransaction();
    
    // Find and update the ride atomically
    const ride = await Ride.findOneAndUpdate(
      { _id: rideId, status: "open" },
      { $set: { status: "matched", driverId, acceptedAt: new Date() } },
      { new: true, session }
    );
    
    if (!ride) {
      await session.abortTransaction();
      debug("Ride acceptance failed - not found or not available", { rideId, driverId });
      console.log(`🚗 DB: Ride acceptance failed for driver ${driverId}, ride ${rideId} - ride not available. Driver availability should remain unchanged.`);
      return { success: false, error: "Ride not available" };
    }
    
    // Mark driver as busy
    const driverUpdate = await Driver.findByIdAndUpdate(
      driverId,
      { $set: { availability: false, currentRideId: rideId } },
      { new: true, session }
    );
    
    if (!driverUpdate) {
      await session.abortTransaction();
      debug("Ride acceptance failed - driver not found", { rideId, driverId });
      return { success: false, error: "Driver not found" };
    }
    
    await session.commitTransaction();
    debug("Ride accepted successfully", { rideId, driverId });
    
    return { success: true, data: ride };
  } catch (e) {
    await session.abortTransaction();
    debug("Ride acceptance failed", { error: e.message, rideId, driverId });
    console.log(`🚗 DB: Ride acceptance failed for driver ${driverId}, ride ${rideId} due to error: ${e.message}. Driver availability should remain unchanged.`);
    return { success: false, error: e.message };
  } finally {
    session.endSession();
  }
}

async function completeRide(rideId, driverId) {
  debug("Completing ride", { rideId, driverId });
  const session = await mongoose.startSession();
  
  try {
    session.startTransaction();
    
    // Complete the ride
    const ride = await Ride.findOneAndUpdate(
      { _id: rideId, status: "matched", driverId },
      { $set: { status: "completed", completedAt: new Date() } },
      { new: true, session }
    );
    
    if (!ride) {
      await session.abortTransaction();
      debug("Ride completion failed - not found or unauthorized", { rideId, driverId });
      return { success: false, error: "Ride not found or unauthorized" };
    }
    
    // Update driver - make available and clear current ride
    await Driver.findByIdAndUpdate(
      driverId,
      { 
        $set: { availability: false },
        $unset: { currentRideId: 1 },
        $inc: { totalRides: 1 }
      },
      { session }
    );
    
    // Update rider's total ride count
    await Rider.findByIdAndUpdate(
      ride.riderId,
      { $inc: { totalRides: 1 } },
      { session }
    );
    
    await session.commitTransaction();
    debug("Ride completed successfully", { rideId, driverId });
    
    return { success: true, data: ride };
  } catch (e) {
    await session.abortTransaction();
    debug("Ride completion failed", { error: e.message, rideId, driverId });
    return { success: false, error: e.message };
  } finally {
    session.endSession();
  }
}

async function cancelRide(rideId, userId, userType, reason = "Cancelled by user") {
  debug("Cancelling ride", { rideId, userId, userType, reason });
  try {
    const query = { _id: rideId, status: { $in: ["open", "matched"] } };
    
    // Ensure only authorized users can cancel
    if (userType === "rider") {
      query.riderId = userId;
    } else if (userType === "driver") {
      query.driverId = userId;
    }

    const ride = await Ride.findOneAndUpdate(
      query,
      { 
        $set: { 
          status: "cancelled", 
          cancelledAt: new Date(),
          cancellationReason: reason,
          cancelledBy: userType
        } 
      },
      { new: true }
    );
    
    if (!ride) {
      debug("Ride cancellation failed - not found or unauthorized", { rideId, userId, userType });
      return { success: false, error: "Ride not found or unauthorized" };
    }
    
    debug("Ride cancelled successfully", { rideId, userId, userType, reason });
    
    return { success: true, data: ride };
  } catch (e) {
    debug("Ride cancellation failed", { error: e.message, rideId, userId });
    return { success: false, error: e.message };
  }
}

async function getRidesByUser(userId, userType, status = null) {
  debug("Getting rides by user", { userId, userType, status });
  try {
    // Convert userId to ObjectId if it's a string
    const mongoose = require('mongoose');
    const objectId = mongoose.Types.ObjectId.isValid(userId) ? 
      new mongoose.Types.ObjectId(userId) : userId;

    const query = {};
    if (userType === "rider") {
      query.riderId = objectId;
    } else {
      query.driverId = objectId;
    }
    
    if (status) {
      query.status = status;
    }

    console.log('getRidesByUser query debug:', { 
      originalUserId: userId, 
      convertedUserId: objectId, 
      query: query 
    });

    const rides = await Ride.find(query)
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    
    debug("Retrieved rides successfully", { userId, userType, count: rides.length });
    return { success: true, data: rides };
  } catch (e) {
    debug("Failed to get rides by user", { error: e.message, userId, userType });
    return { success: false, error: e.message };
  }
}

async function getRidesByDriver(driverId, status = null) {
  debug("Getting rides by driver", { driverId, status });
  try {
    // Convert driverId to ObjectId if it's a string
    const mongoose = require('mongoose');
    const objectId = mongoose.Types.ObjectId.isValid(driverId) ? 
      new mongoose.Types.ObjectId(driverId) : driverId;

    const query = { driverId: objectId };
    
    if (status) {
      query.status = status;
    }

    console.log('getRidesByDriver query debug:', { 
      originalDriverId: driverId, 
      convertedDriverId: objectId, 
      query: query 
    });

    const rides = await Ride.find(query)
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    
    debug("Retrieved driver rides successfully", { driverId, count: rides.length });
    return { success: true, data: rides };
  } catch (e) {
    debug("Failed to get rides by driver", { error: e.message, driverId });
    return { success: false, error: e.message };
  }
}

// Utility function to filter results by exact distance using haversineMiles
function filterByDistance(items, centerPoint, maxDistanceMiles, locationField = 'location') {
  return items.filter(item => {
    const itemLocation = item[locationField];
    if (!itemLocation) return false;
    const distance = haversineMiles(centerPoint, itemLocation);
    return distance <= maxDistanceMiles;
  });
}

async function updateDriver(data) {
  debug("Updating driver", { telegramId: data.telegramId, updates: Object.keys(data.updates || {}) });
  try {
    const updates = { ...data.updates };
    

    
    const driver = await Driver.findOneAndUpdate(
      { telegramId: data.telegramId },
      { $set: updates },
      { new: true }
    );
    
    if (!driver) {
      debug("Driver not found for update", { telegramId: data.telegramId });
      return { success: false, error: "Driver not found" };
    }
    
    debug("Driver updated successfully", { telegramId: data.telegramId, driverId: driver._id });
    return { success: true, data: driver };
  } catch (error) {
    debug("Driver update failed", { error: error.message, telegramId: data.telegramId });
    return { success: false, error: error.message };
  }
}

async function updateRider(data) {
  debug("Updating rider", { telegramId: data.telegramId, updates: Object.keys(data.updates || {}) });
  try {
    const updates = { ...data.updates };
    
    // Auto-geocode home address if it's being updated
    if (updates.homeAddress && updates.homeAddress.trim()) {
      try {
        debug("Geocoding updated home address", { homeAddress: updates.homeAddress });
        const homePoint = await geocode.getCoordsFromAddress(updates.homeAddress);
        updates.homeGeo = homePoint;
        debug("Updated home address geocoded successfully", { homeAddress: updates.homeAddress, homeGeo: homePoint });
      } catch (err) {
        debug("Failed to geocode updated home address", { error: err.message, homeAddress: updates.homeAddress });
        // Clear geo if address changed but geocoding failed
        updates.homeGeo = null;
      }
    }

    // Auto-geocode work address if it's being updated
    if (updates.workAddress && updates.workAddress.trim()) {
      try {
        debug("Geocoding updated work address", { workAddress: updates.workAddress });
        const workPoint = await geocode.getCoordsFromAddress(updates.workAddress);
        updates.workGeo = workPoint;
        debug("Updated work address geocoded successfully", { workAddress: updates.workAddress, workGeo: workPoint });
      } catch (err) {
        debug("Failed to geocode updated work address", { error: err.message, workAddress: updates.workAddress });
        // Clear geo if address changed but geocoding failed
        updates.workGeo = null;
      }
    }
    
    const rider = await Rider.findOneAndUpdate(
      { telegramId: data.telegramId },
      { $set: updates },
      { new: true }
    );
    
    if (!rider) {
      debug("Rider not found for update", { telegramId: data.telegramId });
      return { success: false, error: "Rider not found" };
    }
    
    debug("Rider updated successfully", { telegramId: data.telegramId, riderId: rider._id });
    return { success: true, data: rider };
  } catch (error) {
    debug("Rider update failed", { error: error.message, telegramId: data.telegramId });
    return { success: false, error: error.message };
  }
}

async function deleteDriver(driverId) {
  debug("Deleting driver", { driverId });
  try {
    // First check if driver has any active rides
    const activeRides = await Ride.find({
      $or: [
        { driverId, status: { $in: ['open', 'matched', 'in_progress'] } }
      ]
    });
    
    if (activeRides.length > 0) {
      debug("Cannot delete driver with active rides", { driverId, activeRideCount: activeRides.length });
      return { success: false, error: "Cannot delete profile with active rides. Complete or cancel all rides first." };
    }
    
    // Close any open availability
    await closeDriverAvailability(driverId);
    
    // Delete the driver
    const result = await Driver.findByIdAndDelete(driverId);
    
    if (!result) {
      debug("Driver not found for deletion", { driverId });
      return { success: false, error: "Driver not found" };
    }
    
    debug("Driver deleted successfully", { driverId });
    return { success: true };
  } catch (error) {
    debug("Driver deletion failed", { error: error.message, driverId });
    return { success: false, error: error.message };
  }
}

async function deleteRider(riderId) {
  debug("Deleting rider", { riderId });
  try {
    // First check if rider has any active rides
    const activeRides = await Ride.find({
      riderId,
      status: { $in: ['open', 'matched', 'in_progress'] }
    });
    
    if (activeRides.length > 0) {
      debug("Cannot delete rider with active rides", { riderId, activeRideCount: activeRides.length });
      return { success: false, error: "Cannot delete profile with active rides. Complete or cancel all rides first." };
    }
    
    // Delete the rider
    const result = await Rider.findByIdAndDelete(riderId);
    
    if (!result) {
      debug("Rider not found for deletion", { riderId });
      return { success: false, error: "Rider not found" };
    }
    
    debug("Rider deleted successfully", { riderId });
    return { success: true };
  } catch (error) {
    debug("Rider deletion failed", { error: error.message, riderId });
    return { success: false, error: error.message };
  }
}

// Helper function to find by ID in any collection
async function findById(collection, id) {
  debug(`Finding ${collection} by ID`, { id });
  try {
    let result;
    switch (collection) {
      case 'drivers':
        result = await Driver.findById(id);
        break;
      case 'riders':
        result = await Rider.findById(id);
        break;
      case 'rides':
        result = await Ride.findById(id);
        break;
      default:
        throw new Error(`Unknown collection: ${collection}`);
    }
    debug(`${collection} lookup result`, { id, found: !!result });
    return result;
  } catch (error) {
    debug(`${collection} lookup failed`, { error: error.message, id });
    console.error(`Database error finding ${collection}:`, error);
    return null;
  }
}

// Clear all user session state and telegram cache
async function clearUserCache(telegramId) {
  debug("Clearing user cache", { telegramId });
  try {
    // Clear in-memory state
    const state = require('./state');
    state.clear(telegramId);
    
    // Could also clear any Redis cache here if implemented
    // redis.del(`user:${telegramId}:*`);
    
    debug("User cache cleared successfully", { telegramId });
    return { success: true };
  } catch (error) {
    debug("User cache clear failed", { error: error.message, telegramId });
    return { success: false, error: error.message };
  }
}

// Clear all application cache
async function clearAllCache() {
  debug("Clearing all application cache");
  try {
    // Clear all in-memory state
    const state = require('./state');
    const clearedCount = state.getSize();
    state.clearAll();
    
    debug("All application cache cleared", { stateEntriesCleared: clearedCount });
    return { success: true, clearedCount };
  } catch (error) {
    debug("Cache clear failed", { error: error.message });
    return { success: false, error: error.message };
  }
}

/**
 * Calculate and update route information for an existing ride
 * @param {string} rideId - The ride ID to update
 * @returns {Object} Updated ride with route information
 */
async function calculateAndUpdateRouteInfo(rideId) {
  debug("Calculating route info for existing ride", { rideId });
  try {
    const ride = await Ride.findById(rideId);
    if (!ride) {
      throw new Error("Ride not found");
    }

    if (!ride.pickupLocation || !ride.dropLocation) {
      throw new Error("Ride missing pickup or dropoff location");
    }

    // Calculate route information
    const routeInfo = await getRouteInfo(
      ride.pickupLocation,
      ride.dropLocation,
      ride.timeOfRide
    );

    // Update the ride with route information
    const updatedRide = await Ride.findByIdAndUpdate(
      rideId,
      {
        $set: {
          routeDistance: routeInfo.distance,
          routeDuration: routeInfo.duration,
          estimatedDropoffTime: routeInfo.estimatedDropoffTime,
          hasTrafficData: routeInfo.hasTrafficData
        }
      },
      { new: true }
    );

    debug("Route info updated successfully", {
      rideId,
      distance: routeInfo.distance.text,
      duration: routeInfo.duration.text,
      estimatedDropoff: routeInfo.estimatedDropoffTime?.toISOString()
    });

    return { success: true, data: updatedRide, routeInfo };
  } catch (error) {
    debug("Route info calculation failed", { error: error.message, rideId });
    return { success: false, error: error.message };
  }
}

/**
 * Batch update route information for multiple rides
 * @param {Array} rideIds - Array of ride IDs to update
 * @returns {Object} Summary of batch update results
 */
async function batchUpdateRouteInfo(rideIds) {
  debug("Batch updating route info", { rideCount: rideIds.length });
  
  const results = {
    total: rideIds.length,
    successful: 0,
    failed: 0,
    errors: []
  };

  for (const rideId of rideIds) {
    try {
      const result = await calculateAndUpdateRouteInfo(rideId);
      if (result.success) {
        results.successful++;
      } else {
        results.failed++;
        results.errors.push({ rideId, error: result.error });
      }
    } catch (error) {
      results.failed++;
      results.errors.push({ rideId, error: error.message });
    }
  }

  debug("Batch route update completed", results);
  return results;
}

module.exports = {
  findUserByTelegramId,
  findRiderByTelegramId,
  findDriverByTelegramId,
  createRider,
  createDriver,
  updateRider,
  updateDriver,
  deleteRider,
  deleteDriver,
  findById,
  createRideRequest,
  getRideById,
  updateRideDetails,
  acceptRide,
  completeRide,
  cancelRide,
  getRidesByUser,
  getRidesByDriver,
  getDriverStats,
  findNearbyRides,
  findAvailableDriversNearLocation,
  updateRideStatus,
  setDriverAvailability,
  getUserStats,
  closeDriverAvailability,
  getOpenAvailabilityByDriver,
  listOpenAvailabilities,
  addAvailabilityMenu,
  getAvailabilityMenu,
  getAvailableRidesForDriver,
  setRideMatched,
  listOpenRideRequests,
  deleteRideRequest,
  markRideFailed,
  logPastRide,
  filterByDistance,
  clearUserCache,
  clearAllCache,
  countCompletedRides,
  calculateAndUpdateRouteInfo,
  batchUpdateRouteInfo,
};
