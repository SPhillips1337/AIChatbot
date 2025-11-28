const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { validateSchema, schemas, rateLimit } = require('../middleware/validation');
const { asyncHandler } = require('../middleware/errorHandler');
const llmService = require('../services/llm');
const embeddingService = require('../services/embedding');
const databaseService = require('../services/database');
const websocketService = require('../services/websocket');
const profileStore = require('../profileStore');

const router = express.Router();

// Apply rate limiting to chat endpoints
router.use(rateLimit({ windowMs: 60000, maxRequests: 30 })); // 30 requests per minute

/**
 * Main Chat Endpoint
 * POST /api/chat
 */
router.post('/',
  requireAuth({ optional: true }),
  validateSchema(schemas.chatMessage),
  asyncHandler(async (req, res) => {
    const { message, userId } = req.body;
    
    try {
      // Reset idle timeout since user is active
      websocketService.resetIdleTimeout();
      
      // Generate embedding for the user message
      const messageEmbedding = await embeddingService.generateEmbedding(message);
      
      // Retrieve relevant context from conversation history
      const context = await databaseService.retrieveContext(userId, messageEmbedding, 3);
      
      // Get or create user profile
      let profile = await profileStore.getProfile(userId);
      if (!profile) {
        profile = createNewProfile();
        await profileStore.saveProfile(userId, profile);
      }
      
      // Update profile with new message
      await updateUserProfile(userId, message);
      
      // Build conversation context for LLM
      const messages = buildConversationMessages(message, context, profile);
      
      // Generate AI response
      let response = await llmService.generateResponse(messages);
      
      // Process any tool calls in the response
      const tools = {
        checkMood: async () => {
          const newsProcessor = require('../news-processor');
          return {
            score: newsProcessor.moodState.score,
            description: newsProcessor.getMoodDescription(),
            topics: newsProcessor.moodState.topics.slice(0, 10),
            timestamp: new Date().toISOString()
          };
        },
        getRecentNews: async (limit = 5) => {
          const newsItems = await databaseService.getNewsItems(limit);
          return newsItems.map(item => ({
            title: item.payload.title,
            url: item.payload.url,
            mood: item.payload.mood,
            reaction: item.payload.reaction,
            topics: item.payload.topics,
            timestamp: item.payload.timestamp
          }));
        }
      };
      
      response = await llmService.processToolCalls(response, tools);
      
      // Store the conversation
      const conversationEmbedding = await embeddingService.generateEmbedding(
        `${message} ${response}`
      );
      
      await databaseService.storeConversation(
        userId, 
        message, 
        response, 
        conversationEmbedding
      );
      
      // Process any fact extraction or discovery questions
      await processFactExtraction(userId, message, response);
      
      res.json({
        response,
        timestamp: new Date().toISOString(),
        userId
      });
      
    } catch (error) {
      console.error('Chat error:', error);
      res.status(500).json({
        error: 'Failed to process chat message',
        code: 'CHAT_ERROR'
      });
    }
  })
);

/**
 * Trigger Proactive Thought
 * POST /api/chat/trigger-thought
 */
router.post('/trigger-thought',
  requireAuth({ admin: true }),
  validateSchema({
    message: { required: true, type: 'string', minLength: 1 },
    userId: { required: false, type: 'string' }
  }),
  asyncHandler(async (req, res) => {
    const { message, userId } = req.body;
    
    console.log(`Triggering thought from API: ${message}`);
    
    if (userId) {
      websocketService.sendToUser(userId, {
        sender: 'AI',
        type: 'proactive_message',
        message
      });
    } else {
      websocketService.broadcast({
        sender: 'AI',
        type: 'proactive_message',
        message
      });
    }
    
    res.json({
      success: true,
      message: 'Thought broadcasted',
      targetUser: userId || 'all'
    });
  })
);

/**
 * Get Chat History
 * GET /api/chat/history
 */
router.get('/history',
  requireAuth(),
  asyncHandler(async (req, res) => {
    const userId = req.account.userId;
    const limit = parseInt(req.query.limit) || 20;
    
    try {
      // Get recent conversations for this user
      const recentActivity = await databaseService.getRecentActivity(limit * 2);
      
      const userConversations = recentActivity
        .filter(point => 
          point.payload.userId === userId && 
          point.payload.type === 'conversation'
        )
        .sort((a, b) => new Date(b.payload.timestamp) - new Date(a.payload.timestamp))
        .slice(0, limit)
        .map(point => ({
          userMessage: point.payload.userMessage,
          botResponse: point.payload.botResponse,
          timestamp: point.payload.timestamp
        }));
      
      res.json({
        conversations: userConversations,
        total: userConversations.length
      });
      
    } catch (error) {
      console.error('Error getting chat history:', error);
      res.status(500).json({
        error: 'Failed to retrieve chat history',
        code: 'HISTORY_ERROR'
      });
    }
  })
);

