# AURA.ai Chatbot - Migration Guide

## Overview
This guide helps you migrate from the original monolithic server to the new modular architecture. The refactored system maintains full backward compatibility while providing improved maintainability, security, and performance.

## What Changed

### File Structure Changes
```
Before:
webhook-api/
├── server.js (1800+ lines)
├── embeddingMatcher.js
├── news-processor.js
├── profileStore.js
├── accountStore.js
└── package.json

After:
webhook-api/
├── server.js (250 lines, refactored)
├── server-original.js (backup)
├── config.js (NEW)
├── telemetryStore.js (NEW)
├── middleware/ (NEW)
│   ├── auth.js
│   ├── validation.js
│   └── errorHandler.js
├── services/ (NEW)
│   ├── database.js
│   ├── embedding.js
│   ├── llm.js
│   └── websocket.js
├── routes/ (NEW)
│   ├── auth.js
│   ├── chat.js
│   ├── admin.js
│   └── profile.js
├── embeddingMatcher.js (unchanged)
├── news-processor.js (unchanged)
├── profileStore.js (unchanged)
├── accountStore.js (unchanged)
└── package.json (updated)
```

## Migration Steps

### Step 1: Backup Current Installation
```bash
# Create backup of current system
cp -r webhook-api webhook-api-backup
```

### Step 2: Update Dependencies
```bash
cd webhook-api
npm install
```

### Step 3: Environment Variables
The new system uses the same environment variables but with better validation:

```bash
# Required for production
LLM_URL=http://your-llm-server:8080
EMBEDDING_URL=http://your-embedding-server:8081
QDRANT_URL=http://your-qdrant-server:6333

# Optional configuration
PORT=3000
NODE_ENV=production
DEBUG=false
DEV_MOCK=false

# AI behavior settings
PARAPHRASE_QUESTIONS=true
ASK_COOLDOWN_MS=604800000
EMBED_AUTO_SAVE_SIM=0.90
EMBED_CONFIRM_SIM=0.78

# Timing configuration
IDLE_TIMEOUT_MS=600000
PROACTIVE_CHECKIN_MS=300000
PROACTIVE_QUIET_MS=120000

# Admin users (comma-separated)
ADMIN_USER_IDS=your-admin-user-id-1,your-admin-user-id-2
```

### Step 4: Start the New Server
```bash
# For production
npm start

# For development with mock services
npm run dev
```

### Step 5: Verify Migration
```bash
# Check health endpoint
curl http://localhost:3000/health

# Check admin dashboard (requires authentication)
curl -H "x-user-id: your-admin-id" -H "x-auth-token: your-token" \
     http://localhost:3000/api/admin/health
```

## API Changes

### New Endpoints
All existing endpoints are preserved. New endpoints added:

#### Authentication
- `POST /api/auth/register` - User registration
- `POST /api/auth/login` - User login
- `POST /api/auth/refresh` - Token refresh
- `POST /api/auth/logout` - User logout
- `GET /api/auth/me` - Current user info

#### Enhanced Chat
- `GET /api/chat/history` - Chat history retrieval
- `POST /api/chat/trigger-thought` - Admin thought triggering

#### Profile Management
- `GET /api/profile/:userId` - Get user profile
- `PUT /api/profile/:userId` - Update user profile
- `POST /api/profile/confirm-fact` - Confirm extracted facts
- `POST /api/profile/remove-fact` - Remove stored facts
- `GET /api/profile/:userId/facts` - Get user facts

#### Admin Operations
- `GET /api/admin/dashboard` - Enhanced dashboard data
- `GET /api/admin/health` - System health check
- `POST /api/admin/process-news` - Manual news processing
- `POST /api/admin/reset-mood` - Reset mood state
- `POST /api/admin/clear-news` - Clear news entries
- `DELETE /api/admin/news/bulk` - Bulk delete news
- `GET /api/admin/telemetry` - Telemetry data
- `GET /api/admin/websocket/stats` - WebSocket statistics
- `POST /api/admin/broadcast` - Broadcast messages

### Enhanced Error Responses
All endpoints now return structured error responses:

