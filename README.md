# AURA.ai Chatbot - A Thinking Chatbot

AURA.ai Chatbot is a proactive chatbot that simulates human-like thinking by generating thoughts, maintaining memory, and evolving personality. Unlike traditional chatbots that only respond to user inputs, AURA.ai Chatbot can initiate conversations with dynamically generated thoughts based on previous interactions and current events.

This project demonstrates a hybrid push/pull chat system with news-aware AI personality and emotional state tracking.

A demo is currently available at https://aura.happymonkey.ai/ though it is in a beta state and subject to change. Please be aware that it is currently in active development, which means you may encounter bugs, and features may change. Your data may be wiped during updates.

## Architecture

AURA.ai Chatbot uses a sophisticated architecture with external data integration:

1.  **Frontend (HTML/JS)**: A single-page chat interface that communicates with the backend. It uses WebSockets to receive proactive messages from the AI and standard HTTP requests (Fetch) to send user messages.
2.  **Backend (Node.js)**: An Express.js server that runs the main chat logic. It features a WebSocket server for pushing messages to the client and an API endpoint (`/api/chat`) for handling user responses.
3.  **Remote AI Models**: The system uses a remote, OpenAI-compatible endpoint (like Ollama) for both language model inference and text embeddings.
4.  **Vector Database (QDRANT)**: Stores conversation history and news context with semantic search capabilities for intelligent context retrieval.
5.  **News Processing**: Automated RSS feed processing with emotional analysis and mood tracking.
6. **External Input System**: Integrated multiple data sources (RSS, Twitter Trends, Google Trends) and deep research via Perplexica/SearxNG to enrich AI awareness. The system fetches, deduplicates, researches, analyzes mood, and stores enriched items in Qdrant for proactive use.
## External Input System

The new External Input System replaces the old NewsProcessor and provides a unified pipeline for ingesting diverse external data:

- **Sources**: RSS feeds, Twitter trending topics, Google Trends daily searches.
- **Research Augmentation**: For short or ambiguous items, the system queries a local Perplexica or SearxNG instance to obtain a concise summary.
- **Analysis**: Each item is sent to the LLM to assess emotional impact (mood score) and extract key topics.
- **Storage**: Results are embedded and up‑serted into Qdrant with rich metadata (`source`, `title`, `url`, `mood`, `topics`, `reaction`).
- **Proactive Thoughts**: The AI can now generate thoughts based on a broader set of current events, not just RSS news.

### Configuration
Add the following environment variables to your `.env`:

```
PERPLEXICA_URL=http://localhost:3000/api/search
SEARXNG_URL=http://localhost:8080
TWITTER_API_KEY=your_key
TWITTER_API_SECRET=your_secret
TWITTER_ACCESS_TOKEN=your_token
TWITTER_ACCESS_SECRET=your_access_secret
GOOGLE_TRENDS_API_KEY=your_key   # optional if using paid API
```

### Usage
The existing `/api/process-news` endpoint now triggers `externalInput.processAll()`, which runs the full pipeline. You can also call it manually via GET for testing.

The system runs automatically on startup and every 30 minutes thereafter.

## Key Additions (recent)

