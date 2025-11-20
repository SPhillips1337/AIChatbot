const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE_PATH = path.join(__dirname, 'accounts.json');

let accounts = {};
let idIndex = new Map();

function load() {
  try {
    if (fs.existsSync(FILE_PATH)) {
      const data = JSON.parse(fs.readFileSync(FILE_PATH, 'utf8') || '{}');
      accounts = data;
    } else {
      accounts = {};
      fs.writeFileSync(FILE_PATH, JSON.stringify(accounts, null, 2));
    }
  } catch (err) {
    console.error('Failed to load account store:', err);
    accounts = {};
  }

  // Ensure all accounts have expected shape
  Object.keys(accounts).forEach(key => {
    const account = accounts[key];
    if (!account) return;
    account.normalizedUsername = account.normalizedUsername || key;
    account.role = account.role || 'user';
  });

  rebuildIndex();
  persist(); // persist normalization changes, no-op if unchanged
}

function rebuildIndex() {
  idIndex = new Map();
  Object.values(accounts).forEach(account => {
    idIndex.set(account.userId, account);
  });
}

function persist() {
  try {
    fs.writeFileSync(FILE_PATH, JSON.stringify(accounts, null, 2));
    rebuildIndex();
  } catch (err) {
    console.error('Failed to persist account store:', err);
  }
}

function normalizeUsername(username = '') {
  return username.trim().toLowerCase();
}

function generateUserId() {
  if (crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `user_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function createAccount(username, password) {
  if (!username || !password) {
    throw new Error('Username and password are required');
  }
  const normalized = normalizeUsername(username);
  if (accounts[normalized]) {
    const error = new Error('Username already exists');
    error.code = 'USER_EXISTS';
    throw error;
  }
  if (password.length < 6) {
    const error = new Error('Password must be at least 6 characters long');
    error.code = 'PASSWORD_TOO_SHORT';
    throw error;
  }

  const salt = crypto.randomBytes(16).toString('hex');
  const passwordHash = hashPassword(password, salt);
  const userId = generateUserId();
  const displayName = username.trim();

  accounts[normalized] = {
    username: displayName,
    normalizedUsername: normalized,
    userId,
    salt,
    passwordHash,
    role: 'user',
    created_at: new Date().toISOString()
  };
  persist();
  return {
    userId,
    username: displayName,
    role: 'user'
  };
}

function verifyCredentials(username, password) {
  if (!username || !password) return null;
  const normalized = normalizeUsername(username);
  const account = accounts[normalized];
  if (!account) return null;
  try {
    const hash = hashPassword(password, account.salt);
    if (crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(account.passwordHash, 'hex'))) {
      return account;
    }
  } catch (err) {
    console.error('Error verifying credentials:', err.message);
  }
  return null;
}

function getAccountById(userId) {
  return idIndex.get(userId) || null;
}

function listAccounts() {
  return Object.values(accounts).map(({ username, userId, created_at, role }) => ({
    username,
    userId,
    created_at,
    role: role || 'user'
  }));
}

function assignRoleByUserId(userId, role = 'user') {
  const account = getAccountById(userId);
  if (!account) return false;
  const normalized = account.normalizedUsername;
  if (!normalized || !accounts[normalized]) return false;
  if (account.role === role) return true;
  account.role = role;
  accounts[normalized].role = role;
  persist();
  return true;
}

load();

module.exports = {
  createAccount,
  verifyCredentials,
  getAccountById,
  listAccounts,
  assignRoleByUserId
};

