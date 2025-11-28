const accountStore = require('../accountStore');
const config = require('../config');

/**
 * Authentication Middleware
 * Handles user authentication and authorization
 */

const DEFAULT_ADMIN_USER_IDS = config.get('adminUserIds');
const ADMIN_USER_IDS = new Set(DEFAULT_ADMIN_USER_IDS);

// Ensure admin roles are assigned
ADMIN_USER_IDS.forEach(id => accountStore.assignRoleByUserId(id, 'admin'));

/**
 * Ensures account has proper role assignment
 * @param {Object} account - User account object
 * @returns {string} - User role
 */
function ensureAccountRole(account) {
  if (!account) return 'user';
  
  if (ADMIN_USER_IDS.has(account.userId)) {
    accountStore.assignRoleByUserId(account.userId, 'admin');
    account.role = 'admin';
  }
  
  if (!account.role) {
    account.role = 'user';
  }
  
  return account.role;
}

/**
 * Authenticates request using headers
 * @param {Object} req - Express request object
 * @returns {Object|null} - Authenticated account or null
 */
function authenticateRequest(req) {
  const userId = req.headers['x-user-id'];
  const token = req.headers['x-auth-token'];
  
  if (!userId || !token) {
    return null;
  }
  
  const account = accountStore.getAccountById(userId);
  if (!account) {
    return null;
  }
  
  if (!accountStore.verifySessionToken(userId, token)) {
    return null;
  }
  
  ensureAccountRole(account);
  return account;
}

/**
 * Express middleware factory for authentication
 * @param {Object} options - Authentication options
 * @param {boolean} options.admin - Require admin privileges
 * @param {boolean} options.optional - Make authentication optional
 * @returns {Function} - Express middleware function
 */
function requireAuth(options = {}) {
  const { admin = false, optional = false } = options;
  
  return (req, res, next) => {
    const account = authenticateRequest(req);
    
    if (!account && !optional) {
      return res.status(401).json({ 
        error: 'Authentication required',
        code: 'AUTH_REQUIRED'
      });
    }
    
    if (account && admin && account.role !== 'admin') {
      return res.status(403).json({ 
        error: 'Admin privileges required',
        code: 'ADMIN_REQUIRED'
      });
    }
    
    req.account = account;
    next();
  };
}

/**
 * WebSocket authentication helper
 * @param {Object} data - WebSocket message data
 * @returns {Object|null} - Authenticated account or null
 */
function authenticateWebSocket(data) {
  if (!data.userId) {
    return null;
  }
  
  const token = data.token;
  if (token && accountStore.verifySessionToken(data.userId, token)) {
    const account = accountStore.getAccountById(data.userId);
    if (account) {
      ensureAccountRole(account);
      return account;
    }
  }
  
  // Allow anonymous bind without token (best-effort)
  return { userId: data.userId, role: 'user', anonymous: true };
}

/**
 * Check if user has admin privileges
 * @param {string} userId - User ID to check
 * @returns {boolean} - True if user is admin
 */
function isAdmin(userId) {
  return ADMIN_USER_IDS.has(userId);
}

/**
 * Add user to admin list (runtime only)
 * @param {string} userId - User ID to add as admin
 */
function addAdmin(userId) {
  ADMIN_USER_IDS.add(userId);
  accountStore.assignRoleByUserId(userId, 'admin');
}

module.exports = {
  ensureAccountRole,
  authenticateRequest,
  requireAuth,
  authenticateWebSocket,
  isAdmin,
  addAdmin,
  ADMIN_USER_IDS
};