- **AI Persona System**: Choose from 5 distinct AI personalities (AURA, Sunny, Logic, Muse, Sage) with unique speaking styles and traits. Access via 🎭 Persona menu.
- Definition-driven structured fact extraction (`webhook-api/fact_definitions.js`).
- Embedding-backed semantic matcher (`webhook-api/embeddingMatcher.js`) to handle paraphrases and improve recall.
- Inline, non-modal confirmation flow for mid-confidence facts (WebSocket-driven) and a `POST /api/profile/confirm-fact` endpoint to accept/reject facts.
- In-chat Profile UI to view and remove stored facts (`/api/profile/remove-fact`).
- WebSocket auth binding so server can target messages to specific users (client sends `{ type: 'auth', userId, token }` on WS connect).
- Telemetry collection for fact autosave/suggestion/confirm/reject/delete events and a secure admin telemetry endpoint `/api/admin/telemetry` plus a small telemetry UI on the admin dashboard.
- Improved WebSocket client resilience: automatic reconnect with exponential backoff and keepalive pings to survive reverse proxies (updated `index.html`).
- News processing reliability improvements: news selection is now sorted by `payload.timestamp` and the processor logs the news items chosen for LLM prompts (`webhook-api/news-processor.js`).
- Minor bugfixes and logging improvements to help diagnose disconnects and news freshness issues.
- Per-user idle/proactive timers (prevent repeated global greetings) and deferred greeting logic to avoid duplicate welcomes on reconnect.
- Undelivered thought storage and delivery on user auth (server stores proactive messages when users are offline and delivers them after they authenticate).
- Debug endpoint: `GET /api/debug/states` (admin-only) to inspect in-memory user states and timers for troubleshooting.
- **Relationship tracking system** in JSON profiles for user connections and shared interests.
- **Production hardening**: Rate limiting, memory leak prevention, service health monitoring, and configuration validation.
- **Improved chat logic**: Fixed intrusive mood/news injection to be more contextual and natural.
- **Robust JSON parsing**: Better error handling for malformed LLM responses in news processing.
- **Vector embedding fixes**: Dynamic vector size detection and client-side filtering to resolve Qdrant Bad Request errors.
- **Neo4j GraphStore integration**: Optional graph database support with hybrid JSON/Neo4j storage and graceful fallback.
- **GDPR compliance**: Basic privacy compliance with consent banner, privacy policy, and data export/deletion endpoints.
- **Deep Agents**: Sandboxed code execution environment (`opencode`) controlled via SSH for performing complex tasks (e.g., calculation, file manipulation) triggered by `/agent` or `/deep` commands.

## API Changes (2025-12-11) — Security hardening

Security hardening: the following endpoints are now admin-only (intentional)
POST /api/trigger-thought — External automation that previously posted here (e.g., n8n) must now authenticate as an admin/service account (headers: X-User-Id and X-Auth-Token).
GET /api/thoughts/:userId — Legacy polling endpoint moved to admin-only. Migrate clients to WebSocket delivery or use admin credentials for tooling.
GET /api/users — Listing all user profiles is now admin-only for privacy. Use admin credentials for authorized tooling.
Restored self-service functionality for user-scoped endpoints:
GET /api/users/:userId/profile — accessible to the user themselves or admins.
GET /api/users/:userId/relationships — accessible to the user themselves or admins.
Implementation notes & migration guidance:
Integrators must include admin/service credentials in requests using the headers 'X-User-Id' and 'X-Auth-Token'. Create a dedicated service account via the API and add its userId to the ADMIN_USER_IDS environment variable or assign the admin role via the admin API.
Legacy workflows using polling for thoughts should migrate to the WebSocket-based delivery mechanism to avoid needing admin credentials.
GraphStore deletion is not implemented; admins should be aware GDPR deletion may not remove graph data until GraphStore exposes a delete API.
Bug fixes and reliability:
Profile and account stores refactored to async file I/O and server initialization now awaits asynchronous startup tasks to avoid race conditions.
requireAuth middleware improved with error handling.

## AI Persona System

AURA.ai now features 5 distinct AI personalities that users can switch between:

- **AURA** (default): Balanced, thoughtful, and curious - speaks in a measured way
- **Sunny**: Incredibly upbeat and optimistic - uses lots of exclamation points and positive language like "That's amazing!"
- **Logic**: Precise and analytical - mentions statistics, probabilities, and systematic frameworks
- **Muse**: Wildly creative and imaginative - uses metaphors, artistic references, and poetic language
- **Sage**: Ancient and wise - references wisdom from different cultures and asks profound questions

### Usage
- Access via the 🎭 Persona menu item
- Personas affect all AI responses (chat, proactive thoughts, discovery questions)
- Selection is saved to user profile and persists across sessions
- Each persona has distinct speaking styles and personality traits

