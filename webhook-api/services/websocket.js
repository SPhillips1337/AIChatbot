const { WebSocketServer } = require('ws');
const { authenticateWebSocket } = require('../middleware/auth');
const config = require('../config');

/**
 * WebSocket Service
 * Handles real-time communication with clients
 */
class WebSocketService {
  constructor() {
    this.wss = null;
    this.userSockets = new Map(); // userId => ws
    this.proactiveInterval = null;
    this.idleTimeout = null;
    this.conversationState = {
      lastMessage: null,
      waitingForResponse: false,
      checkInSent: false
    };
    
    // Configuration
    this.idleTimeoutMs = config.get('idleTimeoutMs');
    this.proactiveCheckinMs = config.get('proactiveCheckinMs');
    this.proactiveQuietMs = config.get('proactiveQuietMs');
  }

  /**
   * Initialize WebSocket server
   * @param {Object} server - HTTP server instance
   */
  initialize(server) {
    this.wss = new WebSocketServer({ server });
    this.setupEventHandlers();
    console.log('WebSocket service initialized');
  }

  /**
   * Setup WebSocket event handlers
   */
  setupEventHandlers() {
    this.wss.on('connection', (ws) => {
      console.log('Client connected to WebSocket');
      ws.isAlive = true;
      ws.userId = null;

      // Setup ping/pong for connection health
      ws.on('pong', () => {
        ws.isAlive = true;
      });

      ws.on('message', (message) => {
        this.handleMessage(ws, message);
      });

      ws.on('close', () => {
        console.log('Client disconnected');
        if (ws.userId) {
          this.userSockets.delete(ws.userId);
        }
      });

      ws.on('error', (error) => {
        console.error('WebSocket error:', error);
      });

      // Send welcome message
      this.sendMessage(ws, {
        sender: 'AI',
        message: 'Hello! I\'m Aura. Feel free to start a conversation whenever you\'re ready.',
        type: 'welcome'
      });
    });

    // Setup connection health check
    this.setupHealthCheck();
  }

  /**
   * Handle incoming WebSocket messages
   * @param {Object} ws - WebSocket connection
   * @param {string} message - Raw message
   */
  handleMessage(ws, message) {
    try {
      const data = JSON.parse(message);

      // Handle authentication
      if (data.type === 'auth' && data.userId) {
        const account = authenticateWebSocket(data);
        if (account) {
          ws.userId = data.userId;
          ws.account = account;
          this.userSockets.set(data.userId, ws);
          console.log('WebSocket authenticated for user:', data.userId);
          
          this.sendMessage(ws, {
            type: 'auth_success',
            message: 'Authentication successful'
          });
        } else {
          this.sendMessage(ws, {
            type: 'auth_error',
            message: 'Authentication failed'
          });
        }
        return;
      }

      // Handle activity signals
      if (data.type === 'user_typing' || data.type === 'user_activity') {
        this.resetIdleTimeout();
        return;
      }

      // Handle ping messages
      if (data.type === 'ping') {
        this.sendMessage(ws, { type: 'pong' });
        return;
      }

    } catch (e) {
      console.log('Received non-JSON message from client:', message.toString());
    }
  }

  /**
   * Send message to specific WebSocket
   * @param {Object} ws - WebSocket connection
   * @param {Object} data - Message data
   */
  sendMessage(ws, data) {
    if (ws.readyState === ws.OPEN) {
      const message = {
        timestamp: new Date().toISOString(),
        ...data
      };
      ws.send(JSON.stringify(message));
    }
  }

  /**
   * Send message to specific user
   * @param {string} userId - Target user ID
   * @param {Object} data - Message data
   */
  sendToUser(userId, data) {
    const ws = this.userSockets.get(userId);
    if (ws) {
      this.sendMessage(ws, data);
      return true;
    }
    return false;
  }

  /**
   * Broadcast message to all connected clients
   * @param {Object} data - Message data
   */
  broadcast(data) {
    this.wss.clients.forEach((client) => {
      if (client.readyState === client.OPEN) {
        this.sendMessage(client, data);
      }
    });
  }

  /**
   * Broadcast proactive message
   * @param {string} message - Message content
   * @param {string} userId - Optional specific user ID
   */
  broadcastProactiveMessage(message, userId = null) {
    const data = {
      sender: 'AI',
      type: 'proactive_message',
      message: message
    };

    if (userId) {
      this.sendToUser(userId, data);
    } else {
      this.broadcast(data);
    }

    this.conversationState.waitingForResponse = true;
    this.conversationState.lastMessage = Date.now();
  }

  /**
   * Broadcast discovery question
   * @param {Object} question - Question object with key and message
   * @param {string} userId - Optional specific user ID
   */
  broadcastDiscoveryQuestion(question, userId = null) {
    const data = {
      sender: 'AI',
      type: 'discovery_question',
      key: question.key,
      message: question.question
    };

    if (userId) {
      this.sendToUser(userId, data);
    } else {
      this.broadcast(data);
    }

    this.conversationState.waitingForResponse = true;
    this.conversationState.lastMessage = Date.now();
  }

