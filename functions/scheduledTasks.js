// functions/scheduledTasks.js
// Automated scheduled tasks for ride management

const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onRequest } = require("firebase-functions/v2/https");
const mongoose = require("mongoose");
const admin = require("firebase-admin");

// Models
const Driver = require("./models/driver");
const Ride = require("./models/ride");
const Rider = require("./models/rider");

// Utils
const notifications = require("./utils/notifications");
const { formatDateTime } = require("./utils/dateParser");

// MongoDB connection utility
async function connectDb() {
  if (mongoose.connection.readyState === 1) return mongoose;

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI not set");
  }

  await mongoose.connect(uri, {
    dbName: process.env.MONGODB_DB || undefined,
    serverSelectionTimeoutMS: 10_000,
    socketTimeoutMS: 45_000,
    bufferCommands: false,
  });

  console.log("✅ MongoDB connected for scheduled task");
  return mongoose;
}

// =============================================================================
// TASK 1: Close Driver Availability Windows
// Runs every 5 minutes to check for expired availability windows
// =============================================================================
exports.closeAvailabilityTask = onSchedule(
  {
    schedule: "*/5 * * * *", // Every 5 minutes
    timeZone: "America/New_York",
  },
  async (event) => {
    console.log("🕐 Running closeAvailabilityTask at:", new Date().toISOString());
    
    try {
      await connectDb();
      
      const now = new Date();
      
      // Find drivers whose availability window has expired
      const expiredDrivers = await Driver.find({
        availability: true,
        timeTillAvailable: { $lt: now }
      });

      console.log(`Found ${expiredDrivers.length} drivers with expired availability`);

      for (const driver of expiredDrivers) {
        // Close availability
        driver.availability = false;
        driver.availabilityStartedAt = null;
        driver.timeTillAvailable = null;
        driver.availableLocationName = null;
        driver.availableLocation = null;
        driver.myRadiusOfAvailabilityMiles = 0;
        
        await driver.save();

        // Notify driver
        try {
          await notifications.notifyDriver(
            driver,
            "⏰ **Availability Window Closed**\n\n" +
            "Your availability window has expired and has been automatically closed.\n" +
            "You can set your availability again when you're ready to accept rides."
          );
        } catch (notifError) {
          console.error(`Failed to notify driver ${driver.telegramId || driver._id}:`, notifError);
        }
      }

      console.log(`✅ Closed availability for ${expiredDrivers.length} drivers`);
      
    } catch (error) {
      console.error("❌ Error in closeAvailabilityTask:", error);
      throw error;
    }
  }
);

// =============================================================================
// TASK 2: Handle Failed/Timeout Ride Scenarios
// Runs every minute to check for rides that should be marked as failed
// =============================================================================
exports.failRideTask = onSchedule(
  {
    schedule: "* * * * *", // Every minute
    timeZone: "America/New_York",
  },
  async (event) => {
    console.log("🚫 Running failRideTask at:", new Date().toISOString());
    
    try {
      await connectDb();
      
      const now = new Date();
      
      // Find open rides where the ride time has passed and no driver accepted
      const expiredRides = await Ride.find({
        status: "open",
        timeOfRide: { $lt: now },
        driverId: null // No driver assigned
      }).populate('riderId');

      console.log(`Found ${expiredRides.length} expired rides to fail`);

      for (const ride of expiredRides) {
        // Mark ride as failed
        ride.status = "failed";
        await ride.save();

        // Notify rider
        try {
          const rideTimeStr = formatDateTime(ride.timeOfRide);

          await notifications.notifyRider(
            ride.riderId,
            "❌ **Ride Request Failed**\n\n" +
            `Unfortunately, no driver was available for your ride scheduled at ${rideTimeStr}.\n\n` +
            `📍 ${ride.pickupLocationName} → ${ride.dropLocationName}\n` +
            `💰 Bid: $${ride.bid}\n\n` +
            "Please try posting a new ride request or consider adjusting your pickup time or bid amount."
          );
        } catch (notifError) {
          console.error(`Failed to notify rider ${ride.riderId.telegramId || ride.riderId._id}:`, notifError);
        }
      }

      console.log(`✅ Failed ${expiredRides.length} expired rides`);
      
    } catch (error) {
      console.error("❌ Error in failRideTask:", error);
      throw error;
    }
  }
);

