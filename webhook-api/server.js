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
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { WebSocketServer } = require('ws');
const { QdrantClient } = require('@qdrant/js-client-rest');
const NewsProcessor = require('./news-processor');
const accountStore = require('./accountStore');

// Configuration
const config = {
  port: process.env.PORT || 3000,
  llmUrl: process.env.LLM_URL || 'http://localhost:8080',
  embeddingUrl: process.env.EMBEDDING_URL || 'http://localhost:8081',
  qdrantUrl: process.env.QDRANT_URL || 'http://192.168.1.2:6333',
  thoughtsDir: path.join(__dirname, 'thoughts'),
  collectionName: 'conversations',
  debug: true
};

let devMock = process.env.DEV_MOCK === 'true';
console.log('DEV_MOCK:', devMock);

// Initialize QDRANT client
const qdrant = new QdrantClient({ url: config.qdrantUrl });

// Initialize News Processor
const newsProcessor = new NewsProcessor(qdrant, config);

const DEFAULT_ADMIN_USER_IDS = [
  '2351d788-4fb9-4dcf-88a1-56f63e06f649'
];
const ADMIN_USER_IDS = new Set([
  ...DEFAULT_ADMIN_USER_IDS,
  ...(process.env.ADMIN_USER_IDS ? process.env.ADMIN_USER_IDS.split(',').map(id => id.trim()) : [])
].filter(Boolean));

ADMIN_USER_IDS.forEach(id => accountStore.assignRoleByUserId(id, 'admin'));

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

function authenticateRequest(req) {
  const userId = req.headers['x-user-id'];
  const token = req.headers['x-auth-token'];
  if (!userId || !token) return null;
  const account = accountStore.getAccountById(userId);
  if (!account) return null;
  if (!accountStore.verifySessionToken(userId, token)) return null;
  ensureAccountRole(account);
  return account;
}

function requireAuth(options = {}) {
  const { admin = false } = options;
  return (req, res, next) => {
    const account = authenticateRequest(req);
    if (!account) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    if (admin && account.role !== 'admin') {
      return res.status(403).json({ error: 'Admin privileges required' });
    }
    req.account = account;
    next();
  };
}
// Inject dependencies
newsProcessor.generateResponse = generateResponse;
newsProcessor.generateEmbedding = generateEmbeddings;

// Ensure thoughts directory exists
if (!fs.existsSync(config.thoughtsDir)) {
  fs.mkdirSync(config.thoughtsDir, { recursive: true });
}

// Initialize Express app and HTTP server
const app = express();
const server = http.createServer(app);

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Log requests in debug mode
if (config.debug) {
  app.use((req, res, next) => {
    console.log(`${req.method} ${req.path}`);
    next();
  });
}

// --- WebSocket Server Setup ---
const wss = new WebSocketServer({ server });

let proactiveInterval = null;
let idleTimeout = null;

// --- Dynamic AI proactive thoughts ---

// Generate a proactive thought using LLM
async function generateProactiveThought(userId = null) {
  try {
    // 30% chance to generate news-influenced thought
    if (Math.random() < 0.3) {
      const newsThought = await newsProcessor.generateNewsInfluencedThought();
      if (newsThought) {
        return newsThought;
      }
    }

    // 25% chance to ask a discovery question if we have a userId and don't know much about them
    if (userId && Math.random() < 0.25) {
      const discoveryQuestion = await generateDiscoveryQuestion(userId);
      if (discoveryQuestion) {
        return discoveryQuestion;
      }
    }

    let contextPrompt = "Generate a brief, interesting observation or gentle conversation starter. Make it feel like a natural thought you're sharing, not a direct question demanding a response. Examples: 'I was just thinking about...' or 'Something interesting I noticed...'";
    
    // If we have a userId, get recent context
    if (userId) {
      const recentContext = await retrieveContext(userId, "recent conversation", 2);
      if (recentContext.length > 0) {
        const topics = recentContext.map(c => c.userMessage + " " + c.botResponse).join(" ");
        contextPrompt = `Based on our recent conversation about: "${topics.substring(0, 200)}...", share a gentle follow-up thought or observation. Make it conversational, like you're continuing to think about our discussion, not asking a direct question.`;
      }
    }

    const messages = [
      { role: 'system', content: 'You are Aura. Generate natural, thoughtful observations that feel like genuine thoughts being shared, not interview questions.' },
      { role: 'user', content: contextPrompt }
    ];

    const response = await generateResponse(messages);
    return response || "I've been thinking about how fascinating conversations can be...";
    
  } catch (error) {
    console.error('Error generating proactive thought:', error);
    // Fallback thoughts - more natural
    const fallbacks = [
      "I've been pondering how creativity works in different minds...",
      "Something interesting about human curiosity just occurred to me...",
      "I was just reflecting on how much we can learn from simple conversations..."
    ];
    return fallbacks[Math.floor(Math.random() * fallbacks.length)];
  }
}

