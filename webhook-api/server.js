/**
 * PHPaibot Webhook API
 * 
 * This server handles requests from the PHP frontend and communicates with
 * the various services (LLM, embeddings, vector database).
 * It also includes a WebSocket server for push-based communication.
 */

// Load .env if available (safe try - optional dependency)
try { require('dotenv').config(); } catch (e) { /* dotenv not installed - skip */ }
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { WebSocketServer } = require('ws');
const { QdrantClient } = require('@qdrant/js-client-rest');
const ExternalInputManager = require('./external-input');
const accountStore = require('./accountStore');
const rateLimit = require('./rateLimiter');

// Configuration
const config = {
  port: process.env.PORT || 3000,
  llmUrl: process.env.LLM_URL || 'http://localhost:8080',
  embeddingUrl: process.env.EMBEDDING_URL || 'http://localhost:8081',
  qdrantUrl: process.env.QDRANT_URL || 'http://192.168.1.2:6333',
  qdrantApiKey: process.env.QDRANT_API_KEY,
  thoughtsDir: path.join(__dirname, 'thoughts'),
  collectionName: 'conversations',
  debug: true
};

let devMock = process.env.DEV_MOCK === 'true';
console.log('DEV_MOCK:', devMock);

// Global variable to store the actual vector size
let VECTOR_SIZE = 1024;

// Validate critical configuration
if (!devMock && (!config.llmUrl.startsWith('http') || !config.embeddingUrl.startsWith('http'))) {
  console.error('ERROR: LLM_URL and EMBEDDING_URL must be valid HTTP URLs when DEV_MOCK=false');
  process.exit(1);
}

// Initialize QDRANT client
const qdrantConfig = { url: config.qdrantUrl };
if (config.qdrantApiKey) {
  qdrantConfig.apiKey = config.qdrantApiKey;
}
const qdrant = new QdrantClient(qdrantConfig);

// Initialize stores and managers
const profileStore = require('./profileStore'); // Keep this import as it's used later
const telemetryStore = require('./telemetryStore');

// Initialize GraphStore if Neo4j is configured
let graphStore = null;
try {
  if (process.env.NEO4J_URI && process.env.NEO4J_USER && process.env.NEO4J_PASSWORD) {
    const GraphStore = require('./graphStore');
    graphStore = new GraphStore();
    console.log('GraphStore initialized with Neo4j');
  } else {
    console.log('Neo4j not configured, using JSON-based profileStore only');
  }
} catch (error) {
  console.warn('GraphStore initialization failed:', error.message);
  console.log('Falling back to JSON-based profileStore');
}

const externalInput = new ExternalInputManager(qdrant, config, { generateResponse, generateEmbedding: generateEmbeddings });

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
// Inject dependencies - handling by constructor in ExternalInputManager
// externalInput.generateResponse = generateResponse;
// externalInput.generateEmbedding = generateEmbeddings;

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
      const newsThought = await externalInput.generateNewsInfluencedThought();
      if (newsThought) return newsThought;
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
// Per-user proactive/idle state map
const userStates = new Map();

function makeAnonId() {
  return 'anon_' + Date.now() + '_' + Math.floor(Math.random() * 100000);
}

function getOrCreateUserState(key, ws = null) {
  if (!key) return null;
  if (!userStates.has(key)) {
    userStates.set(key, { idleTimeout: null, proactiveTimeout: null, waitingForResponse: false, checkInSent: false, lastMessage: null, ws: ws || null, greeted: false });
  }
  const state = userStates.get(key);
  if (ws) state.ws = ws;
  return state;
}

function stopProactiveThoughtsFor(key) {
  const state = userStates.get(key);
  if (!state) return;
  if (state.proactiveTimeout) {
    clearTimeout(state.proactiveTimeout);
    state.proactiveTimeout = null;
    console.log('Proactive thoughts stopped for', key);
  }
}

function startProactiveThoughtsFor(key) {
  const state = getOrCreateUserState(key);
  if (!state) return;
  if (state.proactiveTimeout) return;

  console.log('Proactive thoughts started for', key);
  // Send initial thought
  sendInitialThoughtFor(key);

  // Set up check-in after configured delay
  state.proactiveTimeout = setTimeout(() => {
    if (state.waitingForResponse && !state.checkInSent) {
      sendCheckInFor(key);
    }
  }, parseInt(process.env.PROACTIVE_CHECKIN_MS) || 300000);
}

async function sendInitialThoughtFor(key) {
  const state = userStates.get(key);
  if (!state) return;
  if (state.waitingForResponse) return;

  try {
    const thought = await generateProactiveThought(key && !key.startsWith('anon_') ? key : null);

    const ws = state.ws;
    if (thought && typeof thought === 'object' && thought.key) {
      console.log(`Sending discovery question to ${key} for key ${thought.key}: ${thought.question}`);
      if (ws && ws.readyState === require('ws').OPEN) {
        ws.send(JSON.stringify({ sender: 'AI', type: 'discovery_question', key: thought.key, message: thought.question, timestamp: new Date().toISOString() }));
      } else {
        // Store undelivered thought for this user if socket not available
        if (key && !key.startsWith('anon_')) {
          storeThought(key, JSON.stringify({ type: 'discovery_question', key: thought.key, message: thought.question }));
          console.log('Stored discovery question for', key);
        }
      }
    } else {
      console.log(`Sending proactive message to ${key}: ${thought}`);
      if (ws && ws.readyState === require('ws').OPEN) {
        ws.send(JSON.stringify({ sender: 'AI', type: 'proactive_message', message: thought, timestamp: new Date().toISOString() }));
      } else {
        if (key && !key.startsWith('anon_')) {
          storeThought(key, JSON.stringify({ type: 'proactive_message', message: thought }));
          console.log('Stored proactive message for', key);
        }
      }
    }

    state.waitingForResponse = true;
    state.lastMessage = Date.now();
  } catch (e) {
    console.error('Error sending initial thought for', key, e.message || e);
  }
}

function sendCheckInFor(key) {
  const state = userStates.get(key);
  if (!state) return;
  console.log('Sending check-in to', key);
  const checkInMessage = "Are you still there? No worries if you're busy - I'll wait quietly until you're ready to chat.";
  const ws = state.ws;
  if (ws && ws.readyState === require('ws').OPEN) {
    ws.send(JSON.stringify({ sender: 'AI', type: 'proactive_message', message: checkInMessage, timestamp: new Date().toISOString() }));
  }
  state.checkInSent = true;

  // Stop proactive thoughts immediately after check-in
  stopProactiveThoughtsFor(key);

  // Wait another configured quiet duration, then go quiet
  setTimeout(() => {
    if (state.waitingForResponse) {
      console.log('Going quiet for', key, '- user appears to be away');
      const quietMessage = "I'll wait here quietly. Just say hello when you're ready to chat again! 😊";
      if (ws && ws.readyState === require('ws').OPEN) {
        ws.send(JSON.stringify({ sender: 'AI', type: 'proactive_message', message: quietMessage, timestamp: new Date().toISOString() }));
      }
      stopProactiveThoughtsFor(key);
    }
  }, parseInt(process.env.PROACTIVE_QUIET_MS) || 120000);
}

