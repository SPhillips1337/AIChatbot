const fs = require('fs');
const path = require('path');

const FILE_PATH = path.join(__dirname, 'profile.json');

let store = {};

function load() {
  try {
    if (fs.existsSync(FILE_PATH)) {
      const raw = fs.readFileSync(FILE_PATH, 'utf8');
      store = JSON.parse(raw || '{}');
    } else {
      store = {};
      fs.writeFileSync(FILE_PATH, JSON.stringify(store, null, 2));
    }
  } catch (err) {
    console.error('Error loading profile store:', err);
    store = {};
  }
}

function saveToDisk() {
  try {
    fs.writeFileSync(FILE_PATH, JSON.stringify(store, null, 2));
  } catch (err) {
    console.error('Error saving profile store:', err);
  }
}

// Public API
function getProfile(userId) {
  return store[userId] || null;
}

function saveProfile(userId, profile) {
  profile.updated_at = new Date().toISOString();
  store[userId] = profile;
  saveToDisk();
  return profile;
}

function listProfiles() {
  return store;
}

function deleteProfile(userId) {
  if (store[userId]) {
    delete store[userId];
    saveToDisk();
    return true;
  }
  return false;
}

// Initialize on require
load();

module.exports = {
  getProfile,
  saveProfile,
  listProfiles,
  deleteProfile
};