```json
{
  "error": "Human readable error message",
  "code": "MACHINE_READABLE_CODE",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "requestId": "unique-request-id"
}
```

### Rate Limiting
All endpoints now have rate limiting:
- Chat endpoints: 30 requests/minute
- Profile endpoints: 50 requests/minute
- Admin endpoints: 100 requests/minute

## WebSocket Changes

### Enhanced Authentication
WebSocket connections now support proper authentication:

```javascript
// Client-side authentication
ws.send(JSON.stringify({
  type: 'auth',
  userId: 'your-user-id',
  token: 'your-auth-token'
}));
```

### New Message Types
All existing message types are preserved. New types added:
- `auth_success` - Authentication successful
- `auth_error` - Authentication failed
- `fact_confirmation` - Fact confirmation request
- `fact_saved` - Fact auto-saved notification

## Configuration Changes

### Centralized Configuration
Configuration is now centralized in `config.js`:

```javascript
const config = require('./config');

// Get configuration values
const port = config.get('port');
const llmUrl = config.get('llmUrl');
const isDebug = config.isDebugMode();
```

### Validation
Configuration is now validated on startup with helpful error messages.

## Development Changes

### New Scripts
```bash
# Start in production mode
npm start

# Start in development mode with mocks
npm run dev

# Health check
npm run health
```

### Mock Mode
Enhanced mock mode for local development:
```bash
DEV_MOCK=true npm start
```

This provides:
- Mock LLM responses
- Mock embeddings
- No external service dependencies

## Rollback Procedure

If you need to rollback to the original system:

### Step 1: Stop New Server
```bash
# Stop the current server
pkill -f "node server.js"
```

### Step 2: Restore Original Files
```bash
# Backup new files
mv server.js server-refactored.js
mv server-original.js server.js

# Restore original package.json if needed
git checkout package.json
```

### Step 3: Restart Original Server
```bash
npm start
```

## Testing the Migration

### 1. Basic Functionality
```bash
# Test health endpoint
curl http://localhost:3000/health

# Test chat endpoint (requires user setup)
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello", "userId": "test-user"}'
```

### 2. WebSocket Connection
```javascript
const ws = new WebSocket('ws://localhost:3000');
ws.onopen = () => console.log('Connected');
ws.onmessage = (event) => console.log('Message:', event.data);
```

### 3. Admin Functions
```bash
# Test admin dashboard (requires admin auth)
curl -H "x-user-id: admin-id" -H "x-auth-token: admin-token" \
     http://localhost:3000/api/admin/dashboard
```

## Troubleshooting

### Common Issues

#### 1. Module Not Found Errors
```bash
# Ensure all dependencies are installed
npm install
```

#### 2. Configuration Errors
Check the console output for configuration validation errors and ensure all required environment variables are set.

#### 3. Database Connection Issues
```bash
# Check QDRANT connectivity
curl http://your-qdrant-server:6333/collections
```

#### 4. Service Connection Issues
Verify LLM and embedding service URLs are correct and accessible.

### Debug Mode
Enable debug mode for detailed logging:
```bash
DEBUG=true npm start
```

### Health Checks
Use the health endpoint to diagnose issues:
```bash
curl http://localhost:3000/api/admin/health
```

## Performance Considerations

### Memory Usage
The new architecture uses slightly more memory due to:
- Service initialization
- Caching systems
- Enhanced error handling

Monitor memory usage and adjust if needed.

### Startup Time
Initial startup may be slower due to:
- Service initialization
- Configuration validation
- Database connection testing

This is normal and improves reliability.

## Support

### Getting Help
1. Check the console logs for error messages
2. Use the health endpoint to diagnose service issues
3. Enable debug mode for detailed logging
4. Refer to the CODE_REVIEW_SUMMARY.md for architecture details

### Reporting Issues
When reporting issues, include:
- Console error messages
- Environment configuration (without sensitive data)
- Steps to reproduce
- Expected vs actual behavior

## Next Steps

After successful migration:
1. Set up monitoring and alerting
2. Implement automated testing
3. Configure production logging
4. Set up backup procedures
5. Plan for scaling requirements

The new architecture provides a solid foundation for future enhancements and scaling.