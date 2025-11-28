const axios = require('axios');
const config = require('../config');
const { AppError } = require('../middleware/errorHandler');

/**
 * Embedding Service
 * Handles text embedding generation
 */
class EmbeddingService {
  constructor() {
    this.embeddingUrl = config.get('embeddingUrl');
    this.devMock = config.get('devMock');
    this.cache = new Map(); // Simple in-memory cache
    this.maxCacheSize = 1000;
  }

  /**
   * Generate embeddings for text
   * @param {string} text - Text to generate embeddings for
   * @returns {Array<number>} - Embedding vector
   */
  async generateEmbedding(text) {
    if (!text || typeof text !== 'string') {
      throw new AppError('Invalid text provided for embedding', 400, 'INVALID_TEXT');
    }

    // Check cache first
    const cacheKey = this.getCacheKey(text);
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    try {
      let embedding;

      if (this.devMock) {
        embedding = this.generateMockEmbedding();
      } else {
        embedding = await this.generateRealEmbedding(text);
      }

      // Cache the result
      this.cacheEmbedding(cacheKey, embedding);

      return embedding;
    } catch (error) {
      console.error('Error generating embeddings:', error.message);
      throw new AppError('Failed to generate embeddings', 500, 'EMBEDDING_ERROR');
    }
  }

  /**
   * Generate real embeddings using external API
   * @param {string} text - Text to embed
   * @returns {Array<number>} - Embedding vector
   */
  async generateRealEmbedding(text) {
    const apiUrl = `${this.embeddingUrl.replace(/\/$/, '')}/v1/embeddings`;
    const requestBody = {
      model: "bge-m3:latest",
      input: text
    };

    const response = await axios.post(apiUrl, requestBody, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000 // 30 second timeout
    });

    if (response.data.data && response.data.data.length > 0) {
      return response.data.data[0].embedding;
    } else {
      throw new Error("Invalid response structure from Embedding API");
    }
  }

  /**
   * Generate mock embeddings for development
   * @returns {Array<number>} - Mock embedding vector
   */
  generateMockEmbedding() {
    const size = 1024;
    return new Array(size).fill(0).map(() => (Math.random() - 0.5) * 0.02);
  }

  /**
   * Generate embeddings for multiple texts
   * @param {Array<string>} texts - Array of texts to embed
   * @returns {Array<Array<number>>} - Array of embedding vectors
   */
  async generateBatchEmbeddings(texts) {
    if (!Array.isArray(texts)) {
      throw new AppError('Texts must be an array', 400, 'INVALID_INPUT');
    }

    const embeddings = [];
    for (const text of texts) {
      try {
        const embedding = await this.generateEmbedding(text);
        embeddings.push(embedding);
      } catch (error) {
        console.error(`Failed to generate embedding for text: ${text.substring(0, 50)}...`);
        embeddings.push(null);
      }
    }

    return embeddings;
  }

  /**
   * Calculate cosine similarity between two embeddings
   * @param {Array<number>} a - First embedding
   * @param {Array<number>} b - Second embedding
   * @returns {number} - Cosine similarity score
   */
  calculateSimilarity(a, b) {
    if (!a || !b || a.length !== b.length) {
      return 0;
    }

    let dot = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    if (normA === 0 || normB === 0) {
      return 0;
    }

    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Find most similar embedding from a list
   * @param {Array<number>} queryEmbedding - Query embedding
   * @param {Array<{embedding: Array<number>, data: any}>} candidates - Candidate embeddings with data
   * @returns {Object|null} - Most similar candidate with similarity score
   */
  findMostSimilar(queryEmbedding, candidates) {
    if (!candidates || candidates.length === 0) {
      return null;
    }

    let bestMatch = null;
    let bestSimilarity = -1;

    for (const candidate of candidates) {
      const similarity = this.calculateSimilarity(queryEmbedding, candidate.embedding);
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestMatch = {
          ...candidate.data,
          similarity
        };
      }
    }

    return bestMatch;
  }

  /**
   * Generate cache key for text
   * @param {string} text - Text to generate key for
   * @returns {string} - Cache key
   */
  getCacheKey(text) {
    // Simple hash function for cache key
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString();
  }

  /**
   * Cache embedding result
   * @param {string} key - Cache key
   * @param {Array<number>} embedding - Embedding to cache
   */
  cacheEmbedding(key, embedding) {
    // Simple LRU cache implementation
    if (this.cache.size >= this.maxCacheSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, embedding);
  }

  /**
   * Clear embedding cache
   */
  clearCache() {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   * @returns {Object} - Cache statistics
   */
  getCacheStats() {
    return {
      size: this.cache.size,
      maxSize: this.maxCacheSize,
      hitRate: this.cacheHits / (this.cacheHits + this.cacheMisses) || 0
    };
  }

  /**
   * Test embedding service connectivity
   * @returns {Object} - Service status
   */
  async testConnection() {
    try {
      if (this.devMock) {
        return {
          connected: true,
          mode: 'mock',
          message: 'Mock embedding service active'
        };
      }

      const testEmbedding = await this.generateRealEmbedding('test connection');
      return {
        connected: true,
        mode: 'real',
        vectorSize: testEmbedding.length,
        message: 'Embedding service connected successfully'
      };
    } catch (error) {
      return {
        connected: false,
        error: error.message,
        message: 'Failed to connect to embedding service'
      };
    }
  }
}

module.exports = new EmbeddingService();