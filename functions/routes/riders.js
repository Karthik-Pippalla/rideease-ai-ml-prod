const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/ridersController");

router.post("/request", ctrl.requestRide);
router.post("/delete-open", ctrl.deleteOpen);
router.get("/history/:telegramId", ctrl.history);
router.get("/stats/:telegramId", ctrl.stats);

module.exports = { router };
