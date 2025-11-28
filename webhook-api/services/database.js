const { QdrantClient } = require('@qdrant/js-client-rest');
const config = require('../config');
const { AppError } = require('../middleware/errorHandler');

/**
 * Database Service
 * Handles all QDRANT database operations
 */
class DatabaseService {
  constructor() {
    this.client = new QdrantClient({ url: config.get('qdrantUrl') });
    this.collectionName = config.get('collectionName');
    this.initialized = false;
  }

  /**
   * Initialize the database connection and collection
   */
  async initialize() {
    if (this.initialized) return;

    try {
      await this.initializeCollection();
      this.initialized = true;
      console.log('Database service initialized successfully');
    } catch (error) {
      console.error('Failed to initialize database service:', error);
      throw new AppError('Database initialization failed', 500, 'DB_INIT_ERROR');
    }
  }

  /**
   * Initialize collection if it doesn't exist
   */
  async initializeCollection() {
    try {
      const collections = await this.client.getCollections();
      const exists = collections.collections.some(c => c.name === this.collectionName);
      
      if (!exists) {
        // Test embedding to get vector dimensions
        console.log('Testing embedding API to determine vector dimensions...');
        const testEmbedding = await this.generateTestEmbedding();
        const vectorSize = testEmbedding ? testEmbedding.length : 1024;
        
        console.log(`Creating collection with vector size: ${vectorSize}`);
        await this.client.createCollection(this.collectionName, {
          vectors: { size: vectorSize, distance: 'Cosine' }
        });
        console.log(`Created collection: ${this.collectionName}`);
      }
    } catch (error) {
      console.error('Error initializing collection:', error);
      // Try creating with default size if embedding test fails
      try {
        await this.client.createCollection(this.collectionName, {
          vectors: { size: 1024, distance: 'Cosine' }
        });
        console.log(`Created collection with default size: ${this.collectionName}`);
      } catch (fallbackError) {
        throw new AppError('Failed to create collection', 500, 'COLLECTION_CREATE_ERROR');
      }
    }
  }

  /**
   * Generate test embedding to determine vector dimensions
   */
  async generateTestEmbedding() {
    try {
      const embeddingService = require('./embedding');
      return await embeddingService.generateEmbedding('test');
    } catch (error) {
      console.warn('Could not generate test embedding:', error.message);
      return null;
    }
  }

  /**
   * Store conversation in the database
   */
  async storeConversation(userId, userMessage, botResponse, embedding) {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!embedding || !Array.isArray(embedding) || embedding.length === 0) {
      throw new AppError('Invalid embedding provided', 400, 'INVALID_EMBEDDING');
    }
    
    try {
      const timestamp = new Date().toISOString();
      const pointId = Date.now() + Math.floor(Math.random() * 1000); // Ensure uniqueness
      
      console.log(`Storing conversation with embedding size: ${embedding.length}`);
      
      await this.client.upsert(this.collectionName, {
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
      console.error('Error storing conversation:', error);
      throw new AppError('Failed to store conversation', 500, 'STORE_CONVERSATION_ERROR');
    }
  }

  /**
   * Retrieve relevant context from the database
   */
  async retrieveContext(userId, queryEmbedding, limit = 3) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const searchResult = await this.client.search(this.collectionName, {
        vector: queryEmbedding,
        filter: {
          must: [{ key: 'userId', match: { value: userId } }]
        },
        limit,
        with_payload: true
      });

      return searchResult.map(point => point.payload);
    } catch (error) {
      console.error('Error retrieving context:', error);
      return [];
    }
  }

  /**
   * Store news item in the database
   */
  async storeNewsItem(newsItem, embedding) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const pointId = Date.now() + Math.floor(Math.random() * 1000);
      
      await this.client.upsert(this.collectionName, {
        points: [{
          id: pointId,
          vector: embedding,
          payload: {
            ...newsItem,
            type: 'news',
            timestamp: new Date().toISOString()
          }
        }]
      });
      
      return pointId;
    } catch (error) {
      console.error('Error storing news item:', error);
      throw new AppError('Failed to store news item', 500, 'STORE_NEWS_ERROR');
    }
  }

  /**
   * Get recent activity from the database
   */
  async getRecentActivity(limit = 50) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const result = await this.client.scroll(this.collectionName, {
        limit,
        with_payload: true
      });

      return result.points || [];
    } catch (error) {
      console.error('Error getting recent activity:', error);
      return [];
    }
  }

  /**
   * Get news items from the database
   */
  async getNewsItems(limit = 10) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const result = await this.client.scroll(this.collectionName, {
        limit: limit * 2, // Get more to filter and sort
        with_payload: true,
        filter: {
          must: [{ key: 'type', match: { value: 'news' } }]
        }
      });

      return (result.points || [])
        .sort((a, b) => new Date(b.payload.timestamp) - new Date(a.payload.timestamp))
        .slice(0, limit);
    } catch (error) {
      console.error('Error getting news items:', error);
      return [];
    }
  }

  /**
   * Delete points from the database
   */
  async deletePoints(pointIds) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      await this.client.delete(this.collectionName, {
        points: pointIds
      });
      return true;
    } catch (error) {
      console.error('Error deleting points:', error);
      throw new AppError('Failed to delete points', 500, 'DELETE_POINTS_ERROR');
    }
  }

  /**
   * Delete news items by filter
   */
  async deleteNewsByFilter(filter) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const results = await this.client.scroll(this.collectionName, {
        limit: 1000,
        with_payload: true,
        filter: {
          must: [{ key: 'type', match: { value: 'news' } }]
        }
      });
      
      const pointsToDelete = results.points
        .filter(p => p.payload.title && p.payload.title.includes(filter))
        .map(p => p.id);
      
      if (pointsToDelete.length > 0) {
        await this.deletePoints(pointsToDelete);
      }
      
      return pointsToDelete.length;
    } catch (error) {
      console.error('Error bulk deleting news entries:', error);
      throw new AppError('Failed to bulk delete news entries', 500, 'BULK_DELETE_ERROR');
    }
  }

  /**
   * Clear all news items
   */
  async clearAllNews() {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const results = await this.client.scroll(this.collectionName, {
        limit: 1000,
        with_payload: true,
        filter: { must: [{ key: 'type', match: { value: 'news' } }] }
      });

      const ids = (results.points || []).map(p => p.id);
      if (ids.length > 0) {
        await this.deletePoints(ids);
      }

      return ids.length;
    } catch (error) {
      console.error('Error clearing news:', error);
      throw new AppError('Failed to clear news', 500, 'CLEAR_NEWS_ERROR');
    }
  }

  /**
   * Get database health status
   */
  async getHealthStatus() {
    try {
      const collections = await this.client.getCollections();
      const collectionExists = collections.collections.some(c => c.name === this.collectionName);
      
      return {
        connected: true,
        collectionExists,
        collectionName: this.collectionName,
        initialized: this.initialized
      };
    } catch (error) {
      return {
        connected: false,
        error: error.message,
        initialized: this.initialized
      };
    }
  }
}

module.exports = new DatabaseService();