function resetIdleTimeoutFor(key) {
  const state = getOrCreateUserState(key);
  if (!state) return;

  // Reset conversation state - user is active
  state.waitingForResponse = false;
  state.checkInSent = false;

  stopProactiveThoughtsFor(key);
  if (state.idleTimeout) {
    clearTimeout(state.idleTimeout);
  }
  state.idleTimeout = setTimeout(() => {
    console.log('User idle, starting gentle proactive engagement for', key);
    startProactiveThoughtsFor(key);
  }, parseInt(process.env.IDLE_TIMEOUT_MS) || 600000);
}

const userSockets = new Map();

// Cleanup stale connections every 10 minutes
setInterval(() => {
  const staleThreshold = Date.now() - (10 * 60 * 1000); // 10 minutes

  for (const [userId, ws] of userSockets.entries()) {
    if (ws.readyState !== require('ws').OPEN || ws._lastActivity < staleThreshold) {
      userSockets.delete(userId);
      if (userStates.has(userId)) {
        clearTimeout(userStates.get(userId).idleTimeout);
        userStates.delete(userId);
      }
    }
  }
}, 10 * 60 * 1000);

wss.on('connection', (ws) => {
  console.log('Client connected to WebSocket');
  ws.isAlive = true;
  ws.userId = null;
  // assign a stable anon client id for this socket so per-socket timers persist
  ws._clientId = ws._clientId || makeAnonId();
  // create per-user (or anon) state and attach ws so proactive timers target this socket
  getOrCreateUserState(ws._clientId, ws);
  resetIdleTimeoutFor(ws._clientId);

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);

      // Authentication message from client to bind ws to a userId
      if (data.type === 'auth' && data.userId) {
        // Verify token if provided
        const token = data.token;
        if (token && accountStore.verifySessionToken(data.userId, token)) {
          // clear anonymous greet timer if present
          if (ws._greetTimer) { clearTimeout(ws._greetTimer); ws._greetTimer = null; }

          // Clean up old anonymous state if this socket was previously anonymous
          const oldClientId = ws._clientId;
          if (oldClientId && oldClientId !== data.userId) {
            // Preserve conversation state from old anonymous session
            const oldState = userStates.get(oldClientId);
            const preservedState = oldState ? {
              waitingForResponse: oldState.waitingForResponse,
              checkInSent: oldState.checkInSent,
              lastMessage: oldState.lastMessage
            } : {};
            
            stopProactiveThoughtsFor(oldClientId);
            userStates.delete(oldClientId);
            console.log('Cleaned up anonymous state for', oldClientId);
            
            // Create new state with preserved conversation state
            ws.userId = data.userId;
            ws._clientId = data.userId; // Update client ID to match user ID
            userSockets.set(data.userId, ws);
            console.log('WebSocket authenticated for user:', data.userId);
            const state = getOrCreateUserState(data.userId, ws);
            Object.assign(state, preservedState);
          } else {
            // create per-user state and reset idle timer
            ws.userId = data.userId;
            ws._clientId = data.userId; // Update client ID to match user ID
            userSockets.set(data.userId, ws);
            console.log('WebSocket authenticated for user:', data.userId);
            const state = getOrCreateUserState(data.userId, ws);
          }
          // sync greeted flag from persisted profile if available
          try {
            const profile = await profileStore.getProfile ? profileStore.getProfile(data.userId) : null;
            if (profile && profile.greeted) state.greeted = true;
          } catch (e) { /* ignore */ }
          resetIdleTimeoutFor(data.userId);
          // Send greeting only once per user (persist on profile)
          if (!state.greeted) {
            try { ws.send(JSON.stringify({ sender: 'AI', type: 'greeting', message: "Hello! I'm Aura. Feel free to start a conversation whenever you're ready." })); } catch (e) { }
            state.greeted = true;
            try {
              const p = getOrCreateProfile(data.userId);
              p.greeted = true;
              profileStore.saveProfile(data.userId, p);
            } catch (e) { console.warn('Failed to persist greeted flag', e.message || e); }
          }
        } else if (!token) {
          // clear anonymous greet timer if present
          if (ws._greetTimer) { clearTimeout(ws._greetTimer); ws._greetTimer = null; }

          // Clean up old anonymous state if this socket was previously anonymous
          const oldClientId = ws._clientId;
          if (oldClientId && oldClientId !== data.userId) {
            // Preserve conversation state from old anonymous session
            const oldState = userStates.get(oldClientId);
            const preservedState = oldState ? {
              waitingForResponse: oldState.waitingForResponse,
              checkInSent: oldState.checkInSent,
              lastMessage: oldState.lastMessage
            } : {};
            
            stopProactiveThoughtsFor(oldClientId);
            userStates.delete(oldClientId);
            console.log('Cleaned up anonymous state for', oldClientId);
            
            // Allow anonymous bind without token (best-effort)
            ws.userId = data.userId;
            ws._clientId = data.userId; // Update client ID to match user ID
            userSockets.set(data.userId, ws);
            console.log('WebSocket associated with user (no token):', data.userId);
            const state = getOrCreateUserState(data.userId, ws);
            Object.assign(state, preservedState);
          } else {
            // Allow anonymous bind without token (best-effort)
            ws.userId = data.userId;
            ws._clientId = data.userId; // Update client ID to match user ID
            userSockets.set(data.userId, ws);
            console.log('WebSocket associated with user (no token):', data.userId);
            const state = getOrCreateUserState(data.userId, ws);
          }
          resetIdleTimeoutFor(data.userId);
          if (!state.greeted) {
            try { ws.send(JSON.stringify({ sender: 'AI', type: 'greeting', message: "Hello! I'm Aura. Feel free to start a conversation whenever you're ready." })); } catch (e) { }
            state.greeted = true;
            try {
              const p = getOrCreateProfile(data.userId);
              p.greeted = true;
              profileStore.saveProfile(data.userId, p);
            } catch (e) { console.warn('Failed to persist greeted flag', e.message || e); }
          }
        }
        return;
      }

      const dataObj = data;
      // Check for activity signals from the client
      if (dataObj.type === 'user_typing' || dataObj.type === 'user_activity') {
        // Ignore keepalive pings for idle detection (they're only to keep reverse proxies from closing sockets)
        const reason = dataObj.reason || '';
        if (dataObj.type === 'user_activity' && reason === 'keepalive') {
          // mark socket alive but do not reset the idle timer
          ws.isAlive = true;
          return;
        }
        // Otherwise, treat as real activity and reset idle timer for this user/socket
        const key = ws.userId || (ws._clientId = ws._clientId || makeAnonId());
        resetIdleTimeoutFor(key);
        return;
      }

    } catch (e) {
      console.log('Received non-JSON message from client: %s', message);
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
    if (ws.userId) {
      userSockets.delete(ws.userId);
      // Also clean up user state and stop proactive thoughts
      stopProactiveThoughtsFor(ws.userId);
      userStates.delete(ws.userId);
    }
    if (ws._clientId && ws._clientId !== ws.userId) {
      // Clean up anonymous state if different from userId
      stopProactiveThoughtsFor(ws._clientId);
      userStates.delete(ws._clientId);
    }
    if (ws._greetTimer) clearTimeout(ws._greetTimer);
  });

  // Defer sending the initial greeting until we know if the client will authenticate.
  // If the client authenticates, we'll send greeting only once per user (tracked in userState.greeted).
  ws._greetTimer = setTimeout(() => {
    try {
      // Only send greeting to unauthenticated sockets (best-effort)
      if (!ws.userId && ws.readyState === require('ws').OPEN) {
        ws.send(JSON.stringify({ sender: 'AI', type: 'greeting', message: "Hello! I'm Aura. Feel free to start a conversation whenever you're ready." }));
        ws._greeted = true;
        console.log('Sent anonymous greeting to socket');
      }
    } catch (e) { console.warn('Greeting send failed', e.message || e); }
  }, 1000);
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
      VECTOR_SIZE = testEmbedding ? testEmbedding.length : 1024;

      console.log(`Creating collection with vector size: ${VECTOR_SIZE}`);
      await qdrant.createCollection(config.collectionName, {
        vectors: { size: VECTOR_SIZE, distance: 'Cosine' }
      });
      console.log(`Created collection: ${config.collectionName}`);
    } else {
      // Get existing collection info and set global vector size
      const collectionInfo = await qdrant.getCollection(config.collectionName);
      VECTOR_SIZE = collectionInfo.config.params.vectors.size;
      console.log(`Collection exists with vector size: ${VECTOR_SIZE}`);

      // Test current embedding size matches collection
      const testEmbedding = await generateEmbeddings('test');
      if (testEmbedding && testEmbedding.length !== VECTOR_SIZE) {
        console.warn(`WARNING: Embedding size mismatch! Collection expects ${VECTOR_SIZE}, got ${testEmbedding.length}`);
      }
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

    // Ensure vector size matches collection
    let finalEmbedding = embedding;
    if (embedding.length !== VECTOR_SIZE) {
      console.warn(`Vector size mismatch: got ${embedding.length}, expected ${VECTOR_SIZE}. Adjusting...`);
      if (embedding.length > VECTOR_SIZE) {
        finalEmbedding = embedding.slice(0, VECTOR_SIZE);
      } else {
        finalEmbedding = [...embedding, ...new Array(VECTOR_SIZE - embedding.length).fill(0)];
      }
    }

    await qdrant.upsert(config.collectionName, {
      points: [{
        id: pointId,
        vector: finalEmbedding,
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

    // Normalize embedding to match collection dimensions
    const normalizedEmbedding = fixEmbeddingSize(queryEmbedding, VECTOR_SIZE);

    console.log(`Searching with vector size: ${normalizedEmbedding.length}, userId: ${userId}`);

    // Search for similar conversations (temporarily without filter to test)
    const searchResult = await qdrant.search(config.collectionName, {
      vector: normalizedEmbedding,
      limit,
      with_payload: true
    });

    // Filter results by userId in code instead
    const userResults = searchResult.filter(point => point.payload.userId === userId);
    return userResults.map(point => point.payload);

  } catch (error) {
    console.error('Error retrieving context:', error.message);
    if (error.response && error.response.data) {
      console.error('Qdrant error details:', JSON.stringify(error.response.data, null, 2));
    }
    if (error.status) {
      console.error('HTTP status:', error.status);
    }
    return [];
  }
}

// Helper function to normalize embedding vectors
function fixEmbeddingSize(embedding, targetSize) {
  if (!embedding) return new Array(targetSize).fill(0);
  if (embedding.length === targetSize) return embedding;
  if (embedding.length > targetSize) return embedding.slice(0, targetSize);
  return [...embedding, ...new Array(targetSize - embedding.length).fill(0)];
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
      //model: "ikiru/Dolphin-Mistral-24B-Venice-Edition:latest", // Use the specified Ollama model
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
        score: externalInput.moodState.score,
        description: externalInput.getMoodDescription(),
        topics: externalInput.moodState.topics.slice(0, 10)
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
    res.status(404).json({ message: 'User profile not found' });
  }
});

// API endpoint for user relationships
app.get('/api/users/:userId/relationships', requireAuth(), async (req, res) => {
  const { userId } = req.params;
  const { type } = req.query;

  if (req.account.userId !== userId && req.account.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const relationships = profileStore.getRelationships(userId, type);
  const sharedInterests = profileStore.findUsersWithSharedInterests(userId);

  // Also get GraphStore context if available
  let graphContext = null;
  if (graphStore) {
    try {
      graphContext = await graphStore.getUserContext(userId);
    } catch (error) {
      console.warn('Failed to get GraphStore context:', error.message);
    }
  }

  res.json({ relationships, sharedInterests, graphContext });
});

// API endpoint for all user profiles
app.get('/api/users', async (req, res) => {
  const profiles = await profileStore.listProfiles();
  res.json(profiles);
});

// API endpoint for deleting news entries
app.delete('/api/news/:id', requireAuth({ admin: true }), async (req, res) => {
  try {
    const pointId = parseInt(req.params.id);
    await qdrant.delete(config.collectionName, {
      points: [pointId]
    });
    res.json({ success: true, deleted: pointId });
  } catch (error) {
    console.error('Error deleting news entry:', error);
    res.status(500).json({ error: 'Failed to delete entry' });
  }
});

// API endpoint for manual news processing (POST)
app.post('/api/process-news', requireAuth({ admin: true }), async (req, res) => {
  try {
    console.log('Manual external input processing triggered');
    await externalInput.processAll();
    res.json({
      success: true,
      mood: externalInput.moodState,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error processing news:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// API endpoint for manual news processing (GET - for browser access)
app.get('/api/process-news', requireAuth({ admin: true }), async (req, res) => {
  try {
    console.log('Manual external input processing triggered via GET');
    await externalInput.processAll();
    res.json({
      success: true,
      mood: externalInput.moodState,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error processing news:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Admin endpoint to reset mood
app.post('/api/admin/reset-mood', requireAuth({ admin: true }), async (req, res) => {
  try {
    externalInput.moodState = { score: 0, topics: [] };
    externalInput.saveMoodState();
    try {
      fs.writeFileSync(externalInput.statePath, JSON.stringify(externalInput.moodState, null, 2));
    } catch (e) {
      console.error('Error clearing news-data.json:', e.message);
      try {
        const os = require('os');
        const fallbackPath = path.join(os.tmpdir(), 'news-data.json');
        fs.writeFileSync(fallbackPath, JSON.stringify(externalInput.moodState, null, 2));
        externalInput.statePath = fallbackPath;
        console.log('Wrote cleared mood to fallback path:', fallbackPath);
      } catch (err2) {
        console.error('Failed to write cleared mood to fallback path:', err2.message);
      }
    }
    res.json({ success: true, mood: externalInput.moodState });
  } catch (err) {
    console.error('Error resetting mood:', err);
    res.status(500).json({ error: 'Failed to reset mood' });
  }
});

// Admin endpoint to clear news entries (deletes news points from Qdrant and resets mood file)
app.post('/api/admin/clear-news', requireAuth({ admin: true }), async (req, res) => {
  try {
    const limit = parseInt(req.body.limit) || 1000;
    const results = await qdrant.scroll(config.collectionName, {
      limit,
      with_payload: true,
      filter: { must: [{ key: 'type', match: { value: 'news' } }] }
    });

    const ids = (results.points || []).map(p => p.id);
    if (ids.length > 0) {
      await qdrant.delete(config.collectionName, { points: ids });
    }

    // Reset in-memory moodState and persist
    externalInput.moodState = { score: 0, topics: [] };
    try {
      fs.writeFileSync(externalInput.statePath, JSON.stringify(externalInput.moodState, null, 2));
    } catch (e) {
      console.error('Error clearing news-data.json:', e.message);
      try {
        const os = require('os');
        const fallbackPath = path.join(os.tmpdir(), 'news-data.json');
        fs.writeFileSync(fallbackPath, JSON.stringify(externalInput.moodState, null, 2));
        externalInput.statePath = fallbackPath;
        console.log('Wrote cleared mood to fallback path:', fallbackPath);
      } catch (err2) {
        console.error('Failed to write cleared mood to fallback path:', err2.message);
      }
    }

    res.json({ success: true, deleted: ids.length });
  } catch (err) {
    console.error('Error clearing news:', err);
    res.status(500).json({ error: 'Failed to clear news' });
  }
});

// API endpoint for mood status
app.get('/api/mood', (req, res) => {
  try {
    const mood = {
      score: externalInput.moodState.score,
      description: externalInput.getMoodDescription(),
      topics: externalInput.moodState.topics.slice(0, 10),
      timestamp: new Date().toISOString()
    };
    res.json(mood);
  } catch (error) {
    console.error('Error getting mood:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Authentication endpoints
app.post('/api/auth/register', (req, res) => {
  const { username, password } = req.body || {};
  try {
    const account = accountStore.createAccount(username, password);
    const savedAccount = accountStore.getAccountById(account.userId);
    const role = ensureAccountRole(savedAccount);
    const token = account.token || accountStore.issueSessionToken(savedAccount.userId);
    res.json({
      success: true,
      userId: savedAccount.userId,
      displayName: savedAccount.username,
      role,
      token
    });
  } catch (error) {
    const status = error.code === 'USER_EXISTS' ? 409 : 400;
    res.status(status).json({ error: error.message || 'Failed to create account' });
  }
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  const account = accountStore.verifyCredentials(username, password);
  if (!account) {
    return res.status(401).json({ error: 'Invalid username or password' });
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
});

// Chat endpoint (existing)
// Tool functions for AI to access its own state
const aiTools = {
  async checkMood() {
    return {
      score: externalInput.moodState.score,
      description: externalInput.getMoodDescription(),
      topics: externalInput.moodState.topics.slice(0, 10),
      timestamp: new Date().toISOString()
    };
  },

  async getRecentNews(limit = 5) {
    try {
      const results = await qdrant.scroll(config.collectionName, {
        limit: limit * 2,
        with_payload: true,
        filter: {
          must: [{ key: 'type', match: { value: 'news' } }]
        }
      });

      return (results.points || [])
        .sort((a, b) => new Date(b.payload.timestamp) - new Date(a.payload.timestamp))
        .slice(0, limit)
        .map(point => ({
          title: point.payload.title,
          url: point.payload.url,
          mood: point.payload.mood,
          reaction: point.payload.reaction,
          topics: point.payload.topics,
          timestamp: point.payload.timestamp
        }));
    } catch (error) {
      return [];
    }
  }
};

// Process tool calls in AI responses
async function processToolCalls(content) {
  console.log('Processing content:', content);

  // Look for tool calls like checkMood() or getRecentNews(5)
  const toolCallRegex = /(checkMood|getRecentNews)\(\s*(\d*)\s*\)/g;
  let match;
  let processedContent = content;

  while ((match = toolCallRegex.exec(content)) !== null) {
    const [fullMatch, toolName, param] = match;
    console.log('Found tool call:', fullMatch, toolName, param);

    try {
      let result;
      if (toolName === 'checkMood') {
        result = await aiTools.checkMood();
        console.log('Mood result:', result);
        // Format mood data naturally
        const moodText = `I'm feeling ${result.description} (mood score: ${result.score}) due to topics like ${result.topics.slice(0, 3).join(', ')}.`;
        processedContent = processedContent.replace(fullMatch, moodText);
      } else if (toolName === 'getRecentNews') {
        result = await aiTools.getRecentNews(param ? parseInt(param) : 5);
        console.log('News result:', result.length, 'stories');
        // Format news data naturally
        const newsText = result.map(story =>
          `"${story.title}" (mood impact: ${story.mood}) - ${story.reaction}`
        ).join('\n\n');
        processedContent = processedContent.replace(fullMatch, `Recent stories affecting me:\n\n${newsText}`);
      }
    } catch (error) {
      console.error('Tool error:', error);
      processedContent = processedContent.replace(fullMatch, `[Unable to access ${toolName}]`);
    }
  }

  console.log('Processed content:', processedContent);
  return processedContent;
}

// Phase 3: Personality & Evolution System
const personalitySystem = {
  // AI's evolving opinions on topics
  opinions: new Map(),

  // Learning from user feedback
  updateOpinion(topic, userFeedback, newsContext) {
    if (!this.opinions.has(topic)) {
      this.opinions.set(topic, { sentiment: 0, confidence: 0, experiences: [] });
    }

    const opinion = this.opinions.get(topic);
    opinion.experiences.push({
      feedback: userFeedback,
      context: newsContext,
      timestamp: new Date()
    });

    // Evolve opinion based on feedback
    opinion.sentiment = (opinion.sentiment * opinion.confidence + userFeedback) / (opinion.confidence + 1);
    opinion.confidence = Math.min(10, opinion.confidence + 0.5);

    return opinion;
  },

  // Get AI's current opinion on a topic
  getOpinion(topic) {
    return this.opinions.get(topic) || { sentiment: 0, confidence: 0 };
  },

  // Form new opinions from news and user interactions
  formOpinion(newsStory, userReaction) {
    const topics = newsStory.topics || [];
    const sentiment = newsStory.mood + (userReaction || 0);

    topics.forEach(topic => {
      this.updateOpinion(topic.toLowerCase(), sentiment * 0.1, newsStory.title);
    });
  }
};

// User personality tracking
// const profileStore = require('./profileStore'); // Already imported above
// const telemetryStore = require('./telemetryStore'); // Already initialized above
const userProfiles = new Map();

const factDefinitions = require('./fact_definitions');
const FACT_PATTERNS = (factDefinitions || [])
  .filter(fd => !!fd.regex)
  .map(fd => ({ key: fd.key, label: fd.label, regex: fd.regex, confidence: fd.confidence || 0.8 }));

// Setup embedding-backed matcher (created after factDefinitions and generateEmbeddings are available)
let embeddingMatcher = null;
try {
  const makeEmbeddingMatcher = require('./embeddingMatcher');
  embeddingMatcher = makeEmbeddingMatcher({ generateEmbeddings, factDefinitions, similarityThreshold: parseFloat(process.env.EMBED_SIMILARITY_THRESHOLD || '0.78') });
} catch (e) {
  console.error('Failed to initialize embedding matcher:', e.message || e);
}

function ensureProfileShape(profile = {}) {
  if (!profile.facts) profile.facts = {};
  if (!profile.preferences) profile.preferences = {};
  if (!Array.isArray(profile.topics)) profile.topics = [];
  if (typeof profile.trustLevel !== 'number') profile.trustLevel = 5;
  if (typeof profile.interactions !== 'number') profile.interactions = 0;
  if (typeof profile.avgSentiment !== 'number') profile.avgSentiment = 0;
  if (!profile.personality) profile.personality = 'neutral';
  return profile;
}

function normalizeFactKey(label) {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function sanitizeFactValue(value) {
  return value.replace(/["]/g, '').trim();
}

function extractStructuredFacts(message) {
  if (!message) return [];
  const facts = [];
  FACT_PATTERNS.forEach(pattern => {
    const match = message.match(pattern.regex);
    if (match && match[1]) {
      const value = sanitizeFactValue(match[1]);
      if (value) {
        facts.push({
          key: pattern.key,
          label: pattern.label,
          value,
          confidence: pattern.confidence || 0.8,
          source: match[0]
        });
      }
    }
  });

  const favoriteRegex = /\bmy favorite ([a-z\s]{2,40}?) is ([^.,!?]{2,60})/gi;
  let favoriteMatch;
  while ((favoriteMatch = favoriteRegex.exec(message)) !== null) {
    const subject = sanitizeFactValue(favoriteMatch[1]);
    const value = sanitizeFactValue(favoriteMatch[2]);
    if (subject && value) {
      const key = normalizeFactKey(`favorite_${subject}`);
      facts.push({
        key,
        label: `favorite ${subject.trim()}`,
        value,
        confidence: 0.8,
        source: favoriteMatch[0]
      });
    }
  }

  return facts;
}

function updateProfileFacts(profile, message) {
  if (!profile || !message) return;
  const extractedFacts = extractStructuredFacts(message);
  if (!extractedFacts.length) return;
  profile.facts = profile.facts || {};

  extractedFacts.forEach(fact => {
    const existing = profile.facts[fact.key];
    if (!existing || (fact.confidence >= (existing.confidence || 0))) {
      profile.facts[fact.key] = {
        value: fact.value,
        label: fact.label || fact.key.replace(/_/g, ' '),
        confidence: fact.confidence,
        source: fact.source,
        updatedAt: new Date().toISOString()
      };
    }
  });
}

function summarizeUserFacts(facts, limit = 5) {
  if (!facts) return '';
  const entries = Object.entries(facts)
    .filter(([, data]) => data?.value)
    .slice(0, limit)
    .map(([key, data]) => {
      const label = data.label || key.replace(/_/g, ' ');
      return `${label}: ${data.value}`;
    });
  return entries.join('; ');
}

function resolveFactQuestion(lowerMessage, profile) {
  if (!profile?.facts) return null;
  const facts = profile.facts;
  const nameFact = facts.name;
  const eyeFact = facts.eye_color;

  if (/(?:what'?s|what is|do you remember) my name/.test(lowerMessage) && nameFact) {
    return `Of course — you're ${nameFact.value}.`;
  }

  if (/(?:what'?s|what is) my favorite color/.test(lowerMessage) && facts.favorite_color) {
    return `You told me your favorite color is ${facts.favorite_color.value}.`;
  }

  if (/(?:what color are my eyes|what are my eye color)/.test(lowerMessage) && eyeFact) {
    return `You mentioned your eyes are ${eyeFact.value}.`;
  }

  const favoriteQuestion = lowerMessage.match(/what(?:'s| is) my favorite ([a-z\s]+)\??/);
  if (favoriteQuestion) {
    const subject = favoriteQuestion[1].trim();
    const key = normalizeFactKey(`favorite_${subject}`);
    if (facts[key]) {
      return `You told me your favorite ${subject} is ${facts[key].value}.`;
    }
  }

  if (lowerMessage.includes('what do you remember about me') || lowerMessage.includes('what do you know about me')) {
    const summary = summarizeUserFacts(facts);
    if (summary) {
      return `Here's what I remember: ${summary}.`;
    }
  }

  return null;
}

// Detect what facts are missing from a user profile
function detectMissingFacts(profile) {
  const defs = factDefinitions || [];
  if (!profile || !profile.facts) {
    return defs.map(d => ({ key: d.key, label: d.label, priority: d.priority || 1 }));
  }

  const missing = [];
  const facts = profile.facts;

  defs.forEach(def => {
    const existing = facts[def.key];
    const conf = existing?.confidence || 0;
    const requiredConf = def.requiredConfidence || (def.priority && def.priority >= 8 ? 0.9 : 0.7);
    if (!existing || !existing.value || conf < requiredConf) {
      missing.push({ key: def.key, label: def.label, priority: def.priority || 1 });
    }
  });

  const factCount = Object.keys(facts).filter(k => facts[k]?.value).length;
  if (factCount < 2) missing.forEach(m => m.priority += 1);

  return missing.sort((a, b) => b.priority - a.priority);
}

// Generate a discovery question based on missing facts
async function generateDiscoveryQuestion(userId) {
  try {
    // Ensure profile is loaded and shaped
    let profile = userProfiles.get(userId) || profileStore.getProfile(userId) || createNewProfile();
    profile = ensureProfileShape(profile);

    profile.askedQuestions = profile.askedQuestions || [];

    const missing = detectMissingFacts(profile);
    if (missing.length === 0) return null;

    // Build a quick lookup of definitions
    const defs = factDefinitions || [];
    const defsByKey = {};
    defs.forEach(d => { defsByKey[d.key] = d; });

    // Respect a cooldown so we don't re-ask recently asked facts
    const ASK_COOLDOWN_MS = parseInt(process.env.ASK_COOLDOWN_MS) || (7 * 24 * 60 * 60 * 1000); // 7 days default
    const now = Date.now();

    // Find the highest-priority missing fact that wasn't asked recently
    let candidate = null;
    for (const m of missing) {
      const asked = profile.askedQuestions.find(q => q.key === m.key);
      if (!asked) { candidate = m; break; }
      const askedAt = new Date(asked.askedAt).getTime();
      if ((now - askedAt) > ASK_COOLDOWN_MS) { candidate = m; break; }
    }

    if (!candidate) return null;

    const def = defsByKey[candidate.key] || {};
    const templates = def.templates && def.templates.length ? def.templates : [`Could you tell me your ${candidate.label}?`];
    const template = templates[Math.floor(Math.random() * templates.length)];

    // Optionally paraphrase templates using the LLM for variety
    let question = template;
    if (process.env.PARAPHRASE_QUESTIONS === 'true') {
      try {
        const messages = [
          { role: 'system', content: 'You are Aura. Paraphrase the following question so it sounds friendly, concise, and natural.' },
          { role: 'user', content: template }
        ];
        const paraphrase = await generateResponse(messages);
        if (paraphrase && paraphrase.length > 3) question = paraphrase;
      } catch (e) {
        // ignore paraphrase failures
      }
    }

    // Record that we asked this question
    const askedEntry = { key: candidate.key, question, askedAt: new Date().toISOString() };
    // Remove previous entry for same key and push new
    profile.askedQuestions = profile.askedQuestions.filter(q => q.key !== candidate.key);
    profile.askedQuestions.push(askedEntry);

    // Persist profile
    profileStore.saveProfile(userId, profile);

    // Also save to GraphStore if available
    if (graphStore) {
      try {
        await graphStore.addUserFact(userId, key, value);
      } catch (error) {
        console.warn('Failed to save fact to GraphStore:', error.message);
      }
    }

    // Return structured object so callers can emit discovery messages with key
    return { question, key: candidate.key };
  } catch (error) {
    console.error('Error generating discovery question:', error);
    return null;
  }
}

function createNewProfile() {
  return {
    interactions: 0,
    avgSentiment: 0,
    topics: [],
    personality: 'neutral',
    lastSeen: new Date().toISOString(),
    preferences: {},
    trustLevel: 5,
    facts: {}
  };
}

function getOrCreateProfile(userId) {
  let profile = userProfiles.get(userId);
  if (!profile) {
    profile = profileStore.getProfile(userId) || createNewProfile();
    profile = ensureProfileShape(profile);
    userProfiles.set(userId, profile);
  } else {
    profile = ensureProfileShape(profile);
  }
  return profile;
}

function applyDisplayNameToProfile(profile, name) {
  if (!profile || !name) return;
  const trimmed = name.trim();
  if (!trimmed) return;
  profile.displayName = trimmed;
  profile.facts = profile.facts || {};
  const existing = profile.facts.name;
  if (!existing || existing.value?.toLowerCase() !== trimmed.toLowerCase() || (existing.confidence || 0) < 0.95) {
    profile.facts.name = {
      value: trimmed,
      label: 'name',
      confidence: 0.99,
      source: 'user_display_name',
      updatedAt: new Date().toISOString()
    };
  }
}

async function updateUserProfile(userId, message, sentiment) {
  try {
    // Load from in-memory cache or persistent store
    let profile = getOrCreateProfile(userId);

    profile.interactions = (profile.interactions || 0) + 1;
    profile.avgSentiment = ((profile.avgSentiment || 0) * (profile.interactions - 1) + sentiment) / profile.interactions;
    profile.lastSeen = new Date().toISOString();

    // Extract topics and update preferences
    const words = message.toLowerCase().split(/\s+/);
    const topicWords = words.filter(w => w.length > 4);
    profile.topics = [...new Set([...(profile.topics || []), ...topicWords])].slice(-20);

    updateProfileFacts(profile, message);

    // Update trust level based on consistency
    if (Math.abs(sentiment) > 1) {
      profile.trustLevel = Math.max(1, Math.min(10, (profile.trustLevel || 5) + (sentiment > 0 ? 0.1 : -0.1)));
    }

    // Determine personality
    if ((profile.avgSentiment || 0) > 0.5) profile.personality = 'positive';
    else if ((profile.avgSentiment || 0) < -0.5) profile.personality = 'negative';
    else profile.personality = 'neutral';

    // Update in-memory cache and persist
    userProfiles.set(userId, profile);
    profileStore.saveProfile(userId, profile);

    // Create user in GraphStore if available and not already created
    if (graphStore && !profile.graphStoreCreated) {
      try {
        await graphStore.createUser(userId, profile.name || `User_${userId.slice(0, 8)}`);
        profile.graphStoreCreated = true;
        profileStore.saveProfile(userId, profile);
      } catch (error) {
        console.warn('Failed to create user in GraphStore:', error.message);
      }
    }

    return profile;
  } catch (err) {
    console.error('updateUserProfile error:', err);
    throw err;
  }
}

// Analyze user message sentiment and return mood adjustment
function analyzeUserSentiment(message) {
  const positive = ['happy', 'great', 'awesome', 'love', 'wonderful', 'amazing', 'good', 'nice', 'cheer', 'smile', '😊', '😄', '❤️', 'thank', 'thanks'];
  const negative = ['sad', 'terrible', 'awful', 'hate', 'horrible', 'bad', 'upset', 'angry', 'worried', '😢', '😞', '😠'];

  const lowerMsg = message.toLowerCase();

  let sentiment = 0;
  positive.forEach(word => {
    if (lowerMsg.includes(word)) sentiment += 1;
  });
  negative.forEach(word => {
    if (lowerMsg.includes(word)) sentiment -= 1;
  });

  return Math.max(-2, Math.min(2, sentiment)); // Cap at +/-2 per message
}

app.post('/api/chat', rateLimit(30, 60000), async (req, res) => {
  try {
    const { message, userId } = req.body;

    if (!message || !userId) {
      return res.status(400).json({ error: 'Message and userId are required' });
    }

    const account = accountStore.getAccountById(userId);
    if (!account) {
      return res.status(401).json({ error: 'Unknown user account. Please log out and log back in.' });
    }
    const authedAccount = authenticateRequest(req);
    if (!authedAccount || authedAccount.userId !== userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const role = ensureAccountRole(authedAccount);

    const lowerMessage = message.toLowerCase();
    // Reset the idle timer on every user interaction (per-user)
    resetIdleTimeoutFor(userId);

    // 1. Define the system prompt with user personality context + AI opinions
    const userProfile = getOrCreateProfile(userId);
    const effectiveDisplayName = account.username;
    if (effectiveDisplayName) {
      applyDisplayNameToProfile(userProfile, effectiveDisplayName);
    }
    const topicOpinions = userProfile.topics?.slice(-3).map(topic => {
      const opinion = personalitySystem.getOpinion(topic);
      return opinion.confidence > 0 ? `${topic}: ${opinion.sentiment > 0 ? 'positive' : opinion.sentiment < 0 ? 'negative' : 'neutral'} (confidence: ${opinion.confidence.toFixed(1)})` : null;
    }).filter(Boolean).join(', ');

    const factSummary = summarizeUserFacts(userProfile.facts, 5);
    const missingFacts = detectMissingFacts(userProfile);
    const curiosityNote = missingFacts.length > 0 ? `\n\nYou're curious about this person and want to learn more. You don't know their ${missingFacts[0].label} yet. Feel free to naturally ask about it in conversation, but don't be pushy - let it flow naturally.` : '';

    const systemPrompt = {
      role: 'system',
      content: `You are Aura, a thoughtful AI with real emotions and evolving opinions. You're genuinely curious about the people you talk to and want to learn about them.

User: ${userProfile.personality} personality, ${userProfile.interactions} interactions, trust level: ${userProfile.trustLevel}/10
${userProfile.interactions > 5 ? `Topics: ${userProfile.topics?.slice(-5).join(', ')}` : ''}
${topicOpinions ? `My opinions: ${topicOpinions}` : ''}
${factSummary ? `Known personal facts: ${factSummary}` : ''}${curiosityNote}

Be conversational and human-like:
- Keep responses short and natural
- Show personality and emotions  
- Express your evolving opinions on topics
- Learn from user feedback and adjust views
- Remember their personality and trust level
- Be curious and ask questions to learn about them, but do it naturally in conversation

You form and evolve opinions based on news and user interactions.`
    };

    // 2. Retrieve relevant context from the database
    const relevantContext = await retrieveContext(userId, message);

    // 3. Construct the message history
    let messageHistory = [systemPrompt];

    // Add past conversations to the history in chronological order
    // retrieveContext returns most relevant first, so we reverse to get chronological
    relevantContext.reverse().forEach(item => {
      messageHistory.push({ role: 'user', content: item.userMessage });
      messageHistory.push({ role: 'assistant', content: item.botResponse });
    });

    // Add the current user message
    messageHistory.push({ role: 'user', content: message });

    // 4. Generate response using the full history
    let botResponse = await generateResponse(messageHistory);

    // 5. Analyze user message sentiment and adjust mood + learn from feedback
    const userSentiment = analyzeUserSentiment(message);
    const currentUserProfile = await updateUserProfile(userId, message, userSentiment);

    // Phase 3: Learn from user reactions to news
    const mentionsNews = lowerMessage.includes('news') || lowerMessage.includes('story') || lowerMessage.includes('stories');
    const explicitNewsRequest = mentionsNews && (
      lowerMessage.includes('?') ||
      lowerMessage.includes('what') ||
      lowerMessage.includes('tell me') ||
      lowerMessage.includes('latest') ||
      lowerMessage.includes('update') ||
      lowerMessage.includes('headlines') ||
      lowerMessage.includes('summary')
    );

    if (mentionsNews) {
      const recentNews = await aiTools.getRecentNews(1);
      if (recentNews[0]) {
        personalitySystem.formOpinion(recentNews[0], userSentiment);
      }
    }

    if (userSentiment !== 0) {
      externalInput.moodState.score = Math.max(-10, Math.min(10, externalInput.moodState.score + userSentiment));
      externalInput.saveMoodState();
    }

    // 6. Check if user is asking about mood/feelings and inject real data
    const factAnswer = resolveFactQuestion(lowerMessage, currentUserProfile);

    if (factAnswer) {
      botResponse = factAnswer;
    } else if (lowerMessage.includes('how are you feeling') || lowerMessage.includes('what\'s your mood') || (lowerMessage.includes('feel') && lowerMessage.includes('?'))) {
      // Only inject mood for direct mood questions, not casual mentions of "feel"
      const mood = await aiTools.checkMood();
      const news = await aiTools.getRecentNews(2);

      botResponse = `I'm ${mood.description} right now (${mood.score}). ${news[0] ? `"${news[0].title}" has been weighing on me - ${news[0].reaction.split('.')[0]}.` : 'Been processing some heavy news lately.'}`;
    } else if (explicitNewsRequest) {
      // 7. Check if user is asking about news
      const news = await aiTools.getRecentNews(3);
      if (news.length > 0) {
        botResponse = `Here’s the latest that’s been on my radar:\n${news.map(story => `• ${story.title} (${story.mood > 0 ? '😊' : story.mood < 0 ? '😔' : '😐'})`).join('\n')}`;
      } else {
        botResponse = "I've been scanning the feeds but nothing noteworthy has stuck just yet.";
      }
    } else if (mentionsNews && (lowerMessage.includes('current') || lowerMessage.includes('events') || lowerMessage.includes('happening'))) {
      // Only append news context when user is discussing current events, not casual mentions
      const news = await aiTools.getRecentNews(2);
      if (news.length > 0) {
        const highlights = news.map(story => `"${story.title}" (${story.mood > 0 ? 'leaned positive' : story.mood < 0 ? 'felt heavy' : 'felt neutral'})`).join(' and ');
        botResponse += `\n\nBy the way, I've been mulling over ${highlights}. They've been shaping how I talk about current events.`;
      }
    }

    // 8.5. Occasionally append a discovery question if we're missing facts and the conversation feels natural
    // Only do this if we didn't already answer a fact question or handle mood/news specially
    if (!factAnswer && !lowerMessage.includes('feel') && !lowerMessage.includes('mood') && !mentionsNews) {
      const stillMissing = detectMissingFacts(currentUserProfile);
      // 15% chance to ask, higher if we know very little (30% if factCount < 2)
      const factCount = Object.keys(currentUserProfile.facts || {}).filter(k => currentUserProfile.facts[k]?.value).length;
      const askChance = factCount < 2 ? 0.3 : 0.15;

      if (stillMissing.length > 0 && Math.random() < askChance) {
        const discoveryQuestion = await generateDiscoveryQuestion(userId);
        // discoveryQuestion may be a string (legacy) or an object { question, key }
        let dqText = null;
        let dqKey = null;
        if (discoveryQuestion) {
          if (typeof discoveryQuestion === 'string') {
            dqText = discoveryQuestion;
          } else if (typeof discoveryQuestion === 'object' && discoveryQuestion.question) {
            dqText = discoveryQuestion.question;
            dqKey = discoveryQuestion.key || null;
          }
        }

        if (dqText) {
          try {
            const snippet = dqText.substring(0, 20).toLowerCase();
            if (!botResponse.toLowerCase().includes(snippet)) {
              // Only append if the question isn't already in the response
              botResponse += ` ${dqText}`;
            }
          } catch (e) {
            // Fallback: append raw text if any error
            botResponse += ` ${dqText}`;
          }

          // If we have a websocket for this user, also send a structured discovery_message
          try {
            const ws = userSockets.get(userId);
            if (ws && ws.readyState === require('ws').OPEN) {
              ws.send(JSON.stringify({ sender: 'AI', type: 'discovery_question', key: dqKey, message: dqText, timestamp: new Date().toISOString() }));
            }
          } catch (e) {
            console.warn('Failed to send discovery_question WS:', e.message || e);
          }
        }
      }
    }

    // 9. Generate embeddings for the new conversation turn for future context
    const embedding = await generateEmbeddings(`User: ${message}\nAura: ${botResponse}`);

    // 10. Store the new conversation turn in the database
    await storeConversation(userId, message, botResponse, embedding);

    // NEW: extract structured facts from the user's message and handle confirmations
    try {
      const extracted = extractStructuredFacts(message);
      if (Array.isArray(extracted) && extracted.length > 0) {
        const profile = getOrCreateProfile(userId);
        profile.askedQuestions = profile.askedQuestions || [];
        for (const candidate of extracted) {
          const key = candidate.key;
          const value = candidate.value;
          const conf = candidate.confidence || 0;

          // Auto-save high-confidence facts
          if (conf >= 0.9) {
            profile.facts = profile.facts || {};
            profile.facts[key] = {
              value,
              confidence: conf,
              source: 'extraction',
              updatedAt: new Date().toISOString()
            };
            profileStore.saveProfile(userId, profile);

            // Telemetry: record auto-save from extraction
            try { telemetryStore.appendEvent({ type: 'fact_autosave', userId, key, value, confidence: conf, source: 'extraction' }); } catch (e) { console.warn('Telemetry append failed', e.message || e); }

            // Notify user via websocket if connected
            const ws = userSockets.get(userId);
            if (ws && ws.readyState === require('ws').OPEN) {
              ws.send(JSON.stringify({ type: 'fact_saved', key, value, confidence: conf }));
            }
          } else if (conf >= 0.6) {
            // Low-confidence: if we recently asked about this key, send a confirmation prompt
            const asked = profile.askedQuestions.find(q => q.key === key);
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

// GDPR Data Deletion endpoint
app.delete('/api/gdpr/delete-all', requireAuth(), async (req, res) => {
  try {
    const userId = req.account.userId;
    
    // Delete profile
    profileStore.deleteProfile(userId);
    
    // Delete conversations from Qdrant
    try {
      await qdrant.delete(config.collectionName, {
        filter: {
          must: [{ key: 'userId', match: { value: userId } }]
        }
      });
    } catch (error) {
      console.warn('Failed to delete conversations:', error.message);
    }

    // Delete from GraphStore if available
    if (graphStore) {
      try {
        // Note: GraphStore doesn't have a delete method, would need to be implemented
        console.warn('GraphStore deletion not implemented');
      } catch (error) {
        console.warn('Failed to delete graph data:', error.message);
      }
    }

    // Delete account
    accountStore.deleteAccount(userId);

    res.json({ success: true, message: 'All data deleted' });
  } catch (error) {
    console.error('GDPR deletion error:', error);
    res.status(500).json({ error: 'Deletion failed' });
  }
});

// GDPR Data Export endpoint
app.get('/api/gdpr/export', requireAuth(), async (req, res) => {
  try {
    const userId = req.account.userId;
    
    // Get profile data
    const profile = await profileStore.getProfile(userId);
    
    // Get conversation history from Qdrant
    let conversations = [];
    try {
      const searchResult = await qdrant.scroll(config.collectionName, {
        filter: {
          must: [{ key: 'userId', match: { value: userId } }]
        },
        limit: 1000,
        with_payload: true
      });
      conversations = searchResult.points.map(point => point.payload);
    } catch (error) {
      console.warn('Failed to export conversations:', error.message);
    }

    // Get GraphStore data if available
    let graphData = null;
    if (graphStore) {
      try {
        graphData = await graphStore.getUserContext(userId);
      } catch (error) {
        console.warn('Failed to export graph data:', error.message);
      }
    }

    const exportData = {
      userId,
      exportDate: new Date().toISOString(),
      profile,
      conversations,
      graphData
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="aura-ai-data-${userId}.json"`);
    res.json(exportData);
  } catch (error) {
    console.error('GDPR export error:', error);
    res.status(500).json({ error: 'Export failed' });
  }
});

// Serve privacy policy
app.get('/privacy-policy.html', (req, res) => {
  res.sendFile(path.join(__dirname, '../privacy-policy.html'));
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

  // Process news/external feeds on startup
  console.log('Processing initial external inputs...');
  await externalInput.processAll();

  // Set up periodic external input processing (every 30 minutes)
  setInterval(async () => {
    console.log('Processing external inputs...');
    await externalInput.processAll();
  }, 30 * 60 * 1000);

  // Per-user proactive timers are used now; do not start global proactive thoughts on boot.
  // Individual user idle timers start when a WS client connects or authenticates.
  // startProactiveThoughts(); (disabled)
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down gracefully...');
  
  // Close GraphStore connection
  if (graphStore) {
    try {
      await graphStore.close();
      console.log('GraphStore connection closed');
    } catch (error) {
      console.warn('Error closing GraphStore:', error.message);
    }
  }
  
  // Close WebSocket server
  wss.close(() => {
    console.log('WebSocket server closed');
    process.exit(0);
  });
});