  /**
   * Broadcast fact confirmation request
   * @param {Object} fact - Fact object with key, value, and message
   * @param {string} userId - Optional specific user ID
   */
  broadcastFactConfirmation(fact, userId = null) {
    const data = {
      sender: 'AI',
      type: 'fact_confirmation',
      key: fact.key,
      value: fact.value,
      message: fact.message
    };

    if (userId) {
      this.sendToUser(userId, data);
    } else {
      this.broadcast(data);
    }
  }

  /**
   * Broadcast fact saved notification
   * @param {Object} fact - Fact object with key and value
   * @param {string} userId - Optional specific user ID
   */
  broadcastFactSaved(fact, userId = null) {
    const data = {
      sender: 'AI',
      type: 'fact_saved',
      key: fact.key,
      value: fact.value
    };

    if (userId) {
      this.sendToUser(userId, data);
    } else {
      this.broadcast(data);
    }
  }

  /**
   * Start proactive thoughts system
   */
  startProactiveThoughts() {
    if (this.proactiveInterval) return;

    console.log('Proactive thoughts started.');
    
    // Set up check-in after configured time of no response
    this.proactiveInterval = setTimeout(() => {
      if (this.conversationState.waitingForResponse && !this.conversationState.checkInSent) {
        this.sendCheckIn();
      }
    }, this.proactiveCheckinMs);
  }

  /**
   * Stop proactive thoughts system
   */
  stopProactiveThoughts() {
    if (this.proactiveInterval) {
      clearTimeout(this.proactiveInterval);
      this.proactiveInterval = null;
      console.log('Proactive thoughts stopped.');
    }
  }

  /**
   * Send check-in message
   */
  sendCheckIn() {
    console.log('Sending check-in message');
    
    const checkInMessage = "Are you still there? No worries if you're busy - I'll wait quietly until you're ready to chat.";
    
    this.broadcast({
      sender: 'AI',
      type: 'proactive_message',
      message: checkInMessage
    });
    
    this.conversationState.checkInSent = true;
    
    // Wait another configured time, then go quiet
    setTimeout(() => {
      if (this.conversationState.waitingForResponse) {
        console.log('Going quiet - user appears to be away');
        const quietMessage = "I'll wait here quietly. Just say hello when you're ready to chat again! 😊";
        
        this.broadcast({
          sender: 'AI',
          type: 'proactive_message',
          message: quietMessage
        });
        
        this.stopProactiveThoughts();
      }
    }, this.proactiveQuietMs);
  }

  /**
   * Reset idle timeout
   */
  resetIdleTimeout() {
    // Reset conversation state - user is active
    this.conversationState.waitingForResponse = false;
    this.conversationState.checkInSent = false;
    
    this.stopProactiveThoughts();
    
    if (this.idleTimeout) {
      clearTimeout(this.idleTimeout);
    }
    
    this.idleTimeout = setTimeout(() => {
      console.log('User idle for configured time, starting gentle proactive engagement.');
      this.startProactiveThoughts();
    }, this.idleTimeoutMs);
  }

  /**
   * Setup connection health check
   */
  setupHealthCheck() {
    const interval = setInterval(() => {
      this.wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
          console.log('Terminating dead connection');
          return ws.terminate();
        }
        
        ws.isAlive = false;
        ws.ping();
      });
    }, 30000); // Check every 30 seconds

    this.wss.on('close', () => {
      clearInterval(interval);
    });
  }

  /**
   * Get connection statistics
   * @returns {Object} - Connection statistics
   */
  getStats() {
    return {
      totalConnections: this.wss.clients.size,
      authenticatedUsers: this.userSockets.size,
      conversationState: this.conversationState,
      proactiveActive: !!this.proactiveInterval
    };
  }

  /**
   * Get connected users
   * @returns {Array<string>} - Array of connected user IDs
   */
  getConnectedUsers() {
    return Array.from(this.userSockets.keys());
  }

  /**
   * Check if user is connected
   * @param {string} userId - User ID to check
   * @returns {boolean} - True if user is connected
   */
  isUserConnected(userId) {
    return this.userSockets.has(userId);
  }

  /**
   * Disconnect user
   * @param {string} userId - User ID to disconnect
   */
  disconnectUser(userId) {
    const ws = this.userSockets.get(userId);
    if (ws) {
      ws.close();
      this.userSockets.delete(userId);
      return true;
    }
    return false;
  }

  /**
   * Cleanup resources
   */
  cleanup() {
    this.stopProactiveThoughts();
    
    if (this.idleTimeout) {
      clearTimeout(this.idleTimeout);
    }
    
    if (this.wss) {
      this.wss.close();
    }
  }
}

module.exports = new WebSocketService();