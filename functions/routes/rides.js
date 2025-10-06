const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/ridesController");

// Ride lifecycle
router.post("/accept", ctrl.acceptRide);
router.post("/complete", ctrl.completeRide);
router.post("/cancel", ctrl.cancelRide);

// Queries
router.get("/for-driver/:telegramId", ctrl.forDriver);
router.get("/for-rider/:telegramId", ctrl.forRider);

module.exports = { router };
