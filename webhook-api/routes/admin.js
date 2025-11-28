const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { validatePagination, rateLimit } = require('../middleware/validation');
const { asyncHandler } = require('../middleware/errorHandler');
const databaseService = require('../services/database');
const llmService = require('../services/llm');
const embeddingService = require('../services/embedding');
const websocketService = require('../services/websocket');
const fs = require('fs');
const path = require('path');

const router = express.Router();

// Apply rate limiting to admin endpoints
router.use(rateLimit({ windowMs: 60000, maxRequests: 100 })); // 100 requests per minute

/**
 * Admin Dashboard Data
 * GET /api/admin/dashboard
 */
router.get('/dashboard',
  requireAuth({ admin: true }),
  validatePagination({ maxLimit: 100, defaultLimit: 50 }),
  asyncHandler(async (req, res) => {
    const { limit } = req.pagination;
    
    try {
      // Get recent activity from database
      const recentActivity = await databaseService.getRecentActivity(limit);
      
      // Get news processor state
      const NewsProcessor = require('../news-processor');
      const newsProcessor = new NewsProcessor(databaseService.client, {});
      
      // Filter and format news stories
      const newsStories = recentActivity
        .filter(p => p.payload.type === 'news')
        .sort((a, b) => new Date(b.payload.timestamp) - new Date(a.payload.timestamp))
        .map(point => ({
          id: point.id,
          title: point.payload.title,
          url: point.payload.url,
          mood: point.payload.mood,
          topics: point.payload.topics,
          reaction: point.payload.reaction,
          timestamp: point.payload.timestamp
        }))
        .slice(0, 10);
      
      const dashboard = {
        mood: {
          score: newsProcessor.moodState.score,
          description: newsProcessor.getMoodDescription(),
          topics: newsProcessor.moodState.topics.slice(0, 10)
        },
        newsStories,
        recentActivity: recentActivity.map(point => ({
          type: point.payload.type || 'conversation',
          timestamp: point.payload.timestamp,
          content: point.payload.type === 'news' ? 
            point.payload.title : 
            `${point.payload.userMessage?.substring(0, 50) || 'Chat'}...`,
          mood: point.payload.mood || null
        })),
        stats: {
          totalConversations: recentActivity.filter(p => p.payload.type === 'conversation').length,
          totalNews: recentActivity.filter(p => p.payload.type === 'news').length,
          lastUpdate: new Date().toISOString()
        },
        websocket: websocketService.getStats()
      };
      
      res.json(dashboard);
    } catch (error) {
      console.error('Error getting dashboard data:', error);
      res.status(500).json({
        error: 'Failed to retrieve dashboard data',
        code: 'DASHBOARD_ERROR'
      });
    }
  })
);

/**
 * System Health Check
 * GET /api/admin/health
 */
router.get('/health',
  requireAuth({ admin: true }),
  asyncHandler(async (req, res) => {
    try {
      const health = {
        timestamp: new Date().toISOString(),
        services: {
          database: await databaseService.getHealthStatus(),
          llm: await llmService.testConnection(),
          embedding: await embeddingService.testConnection(),
          websocket: {
            connected: true,
            stats: websocketService.getStats()
          }
        },
        system: {
          uptime: process.uptime(),
          memory: process.memoryUsage(),
          nodeVersion: process.version
        }
      };
      
      const allHealthy = Object.values(health.services).every(service => 
        service.connected !== false
      );
      
      res.status(allHealthy ? 200 : 503).json(health);
    } catch (error) {
      res.status(500).json({
        error: 'Health check failed',
        code: 'HEALTH_CHECK_ERROR',
        timestamp: new Date().toISOString()
      });
    }
  })
);

/**
 * Process News Manually
 * POST /api/admin/process-news
 */