function stopProactiveThoughts() {
  if (proactiveInterval) {
    clearTimeout(proactiveInterval);
    proactiveInterval = null;
    console.log('Proactive thoughts stopped.');
  }
}

// Conversation state tracking
let conversationState = {
  lastMessage: null,
  waitingForResponse: false,
  checkInSent: false
};

function startProactiveThoughts() {
  if (proactiveInterval) return;

  console.log('Proactive thoughts started.');
  
  // Send initial thought
  sendInitialThought();
  
  // Set up check-in after 5 minutes of no response
  proactiveInterval = setTimeout(() => {
    if (conversationState.waitingForResponse && !conversationState.checkInSent) {
      sendCheckIn();
    }
  }, parseInt(process.env.PROACTIVE_CHECKIN_MS) || 300000); // 5 minutes
}

async function sendInitialThought(userId = null) {
  if (conversationState.waitingForResponse) return;
  
  const thought = await generateProactiveThought(userId);

  // If discovery question object returned, broadcast as discovery_question with key
  if (thought && typeof thought === 'object' && thought.key) {
    console.log(`Broadcasting discovery question for key ${thought.key}: ${thought.question}`);
    wss.clients.forEach(client => {
      if (client.readyState === client.OPEN) {
        client.send(JSON.stringify({
          sender: 'AI',
          type: 'discovery_question',
          key: thought.key,
          message: thought.question,
          timestamp: new Date().toISOString()
        }));
      }
    });
  } else {
    console.log(`Broadcasting initial thought: ${thought}`);
    // Broadcast to all connected clients
    wss.clients.forEach(client => {
      if (client.readyState === client.OPEN) {
        client.send(JSON.stringify({
          sender: 'AI',
          type: 'proactive_message',
          message: thought,
          timestamp: new Date().toISOString()
        }));
      }
    });
  }
  
  conversationState.waitingForResponse = true;
  conversationState.lastMessage = Date.now();
}

function sendCheckIn() {
  console.log('Sending check-in message');
  
  const checkInMessage = "Are you still there? No worries if you're busy - I'll wait quietly until you're ready to chat.";
  
  wss.clients.forEach(client => {
    if (client.readyState === client.OPEN) {
      client.send(JSON.stringify({
        sender: 'AI',
        type: 'proactive_message',
        message: checkInMessage,
        timestamp: new Date().toISOString()
      }));
    }
  });
  
  conversationState.checkInSent = true;
  
  // Wait another 2 minutes, then go quiet
  setTimeout(() => {
    if (conversationState.waitingForResponse) {
      console.log('Going quiet - user appears to be away');
      const quietMessage = "I'll wait here quietly. Just say hello when you're ready to chat again! 😊";
      
      wss.clients.forEach(client => {
        if (client.readyState === client.OPEN) {
          client.send(JSON.stringify({
            sender: 'AI',
            type: 'proactive_message',
            message: quietMessage,
            timestamp: new Date().toISOString()
          }));
        }
      });
      
      stopProactiveThoughts();
    }
  }, parseInt(process.env.PROACTIVE_QUIET_MS) || 120000); // 2 minutes
}

