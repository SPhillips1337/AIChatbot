const fs = require('fs');
const path = require('path');

const FILE_PATH = path.join(__dirname, 'telemetry.json');
let store = [];

function load() {
  try {
    if (fs.existsSync(FILE_PATH)) {
      const raw = fs.readFileSync(FILE_PATH, 'utf8') || '[]';
      store = JSON.parse(raw);
    } else {
      store = [];
      fs.writeFileSync(FILE_PATH, JSON.stringify(store, null, 2));
    }
  } catch (err) {
    console.error('Error loading telemetry store:', err);
    store = [];
  }
}

function saveToDisk() {
  try {
    fs.writeFileSync(FILE_PATH, JSON.stringify(store, null, 2));
  } catch (err) {
    console.error('Error saving telemetry store:', err);
  }
}

function appendEvent(event) {
  try {
    const ev = Object.assign({ timestamp: new Date().toISOString() }, event);
    store.push(ev);
    // keep store size bounded to last 10000 events
    if (store.length > 10000) store = store.slice(store.length - 10000);
    saveToDisk();
    return ev;
  } catch (err) {
    console.error('Error appending telemetry event:', err);
    return null;
  }
}

function listEvents(limit = 200) {
  return store.slice(-Math.max(0, limit)).reverse();
}

// initialize
load();

module.exports = {
  appendEvent,
  listEvents
};