// =============================================================================
// TASK 3: Notify Driver About Ride Status (2 hours after ride time)
// Runs every 30 minutes to check for rides that need status notifications
// =============================================================================
exports.notifyDriverRideStatusTask = onSchedule(
  {
    schedule: "*/30 * * * *", // Every 30 minutes
    timeZone: "America/New_York",
  },
  async (event) => {
    console.log("📢 Running notifyDriverRideStatusTask at:", new Date().toISOString());
    
    try {
      await connectDb();
      
      const now = new Date();
      const twoHoursAgo = new Date(now.getTime() - (2 * 60 * 60 * 1000)); // 2 hours ago
      
      // Find matched rides where:
      // - Status is still "matched" (not completed/cancelled)
      // - Ride time was 2+ hours ago
      // - We haven't sent this notification yet (we'll track this with a field)
      const stalledRides = await Ride.find({
        status: "matched",
        timeOfRide: { $lt: twoHoursAgo },
        statusNotificationSent: { $ne: true } // Add this field to track notifications
      }).populate(['driverId', 'riderId']);

      console.log(`Found ${stalledRides.length} stalled rides needing notification`);

      for (const ride of stalledRides) {
        if (!ride.driverId) continue;

        try {
          const rideTimeStr = formatDateTime(ride.timeOfRide);

          await notifications.notifyDriver(
            ride.driverId,
            "⚠️ **Ride Status Update Required**\n\n" +
            `Your ride scheduled for ${rideTimeStr} is still showing as "matched" but the time has passed.\n\n` +
            `📍 ${ride.pickupLocationName} → ${ride.dropLocationName}\n` +
            `👤 Rider: ${ride.riderId.name}\n\n` +
            "Please update the ride status:\n" +
            "• Mark as 'Completed' if finished\n" +
            "• Mark as 'Cancelled' if cancelled\n\n" +
            "⚠️ **Important**: This ride will be automatically cancelled if not completed within 24 hours of the scheduled time."
          );

          // Mark notification as sent
          ride.statusNotificationSent = true;
          await ride.save();

        } catch (notifError) {
          console.error(`Failed to notify driver ${ride.driverId.telegramId || ride.driverId._id}:`, notifError);
        }
      }

      console.log(`✅ Sent status notifications for ${stalledRides.length} rides`);
      
    } catch (error) {
      console.error("❌ Error in notifyDriverRideStatusTask:", error);
      throw error;
    }
  }
);

// =============================================================================
// TASK 4: Auto-Cancel Rides After 24 Hours
// Runs every hour to check for rides that should be auto-cancelled
// =============================================================================
exports.autoCancelRideTask = onSchedule(
  {
    schedule: "0 * * * *", // Every hour
    timeZone: "America/New_York",
  },
  async (event) => {
    console.log("🚫 Running autoCancelRideTask at:", new Date().toISOString());
    
    try {
      await connectDb();
      
      const now = new Date();
      const twentyFourHoursAgo = new Date(now.getTime() - (24 * 60 * 60 * 1000)); // 24 hours ago
      
      // Find matched rides where:
      // - Status is still "matched" 
      // - Ride time was 24+ hours ago
      const expiredRides = await Ride.find({
        status: "matched",
        timeOfRide: { $lt: twentyFourHoursAgo }
      }).populate(['driverId', 'riderId']);

      console.log(`Found ${expiredRides.length} rides to auto-cancel`);

      for (const ride of expiredRides) {
        // Mark ride as cancelled
        ride.status = "cancelled";
        await ride.save();

        try {
          const rideTimeStr = formatDateTime(ride.timeOfRide);

          // Notify both driver and rider
          if (ride.driverId) {
            await notifications.notifyDriver(
              ride.driverId,
              "🚫 **Ride Automatically Cancelled**\n\n" +
              `The ride scheduled for ${rideTimeStr} has been automatically cancelled due to no status update within 24 hours.\n\n` +
              `📍 ${ride.pickupLocationName} → ${ride.dropLocationName}\n` +
              `👤 Rider: ${ride.riderId.name}\n\n` +
              "Please ensure to update ride status promptly in the future."
            );
          }

          await notifications.notifyRider(
            ride.riderId,
            "🚫 **Ride Automatically Cancelled**\n\n" +
            `Your ride scheduled for ${rideTimeStr} has been automatically cancelled due to no status update from the driver within 24 hours.\n\n` +
            `📍 ${ride.pickupLocationName} → ${ride.dropLocationName}\n` +
            `💰 Bid: $${ride.bid}\n\n` +
            "You can post a new ride request if needed."
          );

        } catch (notifError) {
          console.error(`Failed to send auto-cancel notifications for ride ${ride._id}:`, notifError);
        }
      }

      console.log(`✅ Auto-cancelled ${expiredRides.length} expired rides`);
      
    } catch (error) {
      console.error("❌ Error in autoCancelRideTask:", error);
      throw error;
    }
  }
);