function resetIdleTimeout() {
  // Reset conversation state - user is active
  conversationState.waitingForResponse = false;
  conversationState.checkInSent = false;
  
  stopProactiveThoughts();
  if (idleTimeout) {
    clearTimeout(idleTimeout);
  }
  idleTimeout = setTimeout(() => {
    console.log('User idle for 10 minutes, starting gentle proactive engagement.');
    startProactiveThoughts();
  }, parseInt(process.env.IDLE_TIMEOUT_MS) || 600000); // 10 minutes
}


// Map of userId => ws to target messages to a specific user
const userSockets = new Map();

wss.on('connection', (ws) => {
  console.log('Client connected to WebSocket');
  ws.isAlive = true;
  ws.userId = null;

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      // Authentication message from client to bind ws to a userId
      if (data.type === 'auth' && data.userId) {
        // Verify token if provided
        const token = data.token;
        if (token && accountStore.verifySessionToken(data.userId, token)) {
          ws.userId = data.userId;
          userSockets.set(data.userId, ws);
          console.log('WebSocket authenticated for user:', data.userId);
        } else if (!token) {
          // Allow anonymous bind without token (best-effort)
          ws.userId = data.userId;
          userSockets.set(data.userId, ws);
          console.log('WebSocket associated with user (no token):', data.userId);
        }
        return;
      }

      const dataObj = data;
      // Check for activity signals from the client
      if (dataObj.type === 'user_typing' || dataObj.type === 'user_activity') {
        resetIdleTimeout();
        return;
      }

    } catch (e) {
      console.log('Received non-JSON message from client: %s', message);
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
    if (ws.userId) userSockets.delete(ws.userId);
  });

  ws.send(JSON.stringify({ sender: 'AI', message: 'Hello! I\'m Aura. Feel free to start a conversation whenever you\'re ready.' }));
});

function broadcast(data) {
  wss.clients.forEach((client) => {
    if (client.readyState === require('ws').OPEN) {
      client.send(JSON.stringify(data));
    }
  });
}

// --- QDRANT Database Functions ---

// Initialize collection if it doesn't exist
async function initializeCollection() {
  try {
    const collections = await qdrant.getCollections();
    const exists = collections.collections.some(c => c.name === config.collectionName);
    
    if (!exists) {
      // First, let's test the embedding to get the actual dimension
      console.log('Testing embedding API to determine vector dimensions...');
      const testEmbedding = await generateEmbeddings('test');
      const vectorSize = testEmbedding ? testEmbedding.length : 1024; // fallback to 1024
      
      console.log(`Creating collection with vector size: ${vectorSize}`);
      await qdrant.createCollection(config.collectionName, {
        vectors: { size: vectorSize, distance: 'Cosine' }
      });
      console.log(`Created collection: ${config.collectionName}`);
    }
  } catch (error) {
    console.error('Error initializing collection:', error);
    // Create with default size if embedding test fails
    try {
      await qdrant.createCollection(config.collectionName, {
        vectors: { size: 1024, distance: 'Cosine' }
      });
      console.log(`Created collection with default size: ${config.collectionName}`);
    } catch (fallbackError) {
      console.error('Failed to create collection with fallback:', fallbackError);
    }
  }
}


// Generate embeddings for text
async function generateEmbeddings(text) {
  try {
    // Dev mock mode returns a stable dummy vector for local testing
    if (devMock) {
      const size = 1024;
      return new Array(size).fill(0.01);
    }

    const apiUrl = `${config.embeddingUrl.replace(/\/$/, '')}/v1/embeddings`;
    const requestBody = {
      model: "bge-m3:latest",
      input: text
    };

    const response = await axios.post(apiUrl, requestBody, {
      headers: { 'Content-Type': 'application/json' }
    });

    if (response.data.data && response.data.data.length > 0) {
      return response.data.data[0].embedding;
    } else {
      throw new Error("Invalid response structure from Embedding API");
    }
  } catch (error) {
    console.error('Error generating embeddings:', error.response ? error.response.data : error.message);
    throw error;
  }
}

