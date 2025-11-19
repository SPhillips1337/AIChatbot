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

let devMock = process.env.DEV_MOCK === 'true';
console.log('DEV_MOCK:', devMock);

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
  }, 300000); // 5 minutes
}

async function sendInitialThought(userId = null) {
  if (conversationState.waitingForResponse) return;
  
  const thought = await generateProactiveThought(userId);
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
      // Check for activity signals from the client
      if (data.type === 'user_typing' || data.type === 'user_activity') {
        // console.log('User activity detected, resetting idle timer.');
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

// API endpoint for all user profiles
app.get('/api/users', async (req, res) => {
  const profiles = await profileStore.listProfiles();
  res.json(profiles);
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

// Admin endpoint to reset mood
app.post('/api/admin/reset-mood', async (req, res) => {
  try {
    newsProcessor.moodState = { score: 0, topics: [] };
    newsProcessor.saveMoodState();
    try {
      fs.writeFileSync(newsProcessor.newsPath, JSON.stringify(newsProcessor.moodState, null, 2));
    } catch (e) {
      console.error('Error clearing news-data.json:', e.message);
      try {
        const os = require('os');
        const fallbackPath = path.join(os.tmpdir(), 'news-data.json');
        fs.writeFileSync(fallbackPath, JSON.stringify(newsProcessor.moodState, null, 2));
        newsProcessor.newsPath = fallbackPath;
        console.log('Wrote cleared mood to fallback path:', fallbackPath);
      } catch (err2) {
        console.error('Failed to write cleared mood to fallback path:', err2.message);
      }
    }
    res.json({ success: true, mood: newsProcessor.moodState });
  } catch (err) {
    console.error('Error resetting mood:', err);
    res.status(500).json({ error: 'Failed to reset mood' });
  }
});

// Admin endpoint to clear news entries (deletes news points from Qdrant and resets mood file)
app.post('/api/admin/clear-news', async (req, res) => {
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
    newsProcessor.moodState = { score: 0, topics: [] };
    try {
      fs.writeFileSync(newsProcessor.newsPath, JSON.stringify(newsProcessor.moodState, null, 2));
    } catch (e) {
      console.error('Error clearing news-data.json:', e.message);
      try {
        const os = require('os');
        const fallbackPath = path.join(os.tmpdir(), 'news-data.json');
        fs.writeFileSync(fallbackPath, JSON.stringify(newsProcessor.moodState, null, 2));
        newsProcessor.newsPath = fallbackPath;
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
// Tool functions for AI to access its own state
const aiTools = {
  async checkMood() {
    return {
      score: newsProcessor.moodState.score,
      description: newsProcessor.getMoodDescription(),
      topics: newsProcessor.moodState.topics.slice(0, 10),
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
const profileStore = require('./profileStore');
const userProfiles = new Map();

const FACT_PATTERNS = [
  { key: 'name', label: 'name', regex: /\b(?:my name is|i'm called|call me)\s+([A-Za-z][A-Za-z\s'-]{1,30})/i, confidence: 0.95 },
  { key: 'favorite_color', label: 'favorite color', regex: /\b(?:my favourite colour is|my favorite color is|i like (?:the )?color)\s+([A-Za-z]+)/i, confidence: 0.85 },
  { key: 'eye_color', label: 'eye color', regex: /\b(?:my eyes (?:are|'re)|i have)\s+([A-Za-z]+)\s+eyes\b/i, confidence: 0.8 },
  { key: 'location', label: 'hometown', regex: /\b(?:i (?:live|am|i'm) (?:in|at)|i'm from|i reside in)\s+([A-Za-z\s]{2,40})/i, confidence: 0.7 },
  { key: 'occupation', label: 'occupation', regex: /\b(?:i work as|my job is|i am a|i'm a)\s+([A-Za-z\s]{2,40})/i, confidence: 0.65 }
];

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
  if (!profile || !profile.facts) {
    return FACT_PATTERNS.map(p => ({ key: p.key, label: p.label, priority: 1 }));
  }
  
  const missing = [];
  const facts = profile.facts;
  
  // High priority: name (if not set via displayName)
  if (!facts.name || facts.name.confidence < 0.9) {
    missing.push({ key: 'name', label: 'name', priority: 3 });
  }
  
  // Medium priority: personal preferences
  if (!facts.favorite_color) {
    missing.push({ key: 'favorite_color', label: 'favorite color', priority: 2 });
  }
  
  // Lower priority: background info
  if (!facts.location) {
    missing.push({ key: 'location', label: 'where you live', priority: 1 });
  }
  if (!facts.occupation) {
    missing.push({ key: 'occupation', label: 'what you do', priority: 1 });
  }
  
  // If we have very few facts overall, prioritize learning more
  const factCount = Object.keys(facts).filter(k => facts[k]?.value).length;
  if (factCount < 2) {
    missing.forEach(m => m.priority += 1);
  }
  
  return missing.sort((a, b) => b.priority - a.priority);
}

// Generate a discovery question based on missing facts
async function generateDiscoveryQuestion(userId) {
  try {
    const profile = userProfiles.get(userId) || profileStore.getProfile(userId);
    if (!profile) return null;
    
    const missing = detectMissingFacts(profile);
    if (missing.length === 0) return null;
    
    const topMissing = missing[0];
    const knownFacts = summarizeUserFacts(profile.facts, 3);
    
    const prompt = `You are Aura, a curious AI who genuinely wants to learn about the person you're talking to. 
    
${knownFacts ? `You already know: ${knownFacts}.` : 'You don\'t know much about them yet.'}

Generate a natural, conversational question to discover their ${topMissing.label}. Make it feel like genuine curiosity, not an interview. Be warm and personal. Examples:
- For name: "I realize I don't know what to call you! What should I call you?"
- For favorite color: "I'm curious — do you have a favorite color?"
- For location: "Where in the world are you based?"
- For occupation: "What do you spend your time doing?"

Keep it to one short, friendly question.`;

    const messages = [
      { role: 'system', content: 'You are Aura, a thoughtful and curious AI. Ask natural questions to learn about people. Be warm and conversational.' },
      { role: 'user', content: prompt }
    ];

    const response = await generateResponse(messages);
    return response || null;
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

app.post('/api/chat', async (req, res) => {
  try {
    const { message, userId, displayName } = req.body;
    
    if (!message || !userId) {
      return res.status(400).json({ error: 'Message and userId are required' });
    }

    const lowerMessage = message.toLowerCase();
    // Reset the idle timer on every user interaction
    resetIdleTimeout();
    
    // 1. Define the system prompt with user personality context + AI opinions
    const userProfile = getOrCreateProfile(userId);
    if (displayName) {
      applyDisplayNameToProfile(userProfile, displayName);
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
      newsProcessor.moodState.score = Math.max(-10, Math.min(10, newsProcessor.moodState.score + userSentiment));
      newsProcessor.saveMoodState();
    }
    
    // 6. Check if user is asking about mood/feelings and inject real data
    const factAnswer = resolveFactQuestion(lowerMessage, currentUserProfile);

    if (factAnswer) {
      botResponse = factAnswer;
    } else if (lowerMessage.includes('feel') || lowerMessage.includes('mood')) {
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
    } else if (mentionsNews) {
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
        if (discoveryQuestion && !botResponse.toLowerCase().includes(discoveryQuestion.toLowerCase().substring(0, 20))) {
          // Only append if the question isn't already in the response
          botResponse += ` ${discoveryQuestion}`;
        }
      }
    }
    
    // 9. Generate embeddings for the new conversation turn for future context
    const embedding = await generateEmbeddings(`User: ${message}\nAura: ${botResponse}`);
    
    // 10. Store the new conversation turn in the database
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

// Enhanced dashboard with Phase 3 data
app.get('/api/evolution', async (req, res) => {
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

// Serve dashboard UI from the main server at /admin
// This serves the repository's dashboard.html so the admin UI is available
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'dashboard.html'));
});

// Admin endpoints to get/set dev-mock flag
app.get('/api/admin/dev-mock', (req, res) => {
  res.json({ devMock });
});

app.post('/api/admin/dev-mock', (req, res) => {
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

// Serve chat UI from the webhook API so UI and API share origin
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
