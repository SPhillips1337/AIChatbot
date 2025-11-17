/**
 * PHPaibot Webhook API
 * 
 * This server handles requests from the PHP frontend and communicates with
 * the various services (LLM, embeddings, vector database).
 * It also includes a WebSocket server for push-based communication.
 */

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

// Configuration
const config = {
  port: process.env.PORT || 3000,
  llmUrl: process.env.LLM_URL || 'http://localhost:8080',
  embeddingUrl: process.env.EMBEDDING_URL || 'http://localhost:8081',
  qdrantUrl: process.env.QDRANT_URL || 'http://192.168.5.227:6333',
  thoughtsDir: path.join(__dirname, 'thoughts'),
  collectionName: 'conversations',
  debug: true
};

// Initialize QDRANT client
const qdrant = new QdrantClient({ url: config.qdrantUrl });

// Initialize News Processor
const newsProcessor = new NewsProcessor(qdrant, config);
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
  }, 300000); // 5 minutes
}

async function sendInitialThought() {
  if (conversationState.waitingForResponse) return;
  
  const thought = await generateProactiveThought();
  console.log(`Broadcasting initial thought: ${thought}`);
  
  // Broadcast to all connected clients
  wss.clients.forEach(client => {
    if (client.readyState === client.OPEN) {
      client.send(JSON.stringify({
        type: 'proactive_message',
        message: thought,
        timestamp: new Date().toISOString()
      }));
    }
  });
  
  conversationState.waitingForResponse = true;
  conversationState.lastMessage = Date.now();
}

function sendCheckIn() {
  console.log('Sending check-in message');
  
  const checkInMessage = "Are you still there? No worries if you're busy - I'll wait quietly until you're ready to chat.";
  
  wss.clients.forEach(client => {
    if (client.readyState === client.OPEN) {
      client.send(JSON.stringify({
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
            type: 'proactive_message',
            message: quietMessage,
            timestamp: new Date().toISOString()
          }));
        }
      });
      
      stopProactiveThoughts();
    }
  }, 120000); // 2 minutes
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
  }, 600000); // 10 minutes
}


wss.on('connection', (ws) => {
  console.log('Client connected to WebSocket');

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      // Check for a specific signal from the client
      if (data.type === 'user_typing') {
        // console.log('User is typing, resetting idle timer.');
        resetIdleTimeout();
      }
    } catch (e) {
      console.log('Received non-JSON message from client: %s', message);
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
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
    const apiUrl = `${config.embeddingUrl}v1/embeddings`;
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
    // The URL from environment now points to the base of the OpenAI-compatible API
    const apiUrl = `${config.llmUrl}v1/chat/completions`;

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
app.get('/api/dashboard', async (req, res) => {
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
app.delete('/api/news/bulk', async (req, res) => {
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

// API endpoint for deleting news entries
app.delete('/api/news/:id', async (req, res) => {
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
app.post('/api/process-news', async (req, res) => {
  try {
    console.log('Manual news processing triggered');
    await newsProcessor.processNewsFeeds();
    res.json({ 
      success: true, 
      mood: newsProcessor.moodState,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error processing news:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// API endpoint for manual news processing (GET - for browser access)
app.get('/api/process-news', async (req, res) => {
  try {
    console.log('Manual news processing triggered via GET');
    await newsProcessor.processNewsFeeds();
    res.json({ 
      success: true, 
      mood: newsProcessor.moodState,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error processing news:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// API endpoint for mood status
app.get('/api/mood', (req, res) => {
  try {
    const mood = {
      score: newsProcessor.moodState.score,
      description: newsProcessor.getMoodDescription(),
      topics: newsProcessor.moodState.topics.slice(0, 10),
      timestamp: new Date().toISOString()
    };
    res.json(mood);
  } catch (error) {
    console.error('Error getting mood:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Chat endpoint (existing)
app.post('/api/chat', async (req, res) => {
  try {
    const { message, userId } = req.body;
    
    if (!message || !userId) {
      return res.status(400).json({ error: 'Message and userId are required' });
    }

    // Reset the idle timer on every user interaction
    resetIdleTimeout();
    
    // 1. Define the system prompt
    const systemPrompt = {
      role: 'system',
      content: 'You are Aura, a thoughtful AI assistant. Respond naturally to the user\'s message. Do not reference or respond to your own proactive thoughts - only respond to what the user actually says. Keep responses conversational and helpful.'
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
    const botResponse = await generateResponse(messageHistory);
    
    // 5. Generate embeddings for the new conversation turn for future context
    const embedding = await generateEmbeddings(`User: ${message}\nAura: ${botResponse}`);
    
    // 6. Store the new conversation turn in the database
    await storeConversation(userId, message, botResponse, embedding);
    
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

// Start the server
server.listen(config.port, async () => {
  console.log(`Webhook API server with WebSocket support running on port ${config.port}`);
  // Initialize QDRANT collection
  await initializeCollection();
  
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
