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

// Relationship tracking
function addRelationship(userId, type, targetId, metadata = {}) {
  if (!store[userId]) store[userId] = {};
  if (!store[userId].relationships) store[userId].relationships = {};
  if (!store[userId].relationships[type]) store[userId].relationships[type] = [];
  
  // Check if relationship already exists
  const existing = store[userId].relationships[type].find(rel => rel.targetId === targetId);
  if (existing) {
    // Update existing relationship with new metadata
    Object.assign(existing, metadata);
    existing.updated = new Date().toISOString();
  } else {
    // Add new relationship
    store[userId].relationships[type].push({
      targetId,
      created: new Date().toISOString(),
      ...metadata
    });
  }
  saveToDisk();
}

function getRelationships(userId, type = null) {
  const profile = store[userId];
  if (!profile?.relationships) return [];
  return type ? (profile.relationships[type] || []) : profile.relationships;
}

function findUsersWithSharedInterests(userId, minShared = 1) {
  const userProfile = store[userId];
  if (!userProfile?.facts) return [];
  
  const userInterests = Object.keys(userProfile.facts);
  const matches = [];
  
  Object.keys(store).forEach(otherUserId => {
    if (otherUserId === userId) return;
    const otherProfile = store[otherUserId];
    if (!otherProfile?.facts) return;
    
    const sharedInterests = userInterests.filter(interest => 
      otherProfile.facts[interest]
    );
    
    if (sharedInterests.length >= minShared) {
      matches.push({ userId: otherUserId, sharedInterests });
    }
  });
  
  return matches;
}

// Initialize on require
load();

module.exports = {
  getProfile,
  saveProfile,
  listProfiles,
  deleteProfile,
  addRelationship,
  getRelationships,
  findUsersWithSharedInterests
};
