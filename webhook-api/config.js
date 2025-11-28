const fs = require('fs');
const path = require('path');

/**
 * Configuration Manager
 * Centralizes all configuration loading and validation
 */
class ConfigManager {
  constructor() {
    this.config = this.loadConfig();
    this.validateConfig();
  }

  loadConfig() {
    // Load .env if available
    try { 
      require('dotenv').config(); 
    } catch (e) { 
      console.warn('dotenv not available, using environment variables only');
    }

    return {
      // Server Configuration
      port: parseInt(process.env.PORT) || 3000,
      nodeEnv: process.env.NODE_ENV || 'development',
      debug: process.env.DEBUG === 'true' || process.env.NODE_ENV === 'development',
      
      // External Services
      llmUrl: process.env.LLM_URL || 'http://localhost:8080',
      embeddingUrl: process.env.EMBEDDING_URL || 'http://localhost:8081',
      qdrantUrl: process.env.QDRANT_URL || 'http://192.168.1.2:6333',
      
      // Database Configuration
      collectionName: process.env.COLLECTION_NAME || 'conversations',
      
      // AI Behavior Configuration
      devMock: process.env.DEV_MOCK === 'true',
      paraphraseQuestions: process.env.PARAPHRASE_QUESTIONS === 'true',
      askCooldownMs: parseInt(process.env.ASK_COOLDOWN_MS) || 7 * 24 * 60 * 60 * 1000, // 7 days
      embedAutoSaveSim: parseFloat(process.env.EMBED_AUTO_SAVE_SIM) || 0.90,
      embedConfirmSim: parseFloat(process.env.EMBED_CONFIRM_SIM) || 0.78,
      
      // Timing Configuration
      idleTimeoutMs: parseInt(process.env.IDLE_TIMEOUT_MS) || 600000, // 10 minutes
      proactiveCheckinMs: parseInt(process.env.PROACTIVE_CHECKIN_MS) || 300000, // 5 minutes
      proactiveQuietMs: parseInt(process.env.PROACTIVE_QUIET_MS) || 120000, // 2 minutes
      
      // Security Configuration
      adminUserIds: this.parseAdminUserIds(),
      
      // File Paths
      thoughtsDir: path.join(__dirname, 'thoughts'),
      profilePath: path.join(__dirname, 'profile.json'),
      accountsPath: path.join(__dirname, 'accounts.json'),
      newsDataPath: path.join(__dirname, 'news-data.json'),
      telemetryPath: path.join(__dirname, 'telemetry.json')
    };
  }

  parseAdminUserIds() {
    const defaultAdmins = ['2351d788-4fb9-4dcf-88a1-56f63e06f649'];
    const envAdmins = process.env.ADMIN_USER_IDS 
      ? process.env.ADMIN_USER_IDS.split(',').map(id => id.trim()).filter(Boolean)
      : [];
    return [...defaultAdmins, ...envAdmins];
  }

  validateConfig() {
    const required = ['llmUrl', 'embeddingUrl'];
    const missing = required.filter(key => !this.config[key]);
    
    if (missing.length > 0) {
      console.warn(`Missing required configuration: ${missing.join(', ')}`);
      if (!this.config.devMock) {
        console.warn('Consider setting DEV_MOCK=true for local development');
      }
    }

    // Validate numeric values
    if (this.config.port < 1 || this.config.port > 65535) {
      throw new Error(`Invalid port number: ${this.config.port}`);
    }

    if (this.config.embedAutoSaveSim < 0 || this.config.embedAutoSaveSim > 1) {
      throw new Error(`Invalid embedAutoSaveSim value: ${this.config.embedAutoSaveSim}`);
    }

    if (this.config.embedConfirmSim < 0 || this.config.embedConfirmSim > 1) {
      throw new Error(`Invalid embedConfirmSim value: ${this.config.embedConfirmSim}`);
    }

    // Ensure directories exist
    this.ensureDirectories();
  }

  ensureDirectories() {
    const dirs = [this.config.thoughtsDir];
    dirs.forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
  }

  get(key) {
    return this.config[key];
  }

  getAll() {
    return { ...this.config };
  }

  isDevelopment() {
    return this.config.nodeEnv === 'development';
  }

  isProduction() {
    return this.config.nodeEnv === 'production';
  }

  isDebugMode() {
    return this.config.debug;
  }
}

module.exports = new ConfigManager();