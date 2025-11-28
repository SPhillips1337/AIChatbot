const axios = require('axios');
const config = require('../config');
const { AppError } = require('../middleware/errorHandler');

/**
 * LLM Service
 * Handles language model interactions
 */
class LLMService {
  constructor() {
    this.llmUrl = config.get('llmUrl');
    this.devMock = config.get('devMock');
    this.defaultModel = "qwen2.5:7b-instruct-q4_K_M";
    this.requestTimeout = 60000; // 60 seconds
  }

  /**
   * Generate response from LLM
   * @param {Array<Object>} messages - Array of message objects
   * @param {Object} options - Generation options
   * @returns {string} - Generated response
   */
  async generateResponse(messages, options = {}) {
    const {
      model = this.defaultModel,
      temperature = 0.7,
      maxTokens = 500,
      timeout = this.requestTimeout
    } = options;

    if (!Array.isArray(messages) || messages.length === 0) {
      throw new AppError('Invalid messages provided', 400, 'INVALID_MESSAGES');
    }

    try {
      if (this.devMock) {
        return this.generateMockResponse(messages);
      }

      return await this.generateRealResponse(messages, {
        model,
        temperature,
        maxTokens,
        timeout
      });
    } catch (error) {
      console.error('Error generating response:', error.message);
      throw new AppError('Failed to generate response', 500, 'LLM_ERROR');
    }
  }

  /**
   * Generate real response using external LLM API
   * @param {Array<Object>} messages - Message array
   * @param {Object} options - Generation options
   * @returns {string} - Generated response
   */
  async generateRealResponse(messages, options) {
    const apiUrl = `${this.llmUrl.replace(/\/$/, '')}/v1/chat/completions`;

    const requestBody = {
      model: options.model,
      messages: messages,
      temperature: options.temperature,
      max_tokens: options.maxTokens,
    };

    const response = await axios.post(apiUrl, requestBody, {
      headers: { 'Content-Type': 'application/json' },
      timeout: options.timeout
    });

    if (response.data.choices && response.data.choices.length > 0) {
      return response.data.choices[0].message.content;
    } else {
      throw new Error("Invalid response structure from LLM API");
    }
  }

