const fs = require('fs').promises;
const path = require('path');

const FILE_PATH = path.join(__dirname, 'profile.json');

let store = {};
let loadingPromise = null;

async function load() {
  try {
    await fs.access(FILE_PATH);
    const raw = await fs.readFile(FILE_PATH, 'utf8');
    store = JSON.parse(raw || '{}');
  } catch (err) {
    if (err.code === 'ENOENT') {
      store = {};
      await saveToDisk();
    } else {
      console.error('Error loading profile store:', err);
      store = {};
    }
  }
}

async function saveToDisk() {
  try {
    await fs.writeFile(FILE_PATH, JSON.stringify(store, null, 2));
  } catch (err) {
    console.error('Error saving profile store:', err);
  }
}

async function getProfile(userId) {
  await loadingPromise;
  return store[userId] || null;
}

async function saveProfile(userId, profile) {
  await loadingPromise;
  profile.updated_at = new Date().toISOString();
  store[userId] = profile;
  await saveToDisk();
  return profile;
}

async function listProfiles() {
  await loadingPromise;
  return store;
}

async function deleteProfile(userId) {
  await loadingPromise;
  if (store[userId]) {
    delete store[userId];
    await saveToDisk();
    return true;
  }
  return false;
}

async function addRelationship(userId, type, targetId, metadata = {}) {
  await loadingPromise;
  if (!store[userId]) store[userId] = {};
  if (!store[userId].relationships) store[userId].relationships = {};
  if (!store[userId].relationships[type]) store[userId].relationships[type] = [];
  
  const existing = store[userId].relationships[type].find(rel => rel.targetId === targetId);
  if (existing) {
    Object.assign(existing, metadata);
    existing.updated = new Date().toISOString();
  } else {
    store[userId].relationships[type].push({
      targetId,
      created: new Date().toISOString(),
      ...metadata
    });
  }
  await saveToDisk();
}

async function getRelationships(userId, type = null) {
  await loadingPromise;
  const profile = store[userId];
  if (!profile?.relationships) return [];
  return type ? (profile.relationships[type] || []) : profile.relationships;
}

async function findUsersWithSharedInterests(userId, minShared = 1) {
  await loadingPromise;
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

loadingPromise = load();

module.exports = {
  getProfile,
  saveProfile,
  listProfiles,
  deleteProfile,
  addRelationship,
  getRelationships,
  findUsersWithSharedInterests
};