// Store conversation in QDRANT
async function storeConversation(userId, userMessage, botResponse, embedding) {
  try {
    if (!embedding || !Array.isArray(embedding) || embedding.length === 0) {
      console.error('Invalid embedding provided to storeConversation');
      return null;
    }
    
    const timestamp = new Date().toISOString();
    const pointId = Date.now(); // Use timestamp as integer ID
    
    console.log(`Storing conversation with embedding size: ${embedding.length}`);
    
    await qdrant.upsert(config.collectionName, {
      points: [{
        id: pointId,
        vector: embedding,
        payload: {
          userId,
          userMessage,
          botResponse,
          timestamp,
          type: 'conversation'
        }
      }]
    });
    
    console.log(`Stored conversation for user ${userId}`);
    return pointId;

  } catch (error) {
    console.error('Error storing conversation:', error.message);
    console.error('Full error:', error);
    throw error;
  }
}

// Retrieve relevant context from QDRANT
async function retrieveContext(userId, query, limit = 3) {
  try {
    // Generate embeddings for the query
    const queryEmbedding = await generateEmbeddings(query);
    
    // Search for similar conversations
    const searchResult = await qdrant.search(config.collectionName, {
      vector: queryEmbedding,
      filter: {
        must: [{ key: 'userId', match: { value: userId } }]
      },
      limit,
      with_payload: true
    });

    return searchResult.map(point => point.payload);

  } catch (error) {
    console.error('Error retrieving context:', error.message);
    return [];
  }
}

// Generate response from LLM
async function generateResponse(messages) {
  try {
    // Development mock mode: return a canned, friendly reply for local testing
    if (devMock) {
      let lastUser = null;
      if (Array.isArray(messages)) {
        for (let i = messages.length - 1; i >= 0; i--) {
          if (messages[i].role === 'user') { lastUser = messages[i].content; break; }
        }
      }
      const heard = lastUser ? lastUser.substring(0, 200) : 'Hello';
      return `Mock reply: I heard "${heard}" — this is a local dev response.`;
    }

    // The URL from environment now points to the base of the OpenAI-compatible API
    const apiUrl = `${config.llmUrl.replace(/\/$/, '')}/v1/chat/completions`;

    const requestBody = {
      model: "qwen2.5:7b-instruct-q4_K_M", // Use the specified Ollama model
      messages: messages, // Use the full message history
      temperature: 0.7,
      max_tokens: 500,
    };

    const response = await axios.post(apiUrl, requestBody, {
       headers: { 'Content-Type': 'application/json' }
    });

    if (response.data.choices && response.data.choices.length > 0) {
      return response.data.choices[0].message.content;
    } else {
      throw new Error("Invalid response structure from LLM API");
    }
  } catch (error) {
    console.error('Error generating response:', error.response ? error.response.data : error.message);
    throw error;
  }
}

// Store a thought for later retrieval
function storeThought(userId, thought) {
  const thoughtsFile = path.join(config.thoughtsDir, `${userId}.json`);
  
  let thoughts = [];
  if (fs.existsSync(thoughtsFile)) {
    thoughts = JSON.parse(fs.readFileSync(thoughtsFile, 'utf8'));
  }
  
  thoughts.push({
    id: Date.now().toString(),
    content: thought,
    timestamp: new Date().toISOString(),
    delivered: false
  });
  
  fs.writeFileSync(thoughtsFile, JSON.stringify(thoughts, null, 2));
}

// Get undelivered thoughts for a user
function getUndeliveredThoughts(userId) {
  const thoughtsFile = path.join(config.thoughtsDir, `${userId}.json`);
  
  if (!fs.existsSync(thoughtsFile)) {
    return [];
  }
  
  const thoughts = JSON.parse(fs.readFileSync(thoughtsFile, 'utf8'));
  return thoughts.filter(thought => !thought.delivered);
}