// =============================================================================
// TASK 5: Send Ride Time Reminders
// Runs every 15 minutes to send reminders for upcoming rides
// =============================================================================
exports.sendRideTimeReminderTask = onSchedule(
  {
    schedule: "*/15 * * * *", // Every 15 minutes
    timeZone: "America/New_York",
  },
  async (event) => {
    console.log("⏰ Running sendRideTimeReminderTask at:", new Date().toISOString());
    
    try {
      await connectDb();
      
      const now = new Date();
      const in30Minutes = new Date(now.getTime() + (30 * 60 * 1000)); // 30 minutes from now
      const in15Minutes = new Date(now.getTime() + (15 * 60 * 1000)); // 15 minutes from now
      
      // Find matched rides that are coming up in 15-30 minutes
      // and haven't had a reminder sent yet
      const upcomingRides = await Ride.find({
        status: "matched",
        timeOfRide: { 
          $gte: in15Minutes,
          $lte: in30Minutes 
        },
        reminderSent: { $ne: true } // Add this field to track reminders
      }).populate(['driverId', 'riderId']);

      console.log(`Found ${upcomingRides.length} rides needing reminders`);

      for (const ride of upcomingRides) {
        if (!ride.driverId) continue;

        try {
          const rideTimeStr = formatDateTime(ride.timeOfRide);

          // Send reminder to rider
          await notifications.notifyRider(
            ride.riderId,
            "⏰ **Ride Time Reminder**\n\n" +
            `Your ride is scheduled for: ${rideTimeStr}\n` +
            `📍 ${ride.pickupLocationName} → ${ride.dropLocationName}\n` +
            `🚗 Driver: ${ride.driverId.name}\n` +
            `📱 Driver Phone: ${ride.driverId.phoneNumber}\n\n` +
            "⚠️ **Important**: This ride will be automatically cancelled if not completed within 24 hours of the scheduled time."
          );

          // Send reminder to driver
          await notifications.notifyDriver(
            ride.driverId,
            "⏰ **Ride Time Reminder**\n\n" +
            `You have a ride scheduled for: ${rideTimeStr}\n` +
            `📍 ${ride.pickupLocationName} → ${ride.dropLocationName}\n` +
            `👤 Rider: ${ride.riderId.name}\n` +
            `📱 Rider Phone: ${ride.riderId.phoneNumber}\n` +
            `💰 Bid: $${ride.bid}\n\n` +
            "Please ensure you're on time and update the ride status after completion."
          );

          // Mark reminder as sent
          ride.reminderSent = true;
          await ride.save();

        } catch (notifError) {
          console.error(`Failed to send reminders for ride ${ride._id}:`, notifError);
        }
      }

      console.log(`✅ Sent reminders for ${upcomingRides.length} upcoming rides`);
      
    } catch (error) {
      console.error("❌ Error in sendRideTimeReminderTask:", error);
      throw error;
    }
  }
);

// =============================================================================
// Utility function to manually trigger any task (for testing)
// =============================================================================
exports.triggerScheduledTask = onRequest(async (req, res) => {
  const { task } = req.query;
  
  if (!task) {
    return res.status(400).json({ error: "Missing 'task' parameter" });
  }

  try {
    switch (task) {
      case 'closeAvailability':
        await exports.closeAvailabilityTask.run();
        break;
      case 'failRide':
        await exports.failRideTask.run();
        break;
      case 'notifyDriverStatus':
        await exports.notifyDriverRideStatusTask.run();
        break;
      case 'autoCancelRide':
        await exports.autoCancelRideTask.run();
        break;
      case 'sendReminder':
        await exports.sendRideTimeReminderTask.run();
        break;
      default:
        return res.status(400).json({ error: "Invalid task name" });
    }
    
    res.json({ success: true, message: `Task ${task} executed successfully` });
  } catch (error) {
    console.error(`Error executing task ${task}:`, error);
    res.status(500).json({ error: error.message });
  }
});
