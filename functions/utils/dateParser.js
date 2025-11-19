// Enhanced date/time parsing utility for RideEase
// Optional: install chrono-node for better natural language parsing
let chrono = null;
try {
  chrono = require('chrono-node');
} catch (e) {
  console.log('chrono-node not available, using fallback parsing');
}

/**
 * Enhanced date parsing that handles natural language inputs
 * Supports: "today", "tomorrow", specific dates, times, etc.
 * Always returns a Date object with proper date and time
 */
function parseDateTime(input) {
  if (!input || typeof input !== 'string') {
    return null;
  }

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  
  console.log("🐛 DEBUG: parseDateTime input:", input);
  console.log("🐛 DEBUG: now:", now.toISOString());
  console.log("🐛 DEBUG: today:", today.toISOString());
  console.log("🐛 DEBUG: tomorrow:", tomorrow.toISOString());
  
  // Normalize input
  const text = input.toLowerCase().trim();
  
  // Handle "now" or "right now"
  if (text.match(/^(now|right\s+now)$/)) {
    return now;
  }
  
  // Handle "today" patterns
  if (text.match(/^today$/)) {
    // If just "today" with no time, default to current time
    return now;
  }
  
  if (text.match(/^today\s+/)) {
    // "today 6pm", "today 18:30", etc.
    const timeStr = text.replace(/^today\s+/, '');
    const parsedTime = parseTimeOnly(timeStr);
    if (parsedTime) {
      const todayWithTime = new Date(today.getTime() + parsedTime.timeOffset);
      
      // If the parsed time for today is in the past (accounting for 2min buffer for processing),
      // assume they mean tomorrow
      const buffer = 2 * 60 * 1000; // 2 minutes - reduced from 5 minutes to be more strict
      if (todayWithTime.getTime() < (now.getTime() - buffer)) {
        console.log("🐛 DEBUG: 'today' time is in the past, moving to tomorrow");
        return new Date(tomorrow.getTime() + parsedTime.timeOffset);
      }
      
      return todayWithTime;
    }
  }
  
  // Handle "tomorrow" patterns  
  if (text.match(/^tomorrow$/)) {
    // If just "tomorrow" with no time, default to 9 AM tomorrow
    return new Date(tomorrow.getTime() + 9 * 60 * 60 * 1000);
  }
  
  if (text.match(/^tomorrow\s+/)) {
    // "tomorrow 6pm", "tomorrow 18:30", etc.
    const timeStr = text.replace(/^tomorrow\s+/, '');
    const parsedTime = parseTimeOnly(timeStr);
    if (parsedTime) {
      return new Date(tomorrow.getTime() + parsedTime.timeOffset);
    }
  }
  
  // Handle specific dates with times
  // "December 25 6pm", "2024-12-25 18:30", etc.
  
  // Handle standalone time inputs that might be in the past FIRST
  // "6pm", "18:30", "4:00 am" without explicit date
  const timeOnlyPattern = /^(?:at\s+)?(\d{1,2}):?(\d{2})?\s*(am|pm)$/i;
  if (timeOnlyPattern.test(text.trim())) {
    const parsedTime = parseTimeOnly(text);
    if (parsedTime) {
      const todayWithTime = new Date(today.getTime() + parsedTime.timeOffset);
      console.log("🕐 DEBUG: Parsed time-only input:", text);
      console.log("🕐 DEBUG: timeOffset (ms):", parsedTime.timeOffset);
      console.log("🕐 DEBUG: timeOffset (hours):", parsedTime.timeOffset / (60 * 60 * 1000));
      console.log("🕐 DEBUG: today base date:", today.toISOString());
      console.log("🕐 DEBUG: todayWithTime result:", todayWithTime.toISOString());
      console.log("🕐 DEBUG: todayWithTime local:", todayWithTime.toLocaleString());
      console.log("🕐 DEBUG: now for comparison:", now.toISOString());
      
      // If this time has already passed today, assume tomorrow
      // Use a more generous buffer since rides should be in the future
      if (todayWithTime <= now) {
        const tomorrowWithTime = new Date(tomorrow.getTime() + parsedTime.timeOffset);
        console.log("🕐 DEBUG: Time was in past, moved to tomorrow:", tomorrowWithTime.toISOString());
        return tomorrowWithTime;
      }
      return todayWithTime;
    }
  }
  
  try {
    // Try chrono-node for natural language parsing (if available)
    if (chrono) {
      const chronoParsed = chrono.parseDate(input, now);
      if (chronoParsed && !isNaN(chronoParsed.getTime())) {
        // If chrono parsed a time that's in the past, and it looks like a time-only input, 
        // we already handled it above, so just return the chrono result
        return chronoParsed;
      }
    }
  } catch (error) {
    console.log('Chrono parsing failed:', error);
  }
  
  // Fallback to native Date parsing
  try {
    const nativeDate = new Date(input);
    if (!isNaN(nativeDate.getTime())) {
      return nativeDate;
    }
  } catch (error) {
    console.log('Native date parsing failed:', error);
  }
  
  return null;
}