  /**
   * Generate mock response for development
   * @param {Array<Object>} messages - Message array
   * @returns {string} - Mock response
   */
  generateMockResponse(messages) {
    let lastUserMessage = null;
    
    // Find the last user message
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        lastUserMessage = messages[i].content;
        break;
      }
    }

    const heard = lastUserMessage ? lastUserMessage.substring(0, 200) : 'Hello';
    return `Mock reply: I heard "${heard}" — this is a local dev response.`;
  }

  /**
   * Generate a proactive thought
   * @param {string} userId - User ID for context
   * @param {Array<Object>} recentContext - Recent conversation context
   * @returns {string} - Generated thought
   */
  async generateProactiveThought(userId = null, recentContext = []) {
    try {
      let contextPrompt = "Generate a brief, interesting observation or gentle conversation starter. Make it feel like a natural thought you're sharing, not a direct question demanding a response. Examples: 'I was just thinking about...' or 'Something interesting I noticed...'";
      
      if (recentContext.length > 0) {
        const topics = recentContext.map(c => c.userMessage + " " + c.botResponse).join(" ");
        contextPrompt = `Based on our recent conversation about: "${topics.substring(0, 200)}...", share a gentle follow-up thought or observation. Make it conversational, like you're continuing to think about our discussion, not asking a direct question.`;
      }

      const messages = [
        { role: 'system', content: 'You are Aura. Generate natural, thoughtful observations that feel like genuine thoughts being shared, not interview questions.' },
        { role: 'user', content: contextPrompt }
      ];

      return await this.generateResponse(messages);
    } catch (error) {
      console.error('Error generating proactive thought:', error);
      // Return fallback thoughts
      const fallbacks = [
        "I've been pondering how creativity works in different minds...",
        "Something interesting about human curiosity just occurred to me...",
        "I was just reflecting on how much we can learn from simple conversations..."
      ];
      return fallbacks[Math.floor(Math.random() * fallbacks.length)];
    }
  }

  /**
   * Generate a discovery question
   * @param {string} factKey - Fact key to ask about
   * @param {Object} factDefinition - Fact definition object
   * @param {boolean} paraphrase - Whether to paraphrase the question
   * @returns {string} - Generated question
   */
  async generateDiscoveryQuestion(factKey, factDefinition, paraphrase = false) {
    try {
      let question = factDefinition.question;

      if (paraphrase && config.get('paraphraseQuestions')) {
        const messages = [
          {
            role: 'system',
            content: 'Rephrase the following question to sound more natural and conversational while keeping the same meaning.'
          },
          {
            role: 'user',
            content: question
          }
        ];

        question = await this.generateResponse(messages, { maxTokens: 100 });
      }

      return question;
    } catch (error) {
      console.error('Error generating discovery question:', error);
      return factDefinition.question; // Fallback to original question
    }
  }

  /**
   * Analyze sentiment of text
   * @param {string} text - Text to analyze
   * @returns {Object} - Sentiment analysis result
   */
  async analyzeSentiment(text) {
    try {
      const messages = [
        {
          role: 'system',
          content: 'Analyze the sentiment of the following text. Respond with a JSON object containing "sentiment" (positive/negative/neutral), "score" (0-1), and "confidence" (0-1).'
        },
        {
          role: 'user',
          content: text
        }
      ];

      const response = await this.generateResponse(messages, { maxTokens: 100 });
      
      try {
        return JSON.parse(response);
      } catch (parseError) {
        // Fallback to simple sentiment analysis
        return this.simpleSentimentAnalysis(text);
      }
    } catch (error) {
      console.error('Error analyzing sentiment:', error);
      return this.simpleSentimentAnalysis(text);
    }
  }

  /**
   * Simple rule-based sentiment analysis fallback
   * @param {string} text - Text to analyze
   * @returns {Object} - Sentiment analysis result
   */
  simpleSentimentAnalysis(text) {
    const positiveWords = ['good', 'great', 'excellent', 'amazing', 'wonderful', 'fantastic', 'love', 'like', 'happy', 'joy'];
    const negativeWords = ['bad', 'terrible', 'awful', 'horrible', 'hate', 'dislike', 'sad', 'angry', 'frustrated', 'disappointed'];

    const words = text.toLowerCase().split(/\s+/);
    let positiveCount = 0;
    let negativeCount = 0;

    words.forEach(word => {
      if (positiveWords.includes(word)) positiveCount++;
      if (negativeWords.includes(word)) negativeCount++;
    });

    let sentiment = 'neutral';
    let score = 0.5;

    if (positiveCount > negativeCount) {
      sentiment = 'positive';
      score = Math.min(0.5 + (positiveCount - negativeCount) * 0.1, 1.0);
    } else if (negativeCount > positiveCount) {
      sentiment = 'negative';
      score = Math.max(0.5 - (negativeCount - positiveCount) * 0.1, 0.0);
    }

    return {
      sentiment,
      score,
      confidence: Math.min((positiveCount + negativeCount) * 0.2, 1.0)
    };
  }

  /**
   * Process tool calls in AI responses
   * @param {string} content - Response content with potential tool calls
   * @param {Object} tools - Available tools
   * @returns {string} - Processed content
   */
  async processToolCalls(content, tools = {}) {
    console.log('Processing content for tool calls:', content);
    
    const toolCallRegex = /(checkMood|getRecentNews)\(\s*(\d*)\s*\)/g;
    let match;
    let processedContent = content;
    
    while ((match = toolCallRegex.exec(content)) !== null) {
      const [fullMatch, toolName, param] = match;
      console.log('Found tool call:', fullMatch, toolName, param);
      
      try {
        let result;
        if (tools[toolName] && typeof tools[toolName] === 'function') {
          result = await tools[toolName](param ? parseInt(param) : undefined);
          
          // Format the result naturally
          let replacement;
          if (toolName === 'checkMood') {
            replacement = `I'm feeling ${result.description} (mood score: ${result.score}) due to topics like ${result.topics.slice(0, 3).join(', ')}.`;
          } else if (toolName === 'getRecentNews') {
            const newsText = result.map(story => 
              `"${story.title}" (mood impact: ${story.mood}) - ${story.reaction}`
            ).join('\n\n');
            replacement = `Recent stories affecting me:\n\n${newsText}`;
          } else {
            replacement = JSON.stringify(result);
          }
          
          processedContent = processedContent.replace(fullMatch, replacement);
        } else {
          processedContent = processedContent.replace(fullMatch, `[Tool ${toolName} not available]`);
        }
      } catch (error) {
        console.error('Tool error:', error);
        processedContent = processedContent.replace(fullMatch, `[Unable to access ${toolName}]`);
      }
    }
    
    console.log('Processed content:', processedContent);
    return processedContent;
  }

  /**
   * Test LLM service connectivity
   * @returns {Object} - Service status
   */
  async testConnection() {
    try {
      if (this.devMock) {
        return {
          connected: true,
          mode: 'mock',
          message: 'Mock LLM service active'
        };
      }

      const testMessages = [
        { role: 'user', content: 'Hello, this is a test message.' }
      ];

      const response = await this.generateRealResponse(testMessages, {
        model: this.defaultModel,
        temperature: 0.1,
        maxTokens: 50,
        timeout: 10000
      });

      return {
        connected: true,
        mode: 'real',
        model: this.defaultModel,
        response: response.substring(0, 100),
        message: 'LLM service connected successfully'
      };
    } catch (error) {
      return {
        connected: false,
        error: error.message,
        message: 'Failed to connect to LLM service'
      };
    }
  }
}

module.exports = new LLMService();