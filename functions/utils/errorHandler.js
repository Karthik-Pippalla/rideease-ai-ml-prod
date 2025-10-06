// functions/utils/errorHandler.js

// Debug logging
const DEBUG = process.env.DEBUG === "true" || process.env.NODE_ENV === "development";
const debug = (message, data = null) => {
  if (DEBUG) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ❌ ERROR DEBUG: ${message}`);
    if (data) console.log(`[${timestamp}] ❌ ERROR DEBUG DATA:`, JSON.stringify(data, null, 2));
  }
};

// ==================== ERROR TYPES ====================

class ValidationError extends Error {
  constructor(message, field = null) {
    super(message);
    this.name = 'ValidationError';
    this.field = field;
  }
}

class DatabaseError extends Error {
  constructor(message, operation = null) {
    super(message);
    this.name = 'DatabaseError';
    this.operation = operation;
  }
}

class APIError extends Error {
  constructor(message, service = null, statusCode = null) {
    super(message);
    this.name = 'APIError';
    this.service = service;
    this.statusCode = statusCode;
  }
}

class RateLimitError extends Error {
  constructor(message, retryAfter = null) {
    super(message);
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
  }
}

// ==================== ERROR HANDLING FUNCTIONS ====================

/**
 * Handle database operations with proper error handling
 */
async function handleDatabaseOperation(operation, operationName = 'database operation') {
  try {
    const result = await operation();
    return { success: true, data: result };
  } catch (error) {
    debug(`Database operation failed: ${operationName}`, { error: error.message, stack: error.stack });
    
    // Handle specific database errors
    if (error.name === 'ValidationError') {
      return { 
        success: false, 
        error: 'Data validation failed', 
        details: error.message,
        type: 'validation'
      };
    }
    
    if (error.name === 'CastError') {
      return { 
        success: false, 
        error: 'Invalid data format', 
        details: error.message,
        type: 'format'
      };
    }
    
    if (error.code === 11000) {
      return { 
        success: false, 
        error: 'Duplicate entry found', 
        details: 'This record already exists',
        type: 'duplicate'
      };
    }
    
    return { 
      success: false, 
      error: 'Database operation failed', 
      details: error.message,
      type: 'database'
    };
  }
}

/**
 * Handle API calls with retry logic and proper error handling
 */
async function handleAPICall(apiCall, serviceName = 'external API', maxRetries = 3) {
  let lastError = null;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await apiCall();
      return { success: true, data: result };
    } catch (error) {
      lastError = error;
      debug(`API call failed (attempt ${attempt}/${maxRetries}): ${serviceName}`, { 
        error: error.message, 
        statusCode: error.statusCode || error.response?.status 
      });
      
      // Don't retry on client errors (4xx)
      if (error.statusCode >= 400 && error.statusCode < 500) {
        break;
      }
      
      // Wait before retry (exponential backoff)
      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
      }
    }
  }
  
  return { 
    success: false, 
    error: `${serviceName} service unavailable`, 
    details: lastError?.message || 'Service failed after multiple attempts',
    type: 'api'
  };
}

/**
 * Handle geocoding operations with fallback
 */
async function handleGeocoding(address, fallbackToNominatim = true) {
  const result = await handleAPICall(
    () => getCoordsFromAddress(address),
    'Google Geocoding'
  );
  
  if (!result.success && fallbackToNominatim) {
    debug('Google geocoding failed, trying Nominatim fallback');
    return await handleAPICall(
      () => nominatimGeocode(address),
      'Nominatim Geocoding'
    );
  }
  
  return result;
}

/**
 * Handle Telegram API calls with proper error handling
 */
async function handleTelegramCall(telegramCall, operationName = 'Telegram operation') {
  try {
    const result = await telegramCall();
    return { success: true, data: result };
  } catch (error) {
    debug(`Telegram operation failed: ${operationName}`, { error: error.message });
    
    // Handle specific Telegram errors
    if (error.code === 403) {
      return { 
        success: false, 
        error: 'Bot blocked by user', 
        details: 'User has blocked the bot',
        type: 'telegram_blocked'
      };
    }
    
    if (error.code === 400) {
      return { 
        success: false, 
        error: 'Invalid request', 
        details: error.description || 'Bad request to Telegram API',
        type: 'telegram_invalid'
      };
    }
    
    if (error.code === 429) {
      return { 
        success: false, 
        error: 'Rate limited', 
        details: 'Too many requests to Telegram API',
        type: 'telegram_rate_limit'
      };
    }
    
    return { 
      success: false, 
      error: 'Telegram operation failed', 
      details: error.message,
      type: 'telegram'
    };
  }
}

// ==================== ERROR RECOVERY ====================

/**
 * Attempt to recover from common errors
 */
async function attemptRecovery(error, context = {}) {
  const { type, details } = error;
  
  switch (type) {
    case 'validation':
      return { 
        recoverable: true, 
        message: 'Please check your input and try again',
        suggestion: 'Make sure all required fields are filled correctly'
      };
      
    case 'duplicate':
      return { 
        recoverable: true, 
        message: 'This already exists',
        suggestion: 'Check if you have already created this item'
      };
      
    case 'database':
      return { 
        recoverable: true, 
        message: 'Database error occurred',
        suggestion: 'Please try again in a few moments'
      };
      
    case 'api':
      return { 
        recoverable: true, 
        message: 'Service temporarily unavailable',
        suggestion: 'Please try again later'
      };
      
    case 'telegram_blocked':
      return { 
        recoverable: false, 
        message: 'Bot is blocked by user',
        suggestion: 'User needs to unblock the bot'
      };
      
    case 'telegram_rate_limit':
      return { 
        recoverable: true, 
        message: 'Too many requests',
        suggestion: 'Please wait a moment before trying again'
      };
      
    default:
      return { 
        recoverable: false, 
        message: 'An unexpected error occurred',
        suggestion: 'Please contact support if this persists'
      };
  }
}

// ==================== ERROR LOGGING ====================

/**
 * Log error with context for monitoring
 */
function logError(error, context = {}) {
  const errorLog = {
    timestamp: new Date().toISOString(),
    error: {
      name: error.name,
      message: error.message,
      stack: error.stack
    },
    context: {
      ...context,
      environment: process.env.NODE_ENV || 'development'
    }
  };
  
  debug('Error logged', errorLog);
  
  // In production, you might want to send this to a logging service
  if (process.env.NODE_ENV === 'production') {
    // Send to logging service (e.g., Sentry, LogRocket, etc.)
    console.error('Production error:', JSON.stringify(errorLog));
  }
}

/**
 * Create user-friendly error messages
 */
function createUserFriendlyMessage(error, context = {}) {
  const { type, details } = error;
  
  switch (type) {
    case 'validation':
      return `❌ ${details || 'Please check your input and try again'}`;
      
    case 'duplicate':
      return `❌ ${details || 'This already exists. Please check if you have already created this item.'}`;
      
    case 'database':
      return `❌ Database error. Please try again in a few moments.`;
      
    case 'api':
      return `❌ Service temporarily unavailable. Please try again later.`;
      
    case 'telegram_blocked':
      return `❌ Bot is blocked. Please unblock the bot to continue.`;
      
    case 'telegram_rate_limit':
      return `❌ Too many requests. Please wait a moment before trying again.`;
      
    case 'format':
      return `❌ Invalid format. Please check your input and try again.`;
      
    default:
      return `❌ An unexpected error occurred. Please try again or contact support if this persists.`;
  }
}

// ==================== TIMEOUT HANDLING ====================

/**
 * Create a timeout wrapper for operations
 */
function withTimeout(operation, timeoutMs = 10000) {
  return Promise.race([
    operation(),
    new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Operation timed out')), timeoutMs)
    )
  ]);
}

/**
 * Handle operations with timeout
 */
async function handleWithTimeout(operation, timeoutMs = 10000, operationName = 'operation') {
  try {
    const result = await withTimeout(operation, timeoutMs);
    return { success: true, data: result };
  } catch (error) {
    debug(`Operation timed out: ${operationName}`, { timeoutMs });
    return { 
      success: false, 
      error: 'Operation timed out', 
      details: `${operationName} took too long to complete`,
      type: 'timeout'
    };
  }
}

module.exports = {
  ValidationError,
  DatabaseError,
  APIError,
  RateLimitError,
  handleDatabaseOperation,
  handleAPICall,
  handleGeocoding,
  handleTelegramCall,
  attemptRecovery,
  logError,
  createUserFriendlyMessage,
  withTimeout,
  handleWithTimeout
}; 