const express = require('express');
const accountStore = require('../accountStore');
const { validateSchema, schemas } = require('../middleware/validation');
const { asyncHandler } = require('../middleware/errorHandler');
const { ensureAccountRole } = require('../middleware/auth');

const router = express.Router();

/**
 * User Registration
 * POST /api/auth/register
 */
router.post('/register', 
  validateSchema(schemas.userRegistration),
  asyncHandler(async (req, res) => {
    const { username, password } = req.body;
    
    try {
      const account = accountStore.createAccount(username, password);
      const savedAccount = accountStore.getAccountById(account.userId);
      const role = ensureAccountRole(savedAccount);
      const token = account.token || accountStore.issueSessionToken(savedAccount.userId);
      
      res.status(201).json({
        success: true,
        userId: savedAccount.userId,
        displayName: savedAccount.username,
        role,
        token
      });
    } catch (error) {
      const status = error.code === 'USER_EXISTS' ? 409 : 400;
      res.status(status).json({ 
        error: error.message || 'Failed to create account',
        code: error.code || 'REGISTRATION_ERROR'
      });
    }
  })
);

/**
 * User Login
 * POST /api/auth/login
 */
router.post('/login',
  validateSchema({
    username: { required: true, type: 'string', minLength: 1 },
    password: { required: true, type: 'string', minLength: 1 }
  }),
  asyncHandler(async (req, res) => {
    const { username, password } = req.body;
    
    const account = accountStore.verifyCredentials(username, password);
    if (!account) {
      return res.status(401).json({ 
        error: 'Invalid username or password',
        code: 'INVALID_CREDENTIALS'
      });
    }
    
    const role = ensureAccountRole(account);
    const token = accountStore.issueSessionToken(account.userId);
    
    res.json({
      success: true,
      userId: account.userId,
      displayName: account.username,
      role,
      token
    });
  })
);

/**
 * Token Refresh
 * POST /api/auth/refresh
 */
router.post('/refresh',
  validateSchema({
    userId: { required: true, type: 'string', minLength: 1 },
    token: { required: true, type: 'string', minLength: 1 }
  }),
  asyncHandler(async (req, res) => {
    const { userId, token } = req.body;
    
    if (!accountStore.verifySessionToken(userId, token)) {
      return res.status(401).json({
        error: 'Invalid or expired token',
        code: 'INVALID_TOKEN'
      });
    }
    
    const account = accountStore.getAccountById(userId);
    if (!account) {
      return res.status(404).json({
        error: 'Account not found',
        code: 'ACCOUNT_NOT_FOUND'
      });
    }
    
    const newToken = accountStore.issueSessionToken(userId);
    const role = ensureAccountRole(account);
    
    res.json({
      success: true,
      userId: account.userId,
      displayName: account.username,
      role,
      token: newToken
    });
  })
);

/**
 * Logout
 * POST /api/auth/logout
 */
router.post('/logout',
  validateSchema({
    userId: { required: true, type: 'string', minLength: 1 }
  }),
  asyncHandler(async (req, res) => {
    const { userId } = req.body;
    
    // Invalidate the session by issuing a new token
    // (This effectively logs out the current session)
    accountStore.issueSessionToken(userId);
    
    res.json({
      success: true,
      message: 'Logged out successfully'
    });
  })
);

/**
 * Get Current User Info
 * GET /api/auth/me
 */
router.get('/me',
  asyncHandler(async (req, res) => {
    const userId = req.headers['x-user-id'];
    const token = req.headers['x-auth-token'];
    
    if (!userId || !token) {
      return res.status(401).json({
        error: 'Authentication required',
        code: 'AUTH_REQUIRED'
      });
    }
    
    if (!accountStore.verifySessionToken(userId, token)) {
      return res.status(401).json({
        error: 'Invalid or expired token',
        code: 'INVALID_TOKEN'
      });
    }
    
    const account = accountStore.getAccountById(userId);
    if (!account) {
      return res.status(404).json({
        error: 'Account not found',
        code: 'ACCOUNT_NOT_FOUND'
      });
    }
    
    const role = ensureAccountRole(account);
    
    res.json({
      userId: account.userId,
      displayName: account.username,
      role,
      created_at: account.created_at
    });
  })
);

module.exports = router;