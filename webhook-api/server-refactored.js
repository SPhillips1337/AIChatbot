/**
 * AURA.ai Chatbot Server - Refactored Architecture
 * 
 * This is the refactored version of the original monolithic server.js
 * It uses a modular architecture with separated concerns and proper error handling.
 */

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const http = require('http');

// Configuration and middleware
const config = require('./config');
const { globalErrorHandler, notFoundHandler, asyncHandler } = require('./middleware/errorHandler');
const { requireAuth } = require('./middleware/auth');

// Services
const databaseService = require('./services/database');
const llmService = require('./services/llm');
const embeddingService = require('./services/embedding');
const websocketService = require('./services/websocket');

// Routes
const authRoutes = require('./routes/auth');
const chatRoutes = require('./routes/chat');
const adminRoutes = require('./routes/admin');
const profileRoutes = require('./routes/profile');

// Legacy dependencies (to be refactored)
const NewsProcessor = require('./news-processor');

/**
 * Application Setup
 */
class AuraServer {
  constructor() {
    this.app = express();
    this.server = http.createServer(this.app);
    this.newsProcessor = null;
    this.initialized = false;
  }

  /**
   * Initialize the server
   */
  async initialize() {
    if (this.initialized) return;

    try {
      console.log('Initializing AURA.ai Server...');

      // Setup middleware
      this.setupMiddleware();

      // Initialize services
      await this.initializeServices();

      // Setup routes
      this.setupRoutes();

      // Setup error handling
      this.setupErrorHandling();

      // Initialize WebSocket
      websocketService.initialize(this.server);

      // Setup news processing
      this.setupNewsProcessor();

      this.initialized = true;
      console.log('AURA.ai Server initialized successfully');

    } catch (error) {
      console.error('Failed to initialize server:', error);
      throw error;
    }
  }

  /**
   * Setup Express middleware
   */
  setupMiddleware() {
    // Basic middleware
    this.app.use(cors());
    this.app.use(bodyParser.json({ limit: '10mb' }));
    this.app.use(bodyParser.urlencoded({ extended: true }));

    // Request logging in debug mode
    if (config.isDebugMode()) {
      this.app.use((req, res, next) => {
        console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
        next();
      });
    }

    // Request ID middleware
    this.app.use((req, res, next) => {
      req.requestId = Date.now().toString(36) + Math.random().toString(36).substr(2);
      next();
    });
  }

  /**
   * Initialize all services
   */
  async initializeServices() {
    console.log('Initializing services...');

    // Initialize database service
    await databaseService.initialize();

    // Test other services
    const llmStatus = await llmService.testConnection();
    console.log('LLM Service:', llmStatus.message);

    const embeddingStatus = await embeddingService.testConnection();
    console.log('Embedding Service:', embeddingStatus.message);

    console.log('All services initialized');
  }

  /**
   * Setup API routes
   */
  setupRoutes() {
    // Health check endpoint
    this.app.get('/health', asyncHandler(async (req, res) => {
      const health = {
        status: 'ok',
        timestamp: new Date().toISOString(),
        version: process.env.npm_package_version || '1.0.0',
        uptime: process.uptime()
      };

      res.json(health);
    }));

    // API routes
    this.app.use('/api/auth', authRoutes);
    this.app.use('/api/chat', chatRoutes);
    this.app.use('/api/admin', adminRoutes);
    this.app.use('/api/profile', profileRoutes);

    // Legacy endpoints for backward compatibility
    this.setupLegacyEndpoints();

    // Serve static files (chat interface)
    this.app.use(express.static('../', { 
      index: 'index.html',
      dotfiles: 'deny'
    }));

    // Chat interface route
    this.app.get('/chat', (req, res) => {
      res.sendFile('index.html', { root: '../' });
    });

    // Dashboard route
    this.app.get('/dashboard', requireAuth({ admin: true }), (req, res) => {
      res.sendFile('dashboard.html', { root: '../' });
    });
  }

