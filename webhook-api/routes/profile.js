const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { validateSchema, rateLimit } = require('../middleware/validation');
const { asyncHandler } = require('../middleware/errorHandler');
const profileStore = require('../profileStore');
const telemetryStore = require('../telemetryStore');

const router = express.Router();

// Apply rate limiting
router.use(rateLimit({ windowMs: 60000, maxRequests: 50 })); // 50 requests per minute

/**
 * Get User Profile
 * GET /api/profile/:userId
 */
router.get('/:userId',
  requireAuth(),
  asyncHandler(async (req, res) => {
    const { userId } = req.params;
    
    // Users can only access their own profile unless they're admin
    if (req.account.userId !== userId && req.account.role !== 'admin') {
      return res.status(403).json({
        error: 'Access denied',
        code: 'ACCESS_DENIED'
      });
    }
    
    try {
      const profile = await profileStore.getProfile(userId);
      
      if (!profile) {
        return res.status(404).json({
          error: 'Profile not found',
          code: 'PROFILE_NOT_FOUND'
        });
      }
      
      // Remove sensitive information for non-admin users
      if (req.account.role !== 'admin') {
        delete profile.trustLevel;
        delete profile.lastAsked;
      }
      
      res.json(profile);
    } catch (error) {
      console.error('Error getting profile:', error);
      res.status(500).json({
        error: 'Failed to retrieve profile',
        code: 'PROFILE_ERROR'
      });
    }
  })
);

/**
 * Update User Profile
 * PUT /api/profile/:userId
 */
router.put('/:userId',
  requireAuth(),
  validateSchema({
    interests: { required: false, type: 'object' },
    displayName: { required: false, type: 'string', maxLength: 100 }
  }),
  asyncHandler(async (req, res) => {
    const { userId } = req.params;
    
    // Users can only update their own profile unless they're admin
    if (req.account.userId !== userId && req.account.role !== 'admin') {
      return res.status(403).json({
        error: 'Access denied',
        code: 'ACCESS_DENIED'
      });
    }
    
    try {
      let profile = await profileStore.getProfile(userId);
      
      if (!profile) {
        return res.status(404).json({
          error: 'Profile not found',
          code: 'PROFILE_NOT_FOUND'
        });
      }
      
      // Update allowed fields
      const { interests, displayName } = req.body;
      
      if (interests !== undefined) {
        profile.interests = interests;
      }
      
      if (displayName !== undefined) {
        profile.displayName = displayName;
      }
      
      profile.updated_at = new Date().toISOString();
      
      await profileStore.saveProfile(userId, profile);
      
      res.json({
        success: true,
        profile
      });
    } catch (error) {
      console.error('Error updating profile:', error);
      res.status(500).json({
        error: 'Failed to update profile',
        code: 'PROFILE_UPDATE_ERROR'
      });
    }
  })
);

/**
 * Confirm Fact
 * POST /api/profile/confirm-fact
 */
router.post('/confirm-fact',
  requireAuth(),
  validateSchema({
    key: { required: true, type: 'string', minLength: 1 },
    value: { required: true, type: 'string', minLength: 1 },
    confirmed: { required: true, type: 'boolean' },
    userId: { required: true, type: 'string', minLength: 1 }
  }),
  asyncHandler(async (req, res) => {
    const { key, value, confirmed, userId } = req.body;
    
    // Users can only confirm facts for their own profile
    if (req.account.userId !== userId && req.account.role !== 'admin') {
      return res.status(403).json({
        error: 'Access denied',
        code: 'ACCESS_DENIED'
      });
    }
    
    try {
      let profile = await profileStore.getProfile(userId);
      
      if (!profile) {
        // Create new profile if it doesn't exist
        profile = {
          facts: {},
          interests: [],
          sentimentHistory: [],
          trustLevel: 5,
          conversationTopics: [],
          lastAsked: {},
          created_at: new Date().toISOString()
        };
      }
      
      profile.facts = profile.facts || {};
      
      if (confirmed) {
        // Save the confirmed fact
        profile.facts[key] = {
          value,
          confirmed: true,
          timestamp: new Date().toISOString()
        };
        
        // Record telemetry
        telemetryStore.recordEvent('fact_confirmed', {
          userId,
          key,
          value,
          method: 'manual_confirmation'
        });
        
        console.log(`Fact confirmed for user ${userId}: ${key} = ${value}`);
      } else {
        // Remove the fact if rejected
        delete profile.facts[key];
        
        // Record telemetry
        telemetryStore.recordEvent('fact_rejected', {
          userId,
          key,
          value,
          method: 'manual_rejection'
        });
        
        console.log(`Fact rejected for user ${userId}: ${key} = ${value}`);
      }
      
      await profileStore.saveProfile(userId, profile);
      
      res.json({
        success: true,
        confirmed,
        key,
        value,
        message: confirmed ? 'Fact confirmed and saved' : 'Fact rejected and removed'
      });
    } catch (error) {
      console.error('Error confirming fact:', error);
      res.status(500).json({
        error: 'Failed to confirm fact',
        code: 'FACT_CONFIRMATION_ERROR'
      });
    }
  })
);

