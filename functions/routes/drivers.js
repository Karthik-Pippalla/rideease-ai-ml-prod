const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/driversController");

router.post("/available", ctrl.setAvailable);
router.post("/availability_off", ctrl.availabilityOff);
router.get("/nearby-rides/:telegramId", ctrl.nearby);
router.get("/stats/:telegramId", ctrl.stats);

module.exports = { router };