/**
 * Helper Functions
 */

function createNewProfile() {
  return {
    facts: {},
    interests: [],
    sentimentHistory: [],
    trustLevel: 5,
    conversationTopics: [],
    lastAsked: {},
    created_at: new Date().toISOString()
  };
}

async function updateUserProfile(userId, message) {
  try {
    let profile = await profileStore.getProfile(userId) || createNewProfile();
    
    // Analyze sentiment
    const sentiment = await llmService.analyzeSentiment(message);
    
    // Update sentiment history
    profile.sentimentHistory = profile.sentimentHistory || [];
    profile.sentimentHistory.push({
      message: message.substring(0, 100),
      sentiment: sentiment.sentiment,
      score: sentiment.score,
      timestamp: new Date().toISOString()
    });
    
    // Keep only last 50 sentiment entries
    if (profile.sentimentHistory.length > 50) {
      profile.sentimentHistory = profile.sentimentHistory.slice(-50);
    }
    
    // Extract and update facts
    await extractAndUpdateFacts(profile, message);
    
    // Update conversation topics (simple keyword extraction)
    updateConversationTopics(profile, message);
    
    await profileStore.saveProfile(userId, profile);
    
  } catch (error) {
    console.error('Error updating user profile:', error);
  }
}

async function extractAndUpdateFacts(profile, message) {
  try {
    const factDefinitions = require('../fact_definitions');
    const embeddingMatcher = require('../embeddingMatcher');
    
    // Initialize embedding matcher if not already done
    if (!embeddingMatcher.initialized) {
      const matcher = embeddingMatcher({
        generateEmbeddings: embeddingService.generateEmbedding.bind(embeddingService),
        factDefinitions: factDefinitions.definitions,
        similarityThreshold: 0.78
      });
      await matcher.preloadExampleEmbeddings();
      embeddingMatcher.initialized = true;
      embeddingMatcher.match = matcher.match;
    }
    
    // Try to match facts using embeddings
    const match = await embeddingMatcher.match(message);
    if (match && match.similarity > 0.78) {
      profile.facts = profile.facts || {};
      profile.facts[match.key] = {
        value: match.value,
        confidence: match.similarity,
        timestamp: new Date().toISOString()
      };
    }
    
  } catch (error) {
    console.error('Error extracting facts:', error);
  }
}

function updateConversationTopics(profile, message) {
  // Simple keyword extraction for topics
  const words = message.toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(word => word.length > 3);
  
  profile.conversationTopics = profile.conversationTopics || [];
  
  words.forEach(word => {
    const existing = profile.conversationTopics.find(topic => topic.word === word);
    if (existing) {
      existing.count++;
      existing.lastMentioned = new Date().toISOString();
    } else {
      profile.conversationTopics.push({
        word,
        count: 1,
        lastMentioned: new Date().toISOString()
      });
    }
  });
  
  // Keep only top 20 topics
  profile.conversationTopics.sort((a, b) => b.count - a.count);
  profile.conversationTopics = profile.conversationTopics.slice(0, 20);
}

function buildConversationMessages(message, context, profile) {
  const messages = [
    {
      role: 'system',
      content: `You are Aura, a thoughtful AI assistant. You have access to conversation history and user context. 
      
User profile summary:
- Trust level: ${profile.trustLevel}/10
- Main interests: ${profile.conversationTopics?.slice(0, 3).map(t => t.word).join(', ') || 'Getting to know them'}
- Recent sentiment: ${getRecentSentiment(profile)}

Be natural, empathetic, and engaging. Use the conversation history to maintain context.`
    }
  ];
  
  // Add relevant context from conversation history
  if (context && context.length > 0) {
    const contextSummary = context
      .slice(0, 2)
      .map(c => `User: ${c.userMessage}\nAura: ${c.botResponse}`)
      .join('\n\n');
    
    messages.push({
      role: 'system',
      content: `Recent conversation context:\n${contextSummary}`
    });
  }
  
  // Add current user message
  messages.push({
    role: 'user',
    content: message
  });
  
  return messages;
}

function getRecentSentiment(profile) {
  if (!profile.sentimentHistory || profile.sentimentHistory.length === 0) {
    return 'neutral';
  }
  
  const recent = profile.sentimentHistory.slice(-5);
  const avgScore = recent.reduce((sum, s) => sum + s.score, 0) / recent.length;
  
  if (avgScore > 0.6) return 'positive';
  if (avgScore < 0.4) return 'negative';
  return 'neutral';
}

async function processFactExtraction(userId, message, response) {
  // This would handle fact extraction and discovery questions
  // Implementation would depend on the specific fact definitions
  // For now, this is a placeholder
  console.log('Processing fact extraction for user:', userId);
}

module.exports = router;