### API Endpoints
- `GET /api/personas` - List all available personas
- `POST /api/personas/set` - Set user's selected persona (requires auth)

## Components

- **PHP Frontend Server**: An Apache server running in Docker to serve the `index.html` file.
- **Node.js Backend**: The core of the application, handling chat logic, memory, WebSocket communication, and news processing.
- **QDRANT Vector Database**: Provides semantic search and context storage. Configure `QDRANT_URL` and `QDRANT_API_KEY` to point to your Qdrant cloud instance or local server.
- **LLM & Embeddings**: Expects OpenAI-compatible endpoints (configure `LLM_URL` and `EMBEDDING_URL`). The server calls `v1/chat/completions` and `v1/embeddings` paths — compatible gateways include Ollama, OpenRouter, or other OpenAI-style APIs.
- **Code Sandbox (Opencode)**: A secure PHP/Apache container with SSH access, allowing the AI to execute code safely. Located in `opencode/`.

## Features

### ✅ Phase 1: Core Conversational Loop [Completed]
- WebSocket push-based frontend and Node.js backend
- QDRANT vector database integration
- Conversational memory with semantic context retrieval
- Idle timer for proactive engagement

### ✅ Phase 2: The Thinker [Completed]
- Dynamic LLM-powered proactive thoughts
- News-aware personality with RSS integration
- Emotional state tracking and mood system

### ✅ Phase 3: Personality & Evolution [Completed]
- Profile store persists user interests, sentiment averages, trust level, and conversation topics
- Structured fact extraction and discovery questions (definition-driven)
- Embedding-backed semantic matching for paraphrase handling
- Inline confirmation flow and a small profile UI for reviewing/removing facts
- Telemetry collection and admin telemetry UI for tuning and analysis
- Relationship tracking system for user connections
- Production-ready hardening and error handling

## Getting Started

### Prerequisites

- Docker and Docker Compose
- A running OpenAI-compatible LLM endpoint (set `LLM_URL`)
- An embeddings endpoint (set `EMBEDDING_URL`)
- A QDRANT server - either local or cloud instance (set `QDRANT_URL` and `QDRANT_API_KEY`)

### Environment variables (complete list)

