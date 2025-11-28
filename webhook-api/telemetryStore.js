const fs = require('fs');
const path = require('path');

/**
 * Telemetry Store
 * Handles telemetry event recording and retrieval
 */

const TELEMETRY_FILE = path.join(__dirname, 'telemetry.json');
const MAX_EVENTS = 10000; // Maximum number of events to keep

let telemetryData = {
  events: [],
  stats: {
    totalEvents: 0,
    eventTypes: {}
  }
};

/**
 * Load telemetry data from file
 */
function loadTelemetryData() {
  try {
    if (fs.existsSync(TELEMETRY_FILE)) {
      const rawData = fs.readFileSync(TELEMETRY_FILE, 'utf8');
      telemetryData = JSON.parse(rawData);
      
      // Ensure structure
      if (!telemetryData.events) telemetryData.events = [];
      if (!telemetryData.stats) telemetryData.stats = { totalEvents: 0, eventTypes: {} };
    }
  } catch (error) {
    console.error('Error loading telemetry data:', error);
    telemetryData = { events: [], stats: { totalEvents: 0, eventTypes: {} } };
  }
}

/**
 * Save telemetry data to file
 */
function saveTelemetryData() {
  try {
    fs.writeFileSync(TELEMETRY_FILE, JSON.stringify(telemetryData, null, 2));
  } catch (error) {
    console.error('Error saving telemetry data:', error);
  }
}

/**
 * Record a telemetry event
 * @param {string} type - Event type
 * @param {Object} data - Event data
 * @param {string} userId - Optional user ID
 */
function recordEvent(type, data = {}, userId = null) {
  const event = {
    id: generateEventId(),
    type,
    data,
    userId,
    timestamp: new Date().toISOString()
  };

  // Add event to the beginning of the array
  telemetryData.events.unshift(event);

  // Update stats
  telemetryData.stats.totalEvents++;
  telemetryData.stats.eventTypes[type] = (telemetryData.stats.eventTypes[type] || 0) + 1;

  // Trim events if we exceed the maximum
  if (telemetryData.events.length > MAX_EVENTS) {
    telemetryData.events = telemetryData.events.slice(0, MAX_EVENTS);
  }

  // Save to file (async to avoid blocking)
  setImmediate(() => saveTelemetryData());

  console.log(`Telemetry event recorded: ${type}`, { userId, dataKeys: Object.keys(data) });
}

/**
 * Get recent events
 * @param {number} limit - Maximum number of events to return
 * @param {string} type - Optional event type filter
 * @returns {Array} - Array of events
 */
function getRecentEvents(limit = 100, type = null) {
  let events = telemetryData.events;

  // Filter by type if specified
  if (type) {
    events = events.filter(event => event.type === type);
  }

  // Return limited results
  return events.slice(0, limit);
}

/**
 * Get telemetry statistics
 * @returns {Object} - Statistics object
 */
function getStats() {
  return {
    ...telemetryData.stats,
    recentEventTypes: getRecentEventTypeStats(),
    oldestEvent: telemetryData.events.length > 0 ? 
      telemetryData.events[telemetryData.events.length - 1].timestamp : null,
    newestEvent: telemetryData.events.length > 0 ? 
      telemetryData.events[0].timestamp : null
  };
}

/**
 * Get recent event type statistics (last 24 hours)
 * @returns {Object} - Event type counts for last 24 hours
 */
function getRecentEventTypeStats() {
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recentEvents = telemetryData.events.filter(event => 
    new Date(event.timestamp) > oneDayAgo
  );

  const stats = {};
  recentEvents.forEach(event => {
    stats[event.type] = (stats[event.type] || 0) + 1;
  });

  return stats;
}

/**
 * Clear old events (older than specified days)
 * @param {number} days - Number of days to keep
 * @returns {number} - Number of events removed
 */
function clearOldEvents(days = 30) {
  const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const originalLength = telemetryData.events.length;
  
  telemetryData.events = telemetryData.events.filter(event => 
    new Date(event.timestamp) > cutoffDate
  );

  const removedCount = originalLength - telemetryData.events.length;
  
  if (removedCount > 0) {
    saveTelemetryData();
    console.log(`Cleared ${removedCount} old telemetry events`);
  }

  return removedCount;
}

/**
 * Clear all events
 * @returns {number} - Number of events cleared
 */
function clearAllEvents() {
  const count = telemetryData.events.length;
  telemetryData.events = [];
  telemetryData.stats = { totalEvents: 0, eventTypes: {} };
  saveTelemetryData();
  console.log(`Cleared all ${count} telemetry events`);
  return count;
}

/**
 * Generate unique event ID
 * @returns {string} - Unique event ID
 */
function generateEventId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

/**
 * Export events to JSON
 * @param {Object} options - Export options
 * @returns {Object} - Export data
 */
function exportEvents(options = {}) {
  const { 
    limit = null, 
    type = null, 
    startDate = null, 
    endDate = null 
  } = options;

  let events = telemetryData.events;

  // Apply filters
  if (type) {
    events = events.filter(event => event.type === type);
  }

  if (startDate) {
    const start = new Date(startDate);
    events = events.filter(event => new Date(event.timestamp) >= start);
  }

  if (endDate) {
    const end = new Date(endDate);
    events = events.filter(event => new Date(event.timestamp) <= end);
  }

  if (limit) {
    events = events.slice(0, limit);
  }

  return {
    events,
    exportedAt: new Date().toISOString(),
    totalEvents: events.length,
    filters: options
  };
}

// Initialize telemetry data on module load
loadTelemetryData();

// Periodic cleanup of old events (run every hour)
setInterval(() => {
  clearOldEvents(30); // Keep 30 days of events
}, 60 * 60 * 1000);

module.exports = {
  recordEvent,
  getRecentEvents,
  getStats,
  clearOldEvents,
  clearAllEvents,
  exportEvents
};