// Mark a thought as delivered
function markThoughtDelivered(userId, thoughtId) {
  const thoughtsFile = path.join(config.thoughtsDir, `${userId}.json`);
  
  if (!fs.existsSync(thoughtsFile)) {
    return;
  }
  
  const thoughts = JSON.parse(fs.readFileSync(thoughtsFile, 'utf8'));
  const updatedThoughts = thoughts.map(thought => {
    if (thought.id === thoughtId) {
      return { ...thought, delivered: true };
    }
    return thought;
  });
  
  fs.writeFileSync(thoughtsFile, JSON.stringify(updatedThoughts, null, 2));
}

// API Routes

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// New endpoint to trigger a thought from an external service like N8N
app.post('/api/trigger-thought', (req, res) => {
  const { message } = req.body;
  if (!message) {
    return res.status(400).json({ error: 'Message is required' });
  }

  console.log(`Triggering thought from API: ${message}`);
  broadcast({ sender: 'AI', message });

  res.status(200).json({ status: 'ok', message: 'Thought broadcasted' });
});


// API endpoint for recent thoughts/activity
app.get('/api/dashboard', requireAuth({ admin: true }), async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    
    // Get recent activity from QDRANT
    const recentActivity = await qdrant.scroll(config.collectionName, {
      limit,
      with_payload: true
    });

    // Filter and format news stories
    const newsStories = (recentActivity.points || [])
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
      recentActivity: (recentActivity.points || []).map(point => ({
        type: point.payload.type || 'conversation',
        timestamp: point.payload.timestamp,
        content: point.payload.type === 'news' ? 
          point.payload.title : 
          `${point.payload.userMessage?.substring(0, 50) || 'Chat'}...`,
        mood: point.payload.mood || null
      })),
      stats: {
        totalConversations: (recentActivity.points || []).filter(p => p.payload.type === 'conversation').length,
        totalNews: (recentActivity.points || []).filter(p => p.payload.type === 'news').length,
        lastUpdate: new Date().toISOString()
      }
    };

    res.json(dashboard);
  } catch (error) {
    console.error('Error getting dashboard data:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// API endpoint for bulk deleting news entries by filter
app.delete('/api/news/bulk', requireAuth({ admin: true }), async (req, res) => {
  try {
    const { filter } = req.body;
    
    // Get all points matching filter
    const results = await qdrant.scroll(config.collectionName, {
      limit: 1000,
      with_payload: true,
      filter: {
        must: [
          { key: 'type', match: { value: 'news' } }
        ]
      }
    });
    
    // Find points to delete based on title filter
    const pointsToDelete = results.points
      .filter(p => p.payload.title && p.payload.title.includes(filter))
      .map(p => p.id);
    
    if (pointsToDelete.length > 0) {
      await qdrant.delete(config.collectionName, {
        points: pointsToDelete
      });
    }
    
    res.json({ success: true, deleted: pointsToDelete.length, ids: pointsToDelete });
  } catch (error) {
    console.error('Error bulk deleting news entries:', error);
    res.status(500).json({ error: 'Failed to bulk delete entries' });
  }
});

// API endpoint for AI opinions
app.get('/api/opinions', (req, res) => {
  const opinions = {};
  personalitySystem.opinions.forEach((opinion, topic) => {
    opinions[topic] = {
      sentiment: opinion.sentiment,
      confidence: opinion.confidence,
      experiences: opinion.experiences.length
    };
  });
  res.json(opinions);
});

// API endpoint for AI opinion on specific topic
app.get('/api/opinions/:topic', (req, res) => {
  const opinion = personalitySystem.getOpinion(req.params.topic.toLowerCase());
  res.json(opinion);
});

// API endpoint for user feedback on AI opinion
app.post('/api/feedback', async (req, res) => {
  const { topic, feedback, userId } = req.body;
  const userProfile = (await profileStore.getProfile(userId)) || userProfiles.get(userId);
  const trustWeight = userProfile ? userProfile.trustLevel / 10 : 0.5;
  
  const opinion = personalitySystem.updateOpinion(topic.toLowerCase(), feedback * trustWeight, 'user feedback');
  res.json({ topic, updatedOpinion: opinion });
});

// API endpoint for user profiles
app.get('/api/users/:userId/profile', async (req, res) => {
  const profile = await profileStore.getProfile(req.params.userId);
  if (profile) {
    res.json(profile);
  } else {
    res.status(404).json({ meconst asked = profile.askedQuestions.find(q => q.key === key);
            if (asked) {
              // Telemetry: record suggestion event
              try { telemetryStore.appendEvent({ type: 'fact_suggested', userId, key, value, confidence: conf, source: 'extraction' }); } catch (e) { console.warn('Telemetry append failed', e.message || e); }

              const ws = userSockets.get(userId);
              if (ws && ws.readyState === require('ws').OPEN) {
                ws.send(JSON.stringify({ type: 'fact_confirmation', key, value, confidence: conf, message: `I think you said ${value} — is that right?` }));
              }
            }
          }
        }
      }
    } catch (e) {
      console.error('Fact extraction/confirmation error:', e);
    }

    // Embedding-backed fallback: try semantic matching if nothing was confidently extracted
    try {
      if (embeddingMatcher && typeof embeddingMatcher.match === 'function') {
        const semantic = await embeddingMatcher.match(message);
        if (semantic && semantic.key) {
          const key = semantic.key;
          const value = semantic.value;
          const sim = semantic.similarity || 0;
          const profile = getOrCreateProfile(userId);
          profile.askedQuestions = profile.askedQuestions || [];

          if (sim >= parseFloat(process.env.EMBED_AUTO_SAVE_SIM || '0.90')) {
            // strong semantic match -> auto-save
            profile.facts = profile.facts || {};
            profile.facts[key] = {
              value,
              confidence: 0.95,
              source: 'embedding_match',
              updatedAt: new Date().toISOString()
            };
            profileStore.saveProfile(userId, profile);

            // Telemetry: record auto-save from embedding matcher
            try { telemetryStore.appendEvent({ type: 'fact_autosave', userId, key, value, confidence: 0.95, source: 'embedding_match', similarity: sim }); } catch (e) { console.warn('Telemetry append failed', e.message || e); }

            const ws = userSockets.get(userId);
            if (ws && ws.readyState === require('ws').OPEN) {
              ws.send(JSON.stringify({ type: 'fact_saved', key, value, confidence: 0.95 }));
            }
          } else if (sim >= parseFloat(process.env.EMBED_CONFIRM_SIM || '0.78')) {
            // mid-confidence -> ask for inline confirmation
            // Telemetry: record suggestion from embedding matcher
            try { telemetryStore.appendEvent({ type: 'fact_suggested', userId, key, value, confidence: sim, source: 'embedding_match' }); } catch (e) { console.warn('Telemetry append failed', e.message || e); }

            const ws = userSockets.get(userId);
            if (ws && ws.readyState === require('ws').OPEN) {
              ws.send(JSON.stringify({ type: 'fact_confirmation', key, value, confidence: sim, message: `I think you meant ${value} — is that correct?` }));
            }
          }
        }
      }
    } catch (emErr) {
      console.error('Embedding match error:', emErr);
    }

    // Return response
    res.json({
      message: botResponse
    });
  } catch (error) {
    console.error('Error processing chat request:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Check for thoughts endpoint (legacy, can be replaced by WebSockets)
app.get('/api/thoughts/:userId', (req, res) => {
  try {
    const { userId } = req.params;
    
    const undeliveredThoughts = getUndeliveredThoughts(userId);
    
    if (undeliveredThoughts.length === 0) {
      return res.json({ thought: null });
    }
    
    const thought = undeliveredThoughts[0];
    markThoughtDelivered(userId, thought.id);
    
    res.json({ thought: thought.content });
  } catch (error) {
    console.error('Error checking thoughts:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Enhanced dashboard with Phase 3 data
app.get('/api/evolution', requireAuth({ admin: true }), async (req, res) => {
  const opinions = {};
  personalitySystem.opinions.forEach((opinion, topic) => {
    opinions[topic] = {
      sentiment: opinion.sentiment,
      confidence: opinion.confidence,
      experiences: opinion.experiences.length,
      recentExperiences: opinion.experiences.slice(-3)
    };
  });

  const allProfiles = await profileStore.listProfiles();
  const userStats = {};
  Object.entries(allProfiles).forEach(([userId, profile]) => {
    userStats[userId] = {
      personality: profile.personality,
      interactions: profile.interactions,
      trustLevel: profile.trustLevel,
      avgSentiment: profile.avgSentiment,
      topics: (profile.topics || []).slice(-5)
    };
  });

  res.json({
    aiPersonality: {
      totalOpinions: Object.keys(opinions).length,
      strongOpinions: Object.values(opinions).filter(o => o.confidence > 5).length,
      opinions
    },
    users: userStats,
    evolution: {
      totalInteractions: Array.from(userProfiles.values()).reduce((sum, p) => sum + p.interactions, 0),
      avgUserTrust: Array.from(userProfiles.values()).reduce((sum, p) => sum + p.trustLevel, 0) / userProfiles.size || 0
    }
  });
});

// Profile confirmation endpoint for discovery questions
app.post('/api/profile/confirm-fact', requireAuth(), (req, res) => {
  try {
    const { userId: bodyUserId, key, value, confirmed } = req.body || {};
    if (!bodyUserId || !key) return res.status(400).json({ error: 'userId and key are required' });

    // Only allow the owner or an admin to confirm facts
    if (!req.account) return res.status(401).json({ error: 'Authentication required' });
    if (req.account.userId !== bodyUserId && req.account.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const profile = getOrCreateProfile(bodyUserId);
    profile.askedQuestions = profile.askedQuestions || [];

    const asked = profile.askedQuestions.find(q => q.key === key);
    if (asked) {
      asked.confirmed = !!confirmed;
      asked.confirmedAt = new Date().toISOString();
      asked.confirmedValue = value || null;
    }

    profile.facts = profile.facts || {};
    if (confirmed) {
      profile.facts[key] = {
        value: value,
        confidence: 0.95,
        source: 'user_confirmation',
        updatedAt: new Date().toISOString()
      };

      // Telemetry: record that user confirmed a fact
      try { telemetryStore.appendEvent({ type: 'fact_confirmed', userId: bodyUserId, key, value, source: 'user_confirmation' }); } catch (e) { console.warn('Telemetry append failed', e.message || e); }
    } else {
      // Telemetry: record that user rejected a fact
      try { telemetryStore.appendEvent({ type: 'fact_rejected', userId: bodyUserId, key, value: value || null }); } catch (e) { console.warn('Telemetry append failed', e.message || e); }

      // If user rejects, reduce confidence if fact existed
      if (profile.facts[key]) {
        profile.facts[key].confidence = Math.min(profile.facts[key].confidence || 1, 0.3);
        profile.facts[key].updatedAt = new Date().toISOString();
        profile.facts[key].source = profile.facts[key].source || 'extraction';
      }
    }

    profileStore.saveProfile(bodyUserId, profile);
    res.json({ success: true, profile });
  } catch (err) {
    console.error('Error confirming fact:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Endpoint to remove a stored fact from a user's profile
app.post('/api/profile/remove-fact', requireAuth(), (req, res) => {
  try {
    const { userId: bodyUserId, key } = req.body || {};
    if (!bodyUserId || !key) return res.status(400).json({ error: 'userId and key are required' });

    if (!req.account) return res.status(401).json({ error: 'Authentication required' });
    if (req.account.userId !== bodyUserId && req.account.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const profile = getOrCreateProfile(bodyUserId);
    profile.facts = profile.facts || {};
    if (profile.facts[key]) {
      const old = profile.facts[key];
      delete profile.facts[key];
      profileStore.saveProfile(bodyUserId, profile);
      // Telemetry: record deletion
      try { telemetryStore.appendEvent({ type: 'fact_deleted', userId: bodyUserId, key, oldValue: old.value || null }); } catch (e) { console.warn('Telemetry append failed', e.message || e); }
      return res.json({ success: true, profile });
    }
    return res.status(404).json({ error: 'Fact not found' });
  } catch (err) {
    console.error('Error removing fact:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Serve dashboard UI from the main server at /admin
app.get('/admin', (req, res) => {
  const { userId, token } = req.query;
  if (!userId || !token) {
    return res.status(401).send('Authentication required');
  }
  if (!accountStore.verifySessionToken(userId, token)) {
    return res.status(401).send('Invalid session');
  }
  const account = accountStore.getAccountById(userId);
  if (!account) {
    return res.status(401).send('Unknown user');
  }
  ensureAccountRole(account);
  if (account.role !== 'admin') {
    return res.status(403).send('Admin access required');
  }
  res.sendFile(path.join(__dirname, '..', 'dashboard.html'));
});


// Admin endpoints to get/set dev-mock flag
app.get('/api/admin/dev-mock', requireAuth({ admin: true }), (req, res) => {
  res.json({ devMock });
});

app.post('/api/admin/dev-mock', requireAuth({ admin: true }), (req, res) => {
  try {
    const enabled = !!req.body.enabled;
    devMock = enabled;
    console.log('DEV_MOCK set to', devMock);
    res.json({ success: true, devMock });
  } catch (e) {
    console.error('Failed to set DEV_MOCK:', e.message);
    res.status(500).json({ error: 'Failed to set dev mock' });
  }
});

// Admin telemetry endpoint - admin only
app.get('/api/admin/telemetry', requireAuth({ admin: true }), (req, res) => {
  try {
    const limit = Math.min(10000, Math.max(1, parseInt(req.query.limit) || 200));
    const events = telemetryStore.listEvents(limit);
    res.json({ success: true, events });
  } catch (err) {
    console.error('Error fetching telemetry:', err);
    res.status(500).json({ error: 'Failed to fetch telemetry' });
  }
});

// Serve chat UI from the webhook API so UI and API share origin
app.get('/', (req, res) => {
  res.redirect('/chat');
});
app.get('/chat', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'index.html'));
});
app.use('/static', express.static(path.join(__dirname, '..')));

// Also expose static assets under /admin/static (if dashboard references local assets)
app.use('/admin/static', express.static(path.join(__dirname, '..')));

// Start the server
server.listen(config.port, async () => {
  console.log(`Webhook API server with WebSocket support running on port ${config.port}`);
  // Initialize QDRANT collection
  await initializeCollection();

  // Load profiles from persistent store into memory
  try {
    const allProfiles = await profileStore.listProfiles();
    Object.entries(allProfiles).forEach(([id, p]) => userProfiles.set(id, ensureProfileShape(p)));
    console.log(`Loaded ${Object.keys(allProfiles).length} profiles from profile store`);
  } catch (err) {
    console.error('Error loading profiles from profile store:', err);
  }
  
  // Preload example embeddings for semantic matching (if available)
  try {
    if (embeddingMatcher && typeof embeddingMatcher.preloadExampleEmbeddings === 'function') {
      console.log('Preloading example embeddings...');
      await embeddingMatcher.preloadExampleEmbeddings();
    }
  } catch (e) {
    console.error('Error preloading example embeddings:', e);
  }

  // Process news feeds on startup
  console.log('Processing initial news feeds...');
  await newsProcessor.processNewsFeeds();
  
  // Set up periodic news processing (every 30 minutes)
  setInterval(async () => {
    console.log('Processing news feeds...');
    await newsProcessor.processNewsFeeds();
  }, 30 * 60 * 1000);
  
  // Start proactive thoughts when the server boots up
  startProactiveThoughts();
});