#### Core Configuration
- `LLM_URL` - Base URL for LLM completion calls (e.g., http://localhost:8080)
- `LLM_MODEL` - Model name for LLM requests (default: qwen2.5:7b-instruct-q4_K_M)
- `EMBEDDING_URL` - Base URL for embedding calls (required for embedding-backed matcher)
- `EMBEDDING_MODEL` - Model name for embedding requests (default: bge-m3:latest)
- `QDRANT_URL` - Qdrant endpoint (local: http://localhost:6333 or cloud: https://your-cluster.region.aws.cloud.qdrant.io)
- `QDRANT_API_KEY` - API key for Qdrant cloud instances (not needed for local)
- `PORT` - Server port (default: 3000)
- `DEV_MOCK` - If `true` returns canned embeddings/responses for local testing

#### Security & Admin
- `ADMIN_USER_IDS` - Comma-separated list of user IDs with admin privileges
- `OPENCODE_PASSWORD` - Required password for Deep Agent SSH access

#### Deep Agent / Code Sandbox
- `OPENCODE_HOST` - SSH host for code sandbox (default: host.docker.internal)
- `OPENCODE_PORT` - SSH port for code sandbox (default: 2222)
- `OPENCODE_USER` - SSH username for code sandbox (default: opencodeuser)
- `OPENCODE_PASSWORD` - SSH password for code sandbox (required for security)

#### Graph Database (Optional)
- `NEO4J_URI` - Neo4j database URI (optional, e.g., bolt://localhost:7687)
- `NEO4J_USER` - Neo4j username (optional)
- `NEO4J_PASSWORD` - Neo4j password (optional)

#### Timing Configuration (milliseconds)
- `IDLE_TIMEOUT_MS` - User inactivity before proactive thoughts (default: 600000 = 10 min)
- `PROACTIVE_CHECKIN_MS` - Time after initial thought to check-in (default: 300000 = 5 min)
- `PROACTIVE_QUIET_MS` - Time after check-in before going quiet (default: 120000 = 2 min)

#### Fact Extraction & Learning
- `PARAPHRASE_QUESTIONS` - If `true` LLM paraphrases discovery templates before asking
- `ASK_COOLDOWN_MS` - Milliseconds to wait before re-asking the same fact (default: 604800000 = 7 days)
- `EMBED_AUTO_SAVE_SIM` - Embedding similarity threshold to auto-save (default: 0.90)
- `EMBED_CONFIRM_SIM` - Embedding similarity threshold to prompt for confirmation (default: 0.78)
- `EMBED_SIMILARITY_THRESHOLD` - General embedding similarity threshold (default: 0.78)

#### External Input System
- `TWITTER_API_KEY` - Twitter API key (optional)
- `TWITTER_API_SECRET` - Twitter API secret (optional)
- `TWITTER_ACCESS_TOKEN` - Twitter access token (optional)
- `TWITTER_ACCESS_SECRET` - Twitter access secret (optional)
- `X_CLIENT_ID` - X/Twitter OAuth2 client ID (optional)
- `X_CLIENT_SECRET` - X/Twitter OAuth2 client secret (optional)
- `X_REDIRECT_URI` - OAuth2 redirect URI (default: http://localhost)
- `PERPLEXICA_URL` - Perplexica search API URL (optional, e.g., http://localhost:3000/api/search)
- `SEARXNG_URL` - SearxNG search engine URL (optional, e.g., http://localhost:8080)

### Installation

1.  **Clone this repository:**
    ```bash
    git clone https://github.com/SPhillips1337/AIChatbot.git
    cd AIChatbot
    cd webhook-api && npm install
    ```

2.  **Configure Environment:**
    ```bash
    # Copy example files and update with your values
    cp .env.example .env
    cp webhook-api/.env.example webhook-api/.env
    # Edit .env files with your LLM, embedding, and Qdrant credentials
    ```

3.  **Configure Remote Services:**
    Set `LLM_URL`, `EMBEDDING_URL`, `QDRANT_URL`, and `QDRANT_API_KEY` in your `.env` files.

4.  **Start services:**
    ```bash
    # Start the services
    docker compose up -d --build webhook-api

    # Restart the container
    docker compose restart webhook-api

    # or locally for development:
    PORT=4002 node webhook-api/server.js

    # Start Deep Agent Sandbox (in a separate terminal)
    cd opencode
    docker compose up -d --build
    cd ..
    ```


5.  **Open the chat UI:** `https://localhost/chat` (or `http://localhost:4002/chat`)

## Production Features
- **Rate Limiting**: 30 requests per minute per user on chat endpoint
- **Memory Management**: Automatic cleanup of stale WebSocket connections
- **Service Health Monitoring**: Graceful fallback to dev-mock when external services fail
- **Configuration Validation**: Startup validation of critical environment variables
- **Robust Error Handling**: JSON parsing with fallbacks for malformed LLM responses

## Relationship System
- Track user connections and shared interests in JSON profiles
- API endpoint: `GET /api/users/:userId/relationships`
- Find users with similar facts and conversation topics
- Extensible for future graph database migration

## Telemetry
- Telemetry events are recorded in `webhook-api/telemetry.json` and include events such as `fact_autosave`, `fact_suggested`, `fact_confirmed`, `fact_rejected`, and `fact_deleted`.
- Admins can fetch recent events via the secure endpoint `GET /api/admin/telemetry?limit=N` (admin auth required).
- The dashboard includes a small telemetry UI to inspect recent events and filter by type.

## WebSocket message types (server → client)
- `proactive_message` — general proactive thought
- `discovery_question` — structured discovery question `{ key, message }`
- `fact_confirmation` — server suggests a value and asks for confirmation `{ key, value, message }`
- `fact_saved` — informs client a fact was auto-saved `{ key, value }`

Client should send an initial WS auth frame on connect: `{ type: 'auth', userId, token }` so server can target messages to that user.

## Deep Agents (Beta)
The system now supports "Deep Agents" — a capability to execute code in a sandboxed environment.
- **Trigger**: Start your message with `/agent` or `/deep` followed by your request.
  - Example: `/agent List all files in the current web directory`
  - Example: `/deep Calculate the 100th Fibonacci number using Python`
- **Architecture**: The main `webhook-api` connects to the `opencode` container via SSH (port 2222) to execute tasks.

- `/api/chat` (POST) — Main conversational endpoint (rate limited)
- `/api/profile/confirm-fact` (POST) — Confirm/reject a candidate fact
- `/api/profile/remove-fact` (POST) — Remove a stored fact (auth required)
- `/api/users/:userId/relationships` (GET) — Get user relationships and shared interests
- `/api/admin/telemetry` (GET) — Fetch recent telemetry events (admin only)
- `/api/users/:userId/profile` (GET) — Inspect persisted profile data
- Other admin endpoints for dev-mock, news processing, dashboard, etc.

## UX notes
- The inline confirmation flow is intentionally lightweight and non-modal. Mid-confidence suggestions are shown as a small inline prompt with `Yes/No/Edit` buttons, keeping the chat natural while giving users control.
- Sensitive facts (e.g., `birthday`) are tagged as high-sensitivity in the definitions; configure the system to require explicit consent before persisting such items in production.
- Mood and news injection is now contextual - only triggers on direct questions about feelings or current events, not casual mentions.

## Development & Testing
- Unit-test `extractStructuredFacts` with many phrasing variations.
- Integration-test confirmation and embedding flows (requires `EMBEDDING_URL`).
- Monitor acceptance/rejection metrics to tune thresholds.
- Use `DEV_MOCK=true` for local testing without external services.

## Project Structure

```
AIChatbot/
├── index.html                 # Frontend chat interface with GDPR consent
├── privacy-policy.html        # GDPR privacy policy
├── webhook-api/               # Node.js backend
│   ├── server.js              # Main API and WebSocket server
│   ├── personas.js            # AI persona definitions and management
│   ├── embeddingMatcher.js    # Embedding-backed semantic matcher
│   ├── fact_definitions.js    # Structured fact definitions and examples
│   ├── graphStore.js          # Neo4j graph database integration (optional)
│   ├── news-processor.js      # News analysis and mood system
│   ├── news-data.json         # Mood state persistence
│   ├── profile.json           # Profile store (persisted)
│   ├── telemetry.json         # Recent telemetry events (persisted)
│   ├── rateLimiter.js         # Rate limiting middleware
│   ├── healthChecker.js       # Service health monitoring
│   └── package.json
├── docker-compose.yml         # Docker services configuration
└── README.md
```

## GDPR Compliance

The system includes basic GDPR compliance features:

- **Consent Banner**: Users must accept data collection before using the chatbot
- **Privacy Policy**: Transparent disclosure of data collection and processing
- **Data Export**: Users can download all their data via `/api/gdpr/export`
- **Data Deletion**: Users can delete all their data via `/api/gdpr/delete-all`
- **Profile Management**: Users can view and remove individual facts

**Note**: This is minimal compliance. For production use, consider:
- Legal review of privacy policy
- Cookie management for non-essential cookies
- Data retention policies
- Audit logging for data access/changes
- Enhanced consent management

## Next steps
- Aggregate telemetry and provide per-fact metrics
- Admin UI for tuning thresholds and fact priorities
- Privacy consent flows for high-sensitivity facts
- Consider Neo4j migration for advanced relationship queries

---

The system is now production-ready with comprehensive error handling, rate limiting, and relationship tracking capabilities.