/**
 * Remove Fact
 * POST /api/profile/remove-fact
 */
router.post('/remove-fact',
  requireAuth(),
  validateSchema({
    key: { required: true, type: 'string', minLength: 1 },
    userId: { required: true, type: 'string', minLength: 1 }
  }),
  asyncHandler(async (req, res) => {
    const { key, userId } = req.body;
    
    // Users can only remove facts from their own profile
    if (req.account.userId !== userId && req.account.role !== 'admin') {
      return res.status(403).json({
        error: 'Access denied',
        code: 'ACCESS_DENIED'
      });
    }
    
    try {
      const profile = await profileStore.getProfile(userId);
      
      if (!profile || !profile.facts || !profile.facts[key]) {
        return res.status(404).json({
          error: 'Fact not found',
          code: 'FACT_NOT_FOUND'
        });
      }
      
      const removedFact = profile.facts[key];
      delete profile.facts[key];
      
      await profileStore.saveProfile(userId, profile);
      
      // Record telemetry
      telemetryStore.recordEvent('fact_deleted', {
        userId,
        key,
        value: removedFact.value,
        method: 'manual_deletion'
      });
      
      console.log(`Fact removed for user ${userId}: ${key}`);
      
      res.json({
        success: true,
        key,
        message: 'Fact removed successfully'
      });
    } catch (error) {
      console.error('Error removing fact:', error);
      res.status(500).json({
        error: 'Failed to remove fact',
        code: 'FACT_REMOVAL_ERROR'
      });
    }
  })
);

/**
 * Get User Facts
 * GET /api/profile/:userId/facts
 */
router.get('/:userId/facts',
  requireAuth(),
  asyncHandler(async (req, res) => {
    const { userId } = req.params;
    
    // Users can only access their own facts unless they're admin
    if (req.account.userId !== userId && req.account.role !== 'admin') {
      return res.status(403).json({
        error: 'Access denied',
        code: 'ACCESS_DENIED'
      });
    }
    
    try {
      const profile = await profileStore.getProfile(userId);
      
      if (!profile) {
        return res.json({ facts: {} });
      }
      
      const facts = profile.facts || {};
      
      // Format facts for display
      const formattedFacts = Object.entries(facts).map(([key, fact]) => ({
        key,
        value: fact.value,
        confirmed: fact.confirmed || false,
        timestamp: fact.timestamp,
        confidence: fact.confidence
      }));
      
      res.json({
        facts: formattedFacts,
        total: formattedFacts.length
      });
    } catch (error) {
      console.error('Error getting facts:', error);
      res.status(500).json({
        error: 'Failed to retrieve facts',
        code: 'FACTS_ERROR'
      });
    }
  })
);

/**
 * Get All User Profiles (Admin Only)
 * GET /api/profile
 */
router.get('/',
  requireAuth({ admin: true }),
  asyncHandler(async (req, res) => {
    try {
      const profiles = await profileStore.listProfiles();
      
      // Format profiles for admin view
      const formattedProfiles = Object.entries(profiles).map(([userId, profile]) => ({
        userId,
        displayName: profile.displayName || 'Unknown',
        factsCount: Object.keys(profile.facts || {}).length,
        trustLevel: profile.trustLevel || 5,
        lastActivity: profile.updated_at || profile.created_at,
        created_at: profile.created_at
      }));
      
      res.json({
        profiles: formattedProfiles,
        total: formattedProfiles.length
      });
    } catch (error) {
      console.error('Error listing profiles:', error);
      res.status(500).json({
        error: 'Failed to list profiles',
        code: 'PROFILES_LIST_ERROR'
      });
    }
  })
);

/**
 * Delete User Profile (Admin Only)
 * DELETE /api/profile/:userId
 */
router.delete('/:userId',
  requireAuth({ admin: true }),
  asyncHandler(async (req, res) => {
    const { userId } = req.params;
    
    try {
      const deleted = await profileStore.deleteProfile(userId);
      
      if (!deleted) {
        return res.status(404).json({
          error: 'Profile not found',
          code: 'PROFILE_NOT_FOUND'
        });
      }
      
      // Record telemetry
      telemetryStore.recordEvent('profile_deleted', {
        userId,
        deletedBy: req.account.userId,
        method: 'admin_deletion'
      });
      
      res.json({
        success: true,
        userId,
        message: 'Profile deleted successfully'
      });
    } catch (error) {
      console.error('Error deleting profile:', error);
      res.status(500).json({
        error: 'Failed to delete profile',
        code: 'PROFILE_DELETE_ERROR'
      });
    }
  })
);

module.exports = router;