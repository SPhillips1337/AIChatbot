# PHPaibot Development Plan

## Project Vision
Create a proactive PHP chatbot that simulates human-like thinking by:
1. Generating "random thoughts" based on previous conversations, current events, and general knowledge
2. Maintaining memory of past interactions
3. Developing a personality that evolves based on user interactions
4. Initiating conversations rather than just responding

## Architecture Overview (Current Implementation)

The proof-of-concept has matured into a production-style hybrid push/pull chat system with persistent memory and Phase‑3 personality features.

- **Frontend (HTML/JS)**: A single-page chat interface served directly from the webhook API at `/chat`. It prompts users for a display name, stores a device-bound ID in `localStorage`, and uses WebSockets for proactive thoughts plus HTTP (Fetch) for user messages so UI and API share the same origin.
- **Backend (Node.js)**: The Express.js webhook API (`webhook-api/server.js`) manages chat logic, proactive engagement timers, admin APIs, the dashboard data feed, and WebSocket push delivery.
- **Remote AI Models**: The server calls OpenAI-compatible endpoints for `/v1/chat/completions` and `/v1/embeddings` (e.g., Ollama, OpenRouter). A `DEV_MOCK` flag or `/api/admin/dev-mock` toggles canned responses for local testing.
- **Memory (Qdrant Vector DB)**: Conversations, news context, and thoughts are stored in Qdrant (`@qdrant/js-client-rest`). Embeddings come from the remote endpoint; dev-mock returns deterministic vectors for development.
- **News Processor & Mood System**: `webhook-api/news-processor.js` ingests RSS feeds, scores sentiment, updates `news-data.json`, and stores embeddings, providing inputs to proactive thoughts and the dashboard.
- **Profile & Personality Store**: `webhook-api/profileStore.js` persists user/bot traits and structured personal facts (name, favorites, attributes) to `profile.json`; the in-memory `personalitySystem` tracks evolving opinions exposed via `/api/opinions`.

## Phased Development Plan

### Phase 1: PoC & Core Conversational Loop [Completed]
- **Goal**: Create a working chatbot with a proactive push-based interface and contextual memory.
- **Achievements**:
    - Implemented a WebSocket push-based frontend (`index.html`) and a Node.js backend (`webhook-api/server.js`).
    - Externalized AI models to a remote Ollama endpoint, removing all local AI/ML Docker services.
    - Integrated the Qdrant vector database for semantic memory (with dev-mock embeddings for local runs).
    - Implemented a robust conversational memory system that provides context to the AI.
    - Created an idle timer system to manage when the AI sends proactive thoughts, making the interaction more natural.

### Phase 2: The Thinker [Completed]
- **Goal**: Create a chatbot that can initiate conversations with unique, dynamically generated thoughts.
- **Implementation & Notes**:
    - The Node.js backend (`webhook-api/server.js`) implements dynamic LLM-based proactive thought generation and integrates `webhook-api/news-processor.js` for news-aware thoughts.
    - News processing and mood tracking are implemented and persisted to `webhook-api/news-data.json`.
    - The system uses a vector database (Qdrant) for semantic storage; configure `QDRANT_URL` to point to your instance or adapt the code to a JSON fallback for lightweight testing.
- **Status**: Completed

### Phase 3: Personality & Evolution
- **Goal**: Create a chatbot that adapts over time and develops a unique personality.
- **Status Snapshot**:
    - Profile store (`profileStore.js` + `/api/users`) persists sentiment, trust, topics, and structured facts tied to stable device/user IDs. **Implemented**
    - Personality system tracks evolving opinions exposed via `/api/opinions` and updated by `/api/feedback`. **In Progress**
    - Thought generation consults profiles + news (see `updateUserProfile` + `newsProcessor.generateNewsInfluencedThought`). **In Progress**
    - Admin/dashboard endpoints (`/api/dashboard`, `/api/admin/*`, `/admin`) provide operational visibility and controls. **Implemented**
    - Unified UI origin (`/chat` served by the webhook API). **Implemented**
    - Structured fact memory extraction (name, favorites, attributes) feeds prompts and direct answers. **In Progress**
    - Lightweight identity prompt + device-bound IDs ensure the same persona persists across sessions. **Implemented**

## Next Steps
- Short-term:
    - Finish feedback loop wiring so user feedback updates the personality/opinions system persistently.
    - Harden admin endpoints (add authentication) before exposing toggles in production.
    - Point `LLM_URL` and `EMBEDDING_URL` at a production-capable gateway and verify end-to-end behavior; then disable dev-mock.
- Medium-term:
    - Expand structured fact extraction patterns (relationships, projects, multi-user preferences) and add confirmation prompts for low-confidence data.
    - Implement long-term relationship memory and opinion consolidation from news + user interactions.
    - Add automated tests and monitoring for news processing and persistence.
    - Layer proper authentication or multi-user account management on top of the current lightweight identity flow.

Notes:
- You can toggle dev-mock at runtime via `POST /api/admin/dev-mock` (JSON `{ "enabled": true|false }`).
- For local testing, start the webhook API with `PORT=4002` (or your preferred port) and open the chat at `http://localhost:4002/chat` (served by the Node app) or use `index.html?api_base=http://localhost:4002` if you prefer the PHP container.