  /**
   * Setup legacy endpoints for backward compatibility
   */
  setupLegacyEndpoints() {
    // Legacy mood endpoint
    this.app.get('/api/mood', asyncHandler(async (req, res) => {
      try {
        const mood = {
          score: this.newsProcessor?.moodState?.score || 0,
          description: this.newsProcessor?.getMoodDescription() || 'neutral',
          topics: this.newsProcessor?.moodState?.topics?.slice(0, 10) || [],
          timestamp: new Date().toISOString()
        };
        res.json(mood);
      } catch (error) {
        console.error('Error getting mood:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    }));

    // Legacy opinions endpoints (placeholder)
    this.app.get('/api/opinions', (req, res) => {
      res.json({ message: 'Opinions system deprecated - use profile system instead' });
    });

    this.app.get('/api/opinions/:topic', (req, res) => {
      res.json({ message: 'Opinions system deprecated - use profile system instead' });
    });

    // Legacy feedback endpoint (placeholder)
    this.app.post('/api/feedback', (req, res) => {
      res.json({ message: 'Feedback system deprecated - use chat system instead' });
    });

    // Legacy users endpoint
    this.app.get('/api/users', requireAuth({ admin: true }), asyncHandler(async (req, res) => {
      const accountStore = require('./accountStore');
      const accounts = accountStore.listAccounts();
      res.json(accounts);
    }));

    this.app.get('/api/users/:userId/profile', asyncHandler(async (req, res) => {
      const profileStore = require('./profileStore');
      const profile = await profileStore.getProfile(req.params.userId);
      if (profile) {
        res.json(profile);
      } else {
        res.status(404).json({ message: 'User profile not found' });
      }
    }));
  }

  /**
   * Setup news processor
   */
  setupNewsProcessor() {
    try {
      this.newsProcessor = new NewsProcessor(databaseService.client, config.getAll());
      
      // Inject dependencies
      this.newsProcessor.generateResponse = llmService.generateResponse.bind(llmService);
      this.newsProcessor.generateEmbedding = embeddingService.generateEmbedding.bind(embeddingService);

      console.log('News processor initialized');
    } catch (error) {
      console.error('Failed to initialize news processor:', error);
    }
  }

  /**
   * Setup error handling
   */
  setupErrorHandling() {
    // 404 handler
    this.app.use(notFoundHandler);

    // Global error handler
    this.app.use(globalErrorHandler);

    // Graceful shutdown handlers
    this.setupGracefulShutdown();
  }

  /**
   * Setup graceful shutdown
   */
  setupGracefulShutdown() {
    const gracefulShutdown = (signal) => {
      console.log(`Received ${signal}. Starting graceful shutdown...`);
      
      this.server.close(() => {
        console.log('HTTP server closed');
        
        // Cleanup WebSocket service
        websocketService.cleanup();
        
        // Clear embedding cache
        embeddingService.clearCache();
        
        console.log('Graceful shutdown completed');
        process.exit(0);
      });

      // Force shutdown after 30 seconds
      setTimeout(() => {
        console.error('Could not close connections in time, forcefully shutting down');
        process.exit(1);
      }, 30000);
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  }

  /**
   * Start the server
   */
  async start() {
    if (!this.initialized) {
      await this.initialize();
    }

    const port = config.get('port');
    
    this.server.listen(port, () => {
      console.log(`🚀 AURA.ai Server running on port ${port}`);
      console.log(`📱 Chat interface: http://localhost:${port}/chat`);
      console.log(`📊 Dashboard: http://localhost:${port}/dashboard`);
      console.log(`🔧 Environment: ${config.get('nodeEnv')}`);
      console.log(`🤖 Mock mode: ${config.get('devMock') ? 'enabled' : 'disabled'}`);
    });

    return this.server;
  }

  /**
   * Get server instance
   */
  getServer() {
    return this.server;
  }

  /**
   * Get Express app
   */
  getApp() {
    return this.app;
  }
}

// Create and export server instance
const server = new AuraServer();

// Start server if this file is run directly
if (require.main === module) {
  server.start().catch(error => {
    console.error('Failed to start server:', error);
    process.exit(1);
  });
}

module.exports = server;