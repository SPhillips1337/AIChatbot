const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const FILE_PATH = path.join(__dirname, 'accounts.json');

let accounts = {};
let idIndex = new Map();
let loadingPromise = null;

async function load() {
  try {
    await fs.access(FILE_PATH);
    const data = await fs.readFile(FILE_PATH, 'utf8');
    accounts = JSON.parse(data || '{}');
  } catch (err) {
    if (err.code === 'ENOENT') {
      accounts = {};
      await persist();
    } else {
      console.error('Failed to load account store:', err);
      accounts = {};
    }
  }

  let changed = false;
  Object.keys(accounts).forEach(key => {
    const account = accounts[key];
    if (!account) return;
    if (!account.normalizedUsername) {
      account.normalizedUsername = key;
      changed = true;
    }
    if (!account.role) {
      account.role = 'user';
      changed = true;
    }
    if (!account.sessionToken) {
      account.sessionToken = generateSessionToken();
      changed = true;
    }
  });

  rebuildIndex();
  if (changed) {
    await persist();
  }
}

function rebuildIndex() {
  idIndex = new Map();
  Object.values(accounts).forEach(account => {
    idIndex.set(account.userId, account);
  });
}

async function persist() {
  try {
    await fs.writeFile(FILE_PATH, JSON.stringify(accounts, null, 2));
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

function generateSessionToken() {
  return crypto.randomBytes(24).toString('hex');
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

async function createAccount(username, password) {
  await loadingPromise;
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
  const sessionToken = generateSessionToken();

  accounts[normalized] = {
    username: displayName,
    normalizedUsername: normalized,
    userId,
    salt,
    passwordHash,
    sessionToken,
    role: 'user',
    created_at: new Date().toISOString()
  };
  await persist();
  return {
    userId,
    username: displayName,
    role: 'user',
    token: sessionToken
  };
}

async function verifyCredentials(username, password) {
  await loadingPromise;
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

async function issueSessionToken(userId) {
  await loadingPromise;
  const account = getAccountById(userId);
  if (!account) return null;
  const normalized = account.normalizedUsername;
  if (!normalized || !accounts[normalized]) return null;
  const token = generateSessionToken();
  account.sessionToken = token;
  accounts[normalized].sessionToken = token;
  await persist();
  return token;
}

async function verifySessionToken(userId, token) {
  await loadingPromise;
  if (!userId || !token) return false;
  const account = getAccountById(userId);
  if (!account || !account.sessionToken) return false;
  return account.sessionToken === token;
}

function getAccountById(userId) {
  return idIndex.get(userId) || null;
}

async function listAccounts() {
  await loadingPromise;
  return Object.values(accounts).map(({ username, userId, created_at, role }) => ({
    username,
    userId,
    created_at,
    role: role || 'user'
  }));
}

async function assignRoleByUserId(userId, role = 'user') {
  await loadingPromise;
  const account = getAccountById(userId);
  if (!account) return false;
  const normalized = account.normalizedUsername;
  if (!normalized || !accounts[normalized]) return false;
  if (account.role === role) return true;
  account.role = role;
  accounts[normalized].role = role;
  await persist();
  return true;
}

async function deleteAccount(userId) {
  await loadingPromise;
  const account = getAccountById(userId);
  if (!account) return false;
  const normalized = account.normalizedUsername;
  if (!normalized || !accounts[normalized]) return false;
  delete accounts[normalized];
  await persist();
  return true;
}

loadingPromise = load();

module.exports = {
  createAccount,
  verifyCredentials,
  getAccountById,
  listAccounts,
  assignRoleByUserId,
  issueSessionToken,
  verifySessionToken,
  deleteAccount
};