/**
 * Parse time-only strings like "6pm", "18:30", "6:30am"
 * Returns { timeOffset: milliseconds from start of day }
 */
function parseTimeOnly(timeStr) {
  const time = timeStr.trim().toLowerCase();
  
  // Handle 12-hour format with am/pm
  const twelveHourMatch = time.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/);
  if (twelveHourMatch) {
    let hours = parseInt(twelveHourMatch[1]);
    const minutes = parseInt(twelveHourMatch[2] || '0');
    const period = twelveHourMatch[3];
    
    // Convert to 24-hour format
    if (period === 'am' && hours === 12) hours = 0;
    if (period === 'pm' && hours !== 12) hours += 12;
    
    return {
      timeOffset: (hours * 60 * 60 * 1000) + (minutes * 60 * 1000)
    };
  }
  
  // Handle 24-hour format
  const twentyFourHourMatch = time.match(/^(\d{1,2}):(\d{2})$/);
  if (twentyFourHourMatch) {
    const hours = parseInt(twentyFourHourMatch[1]);
    const minutes = parseInt(twentyFourHourMatch[2]);
    
    if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
      return {
        timeOffset: (hours * 60 * 60 * 1000) + (minutes * 60 * 1000)
      };
    }
  }
  
  // Handle simple hour format "6", "18"
  const hourMatch = time.match(/^(\d{1,2})$/);
  if (hourMatch) {
    const hours = parseInt(hourMatch[1]);
    if (hours >= 0 && hours <= 23) {
      return {
        timeOffset: hours * 60 * 60 * 1000
      };
    }
  }
  
  return null;
}

/**
 * Validate that the parsed date is not in the past
 * Allows a 5-minute buffer for processing delays
 */
function isValidFutureTime(date) {
  if (!date || isNaN(date.getTime())) {
    return false;
  }
  
  const now = Date.now();
  const buffer = 2 * 60 * 1000; // 2 minute buffer - reduced from 5 minutes
  
  return date.getTime() >= (now - buffer);
}

/**
 * Format date for display to users
 */
function formatDateTime(date) {
  if (!date || isNaN(date.getTime())) {
    return 'Invalid date';
  }
  
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  
  const timeStr = date.toLocaleTimeString('en-US', { 
    hour: 'numeric', 
    minute: '2-digit',
    hour12: true 
  });
  
  if (dateOnly.getTime() === today.getTime()) {
    return `Today ${timeStr}`;
  } else if (dateOnly.getTime() === tomorrow.getTime()) {
    return `Tomorrow ${timeStr}`;
  } else {
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  }
}

module.exports = {
  parseDateTime,
  parseTimeOnly,
  isValidFutureTime,
  formatDateTime
};
