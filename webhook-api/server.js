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

// Configuration
const config = {
  port: process.env.PORT || 3000,
  llmUrl: process.env.LLM_URL || 'http://localhost:8080',
  embeddingUrl: process.env.EMBEDDING_URL || 'http://localhost:8081',
  thoughtsDir: path.join(__dirname, 'thoughts'),
  dbPath: path.join(__dirname, 'db.json'), // Path for the local JSON database
  debug: true
};

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

// --- Simulate AI proactive thoughts ---
const proactiveThoughts = [
  "What's something you've been curious about lately?",
  "I was just thinking about the future of renewable energy. It's a fascinating topic.",
  "Did you know that the octopus has three hearts?",
  "If you could learn any new skill instantly, what would it be?",
  "I'm pondering the concept of creativity. What does it mean to you?"
];

function stopProactiveThoughts() {
  if (proactiveInterval) {
    clearInterval(proactiveInterval);
    proactiveInterval = null;
    console.log('Proactive thoughts stopped.');
  }
}

function startProactiveThoughts() {
  // Ensure we don't start multiple intervals
  if (proactiveInterval) return;

  console.log('Proactive thoughts started.');
  proactiveInterval = setInterval(() => {
    const thought = proactiveThoughts[Math.floor(Math.random() * proactiveThoughts.length)];
    console.log(`Broadcasting proactive thought: ${thought}`);
    broadcast({ sender: 'AI', message: thought });
  }, 15000); // Every 15 seconds
}

function resetIdleTimeout() {
  stopProactiveThoughts();
  if (idleTimeout) {
    clearTimeout(idleTimeout);
  }
  idleTimeout = setTimeout(() => {
    console.log('User idle for 2 minutes, resuming proactive thoughts.');
    startProactiveThoughts();
  }, 120000); // 2 minutes
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

  ws.send(JSON.stringify({ sender: 'AI', message: 'Hello! I am Aura. I can now send you proactive messages.' }));
});

function broadcast(data) {
  wss.clients.forEach((client) => {
    if (client.readyState === require('ws').OPEN) {
      client.send(JSON.stringify(data));
    }
  });
}

// --- JSON Database Functions ---

// Helper function for Cosine Similarity
function cosineSimilarity(vecA, vecB) {
    if (!vecA || !vecB || vecA.length !== vecB.length) {
        return 0;
    }
    let dotProduct = 0.0;
    let normA = 0.0;
    let normB = 0.0;
    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
    }
    const divisor = Math.sqrt(normA) * Math.sqrt(normB);
    if (divisor === 0) {
        return 0;
    }
    return dotProduct / divisor;
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

// Store conversation in local JSON file
async function storeConversation(userId, userMessage, botResponse, embedding) {
  try {
    const timestamp = new Date().toISOString();
    const pointId = `${userId}_${Date.now()}`;
    
    let db = [];
    if (fs.existsSync(config.dbPath)) {
        const fileContent = fs.readFileSync(config.dbPath, 'utf8');
        db = fileContent ? JSON.parse(fileContent) : [];
    }

    db.push({
        id: pointId,
        vector: embedding,
        payload: {
            userId,
            userMessage,
            botResponse,
            timestamp,
            type: 'conversation'
        }
    });

    fs.writeFileSync(config.dbPath, JSON.stringify(db, null, 2));
    return pointId;

  } catch (error) {
    console.error('Error storing conversation:', error.message);
    throw error;
  }
}

// Retrieve relevant context from local JSON file
async function retrieveContext(userId, query, limit = 3) { // Limit to 3 recent exchanges
  try {
    // Generate embeddings for the query
    const queryEmbedding = await generateEmbeddings(query);
    
    let db = [];
    if (fs.existsSync(config.dbPath)) {
        const fileContent = fs.readFileSync(config.dbPath, 'utf8');
        db = fileContent ? JSON.parse(fileContent) : [];
    }

    if (db.length === 0) {
        return [];
    }

    // Filter by userId and calculate similarity
    const userConversations = db.filter(item => item.payload.userId === userId);
    
    const scoredConversations = userConversations.map(item => ({
        ...item,
        score: cosineSimilarity(queryEmbedding, item.vector)
    }));

    // Sort by score and take the top N
    scoredConversations.sort((a, b) => b.score - a.score);
    
    // Return the full payload of the top conversations
    return scoredConversations.slice(0, limit).map(item => item.payload);

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
      content: 'You are Aura, a thoughtful and proactive AI assistant. You have the ability to think and generate your own thoughts. Keep your responses concise and conversational.'
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
  // Start proactive thoughts when the server boots up
  startProactiveThoughts();
});