router.post('/process-news',
  requireAuth({ admin: true }),
  asyncHandler(async (req, res) => {
    try {
      console.log('Manual news processing triggered');
      
      const NewsProcessor = require('../news-processor');
      const newsProcessor = new NewsProcessor(databaseService.client, {});
      
      // Inject dependencies
      newsProcessor.generateResponse = llmService.generateResponse.bind(llmService);
      newsProcessor.generateEmbedding = embeddingService.generateEmbedding.bind(embeddingService);
      
      await newsProcessor.processNewsFeeds();
      
      res.json({ 
        success: true, 
        mood: newsProcessor.moodState,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error processing news:', error);
      res.status(500).json({
        error: 'Failed to process news',
        code: 'NEWS_PROCESSING_ERROR'
      });
    }
  })
);

/**
 * Reset Mood State
 * POST /api/admin/reset-mood
 */
router.post('/reset-mood',
  requireAuth({ admin: true }),
  asyncHandler(async (req, res) => {
    try {
      const NewsProcessor = require('../news-processor');
      const newsProcessor = new NewsProcessor(databaseService.client, {});
      
      newsProcessor.moodState = { score: 0, topics: [] };
      newsProcessor.saveMoodState();
      
      res.json({ 
        success: true, 
        mood: newsProcessor.moodState 
      });
    } catch (error) {
      console.error('Error resetting mood:', error);
      res.status(500).json({
        error: 'Failed to reset mood',
        code: 'MOOD_RESET_ERROR'
      });
    }
  })
);

/**
 * Clear News Entries
 * POST /api/admin/clear-news
 */
router.post('/clear-news',
  requireAuth({ admin: true }),
  asyncHandler(async (req, res) => {
    try {
      const limit = parseInt(req.body.limit) || 1000;
      const deletedCount = await databaseService.clearAllNews();
      
      // Reset mood state
      const NewsProcessor = require('../news-processor');
      const newsProcessor = new NewsProcessor(databaseService.client, {});
      newsProcessor.moodState = { score: 0, topics: [] };
      newsProcessor.saveMoodState();
      
      res.json({ 
        success: true, 
        deleted: deletedCount 
      });
    } catch (error) {
      console.error('Error clearing news:', error);
      res.status(500).json({
        error: 'Failed to clear news',
        code: 'CLEAR_NEWS_ERROR'
      });
    }
  })
);

/**
 * Bulk Delete News by Filter
 * DELETE /api/admin/news/bulk
 */
router.delete('/news/bulk',
  requireAuth({ admin: true }),
  asyncHandler(async (req, res) => {
    const { filter } = req.body;
    
    if (!filter || typeof filter !== 'string') {
      return res.status(400).json({
        error: 'Filter string is required',
        code: 'INVALID_FILTER'
      });
    }
    
    try {
      const deletedCount = await databaseService.deleteNewsByFilter(filter);
      
      res.json({ 
        success: true, 
        deleted: deletedCount,
        filter 
      });
    } catch (error) {
      console.error('Error bulk deleting news entries:', error);
      res.status(500).json({
        error: 'Failed to bulk delete news entries',
        code: 'BULK_DELETE_ERROR'
      });
    }
  })
);

/**
 * Delete Specific News Entry
 * DELETE /api/admin/news/:id
 */
router.delete('/news/:id',
  requireAuth({ admin: true }),
  asyncHandler(async (req, res) => {
    const pointId = parseInt(req.params.id);
    
    if (isNaN(pointId)) {
      return res.status(400).json({
        error: 'Invalid news ID',
        code: 'INVALID_ID'
      });
    }
    
    try {
      await databaseService.deletePoints([pointId]);
      res.json({ 
        success: true, 
        deleted: pointId 
      });
    } catch (error) {
      console.error('Error deleting news entry:', error);
      res.status(500).json({
        error: 'Failed to delete news entry',
        code: 'DELETE_NEWS_ERROR'
      });
    }
  })
);

/**
 * Get Telemetry Data
 * GET /api/admin/telemetry
 */
router.get('/telemetry',
  requireAuth({ admin: true }),
  validatePagination({ maxLimit: 1000, defaultLimit: 100 }),
  asyncHandler(async (req, res) => {
    const { limit } = req.pagination;
    const { type } = req.query;
    
    try {
      const telemetryPath = path.join(__dirname, '..', 'telemetry.json');
      
      if (!fs.existsSync(telemetryPath)) {
        return res.json({ events: [], total: 0 });
      }
      
      const telemetryData = JSON.parse(fs.readFileSync(telemetryPath, 'utf8'));
      let events = telemetryData.events || [];
      
      // Filter by type if specified
      if (type) {
        events = events.filter(event => event.type === type);
      }
      
      // Sort by timestamp (newest first) and limit
      events = events
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        .slice(0, limit);
      
      res.json({
        events,
        total: events.length,
        filter: type || 'all'
      });
    } catch (error) {
      console.error('Error getting telemetry data:', error);
      res.status(500).json({
        error: 'Failed to retrieve telemetry data',
        code: 'TELEMETRY_ERROR'
      });
    }
  })
);

/**
 * WebSocket Management
 * GET /api/admin/websocket/stats
 */
router.get('/websocket/stats',
  requireAuth({ admin: true }),
  asyncHandler(async (req, res) => {
    const stats = websocketService.getStats();
    const connectedUsers = websocketService.getConnectedUsers();
    
    res.json({
      ...stats,
      connectedUsers,
      timestamp: new Date().toISOString()
    });
  })
);

/**
 * Disconnect User
 * POST /api/admin/websocket/disconnect
 */
router.post('/websocket/disconnect',
  requireAuth({ admin: true }),
  asyncHandler(async (req, res) => {
    const { userId } = req.body;
    
    if (!userId) {
      return res.status(400).json({
        error: 'User ID is required',
        code: 'MISSING_USER_ID'
      });
    }
    
    const disconnected = websocketService.disconnectUser(userId);
    
    res.json({
      success: disconnected,
      userId,
      message: disconnected ? 'User disconnected' : 'User not found or not connected'
    });
  })
);

/**
 * Broadcast Admin Message
 * POST /api/admin/broadcast
 */
router.post('/broadcast',
  requireAuth({ admin: true }),
  asyncHandler(async (req, res) => {
    const { message, type = 'admin_message', userId } = req.body;
    
    if (!message) {
      return res.status(400).json({
        error: 'Message is required',
        code: 'MISSING_MESSAGE'
      });
    }
    
    const data = {
      sender: 'Admin',
      type,
      message,
      timestamp: new Date().toISOString()
    };
    
    if (userId) {
      const sent = websocketService.sendToUser(userId, data);
      res.json({
        success: sent,
        target: userId,
        message: sent ? 'Message sent to user' : 'User not connected'
      });
    } else {
      websocketService.broadcast(data);
      res.json({
        success: true,
        target: 'all',
        message: 'Message broadcasted to all users'
      });
    }
  })
);

module.exports = router;