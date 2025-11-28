// Security utilities: rate limiting, input validation, audit logging
// Note: express-rate-limit needs to be installed: npm install express-rate-limit

/**
 * Input validation for recommendation requests
 */
function validateRecommendationRequest(req, res, next) {
  const { userId, limit } = req.body || {};
  
  if (!userId || typeof userId !== 'string' || userId.trim().length === 0) {
    return res.status(400).json({ error: 'userId_required', message: 'userId must be a non-empty string' });
  }
  
  if (userId.length > 256) {
    return res.status(400).json({ error: 'userId_too_long', message: 'userId must be <= 256 characters' });
  }
  
  if (limit !== undefined) {
    const limitNum = parseInt(limit, 10);
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
      return res.status(400).json({ error: 'invalid_limit', message: 'limit must be between 1 and 100' });
    }
  }
  
  next();
}

/**
 * Schema validation for events (using Avro schema if available)
 */
function validateEventSchema(event) {
  // Basic validation
  const required = ['type', 'userId', 'ts'];
  for (const field of required) {
    if (!event[field]) {
      throw new Error(`Missing required field: ${field}`);
    }
  }
  
  // Type validation
  const validTypes = ['recommend', 'play', 'view', 'skip'];
  if (!validTypes.includes(event.type)) {
    throw new Error(`Invalid event type: ${event.type}`);
  }
  
  // Timestamp validation
  const ts = new Date(event.ts);
  if (isNaN(ts.getTime())) {
    throw new Error(`Invalid timestamp: ${event.ts}`);
  }
  
  return true;
}

/**
 * Rate limiting middleware factory
 * Note: Requires express-rate-limit package
 * Usage: app.use('/recommendations', createRateLimiter({ windowMs: 60000, max: 100 }));
 */
function createRateLimiter({ windowMs = 60000, max = 100 } = {}) {
  try {
    const rateLimit = require('express-rate-limit');
    return rateLimit({
      windowMs,
      max,
      message: 'Too many requests, please try again later.',
      standardHeaders: true,
      legacyHeaders: false,
    });
  } catch (err) {
    // If express-rate-limit is not installed, return a no-op middleware
    console.warn('express-rate-limit not installed, rate limiting disabled');
    return (req, res, next) => next();
  }
}

/**
 * Audit logging for admin operations
 * Note: Requires AdminAuditLog model in models/index.js
 */
async function logAdminAction({ action, userId, details, ip } = {}) {
  try {
    const mongoose = require('mongoose');
    const AdminAuditLog = mongoose.models.AdminAuditLog;
    
    if (!AdminAuditLog) {
      console.warn('AdminAuditLog model not found, skipping audit log');
      return;
    }
    
    await AdminAuditLog.create({
      action,
      userId,
      details,
      ip,
      timestamp: new Date(),
    });
  } catch (err) {
    console.error('Failed to log admin action:', err.message);
    // Don't throw - audit logging should not break the request
  }
}

module.exports = {
  createRateLimiter,
  validateRecommendationRequest,
  logAdminAction,
  validateEventSchema,
};

