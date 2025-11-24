# AURA.ai Chatbot - A Thinking Chatbot

AURA.ai Chatbot is a proactive chatbot that simulates human-like thinking by generating thoughts, maintaining memory, and evolving personality. Unlike traditional chatbots that only respond to user inputs, AURA.ai Chatbot can initiate conversations with dynamically generated thoughts based on previous interactions and current events.

This project demonstrates a hybrid push/pull chat system with news-aware AI personality and emotional state tracking.

## Architecture

AURA.ai Chatbot uses a sophisticated architecture with external data integration:

1.  **Frontend (HTML/JS)**: A single-page chat interface that communicates with the backend. It uses WebSockets to receive proactive messages from the AI and standard HTTP requests (Fetch) to send user messages.
2.  **Backend (Node.js)**: An Express.js server that runs the main chat logic. It features a WebSocket server for pushing messages to the client and an API endpoint (`/api/chat`) for handling user responses.
3.  **Remote AI Models**: The system uses a remote, OpenAI-compatible endpoint (like Ollama) for both language model inference and text embeddings.
4.  **Vector Database (QDRANT)**: Stores conversation history and news context with semantic search capabilities for intelligent context retrieval.
5.  **News Processing**: Automated RSS feed processing with emotional analysis and mood tracking.

## Key Additions (recent)
- Definition-driven structured fact extraction (`webhook-api/fact_definitions.js`).
- Embedding-backed semantic matcher (`webhook-api/embeddingMatcher.js`) to handle paraphrases and improve recall.
- Inline, non-modal confirmation flow for mid-confidence facts (WebSocket-driven) and a `POST /api/profile/confirm-fact` endpoint to accept/reject facts.
- In-chat Profile UI to view and remove stored facts (`/api/profile/remove-fact`).
- WebSocket auth binding so server can target messages to specific users (client sends `{ type: 'auth', userId, token }` on WS connect).

## Components

- **PHP Frontend Server**: An Apache server running in Docker to serve the `index.html` file.
- **Node.js Backend**: The core of the application, handling chat logic, memory, WebSocket communication, and news processing.
- **QDRANT Vector Database**: Provides semantic search and context storage. The `docker-compose.yml` in this repo comments out the Qdrant service by default; configure `QDRANT_URL` to point to your instance if you run it remotely.
- **LLM & Embeddings**: Expects OpenAI-compatible endpoints (configure `LLM_URL` and `EMBEDDING_URL`). The server calls `v1/chat/completions` and `v1/embeddings` paths — compatible gateways include Ollama, OpenRouter, or other OpenAI-style APIs.

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

### 🔄 Phase 3: Personality & Evolution [In Progress]
- Profile store persists user interests, sentiment averages, trust level, and conversation topics
- Structured fact extraction and discovery questions (definition-driven)
- Embedding-backed semantic matching for paraphrase handling
- Inline confirmation flow and a small profile UI for reviewing/removing facts

## Getting Started

### Prerequisites

- Docker and Docker Compose
- A running OpenAI-compatible LLM endpoint (set `LLM_URL`)
- An embeddings endpoint (set `EMBEDDING_URL`)
- A QDRANT server reachable at the `QDRANT_URL` you configure (optional)

### Environment variables (notable)
- `LLM_URL` - Base URL for LLM completion calls
- `EMBEDDING_URL` - Base URL for embedding calls (required for embedding-backed matcher in production)
- `QDRANT_URL` - Qdrant endpoint (optional)
- `PORT` - Server port
- `DEV_MOCK` - If `true` returns canned embeddings/responses for local testing
- `PARAPHRASE_QUESTIONS` - If `true` LLM paraphrases discovery templates before asking
- `ASK_COOLDOWN_MS` - Milliseconds to wait before re-asking the same fact (default 7 days)
- `EMBED_AUTO_SAVE_SIM` - Embedding similarity threshold to auto-save (default 0.90)
- `EMBED_CONFIRM_SIM` - Embedding similarity threshold to prompt for confirmation (default 0.78)

### Installation

1.  **Clone this repository:**
    ```bash
    git clone https://github.com/username/AURAaichatbot.git
    cd AURAaichatbot
    cd webhook-api && npm install
    ```

2.  **Configure Remote Services (production):**
    Set `LLM_URL`, `EMBEDDING_URL`, and `QDRANT_URL` in `.env` or in your environment.

3.  **Start services:**
    ```bash
    docker compose up -d --build webhook-api
    # or locally for development:
    PORT=4002 node webhook-api/server.js
    ```

4.  **Open the chat UI:** `https://aura.happymonkey.ai/chat` (or `http://localhost:4002/chat`)

## WebSocket message types (server → client)
- `proactive_message` — general proactive thought
- `discovery_question` — structured discovery question `{ key, message }`
- `fact_confirmation` — server suggests a value and asks for confirmation `{ key, value, message }`
- `fact_saved` — informs client a fact was auto-saved `{ key, value }`

Client should send an initial WS auth frame on connect: `{ type: 'auth', userId, token }` so server can target messages to that user.

## API Endpoints (high-level)
- `/api/chat` (POST) — Main conversational endpoint
- `/api/profile/confirm-fact` (POST) — Confirm/reject a candidate fact
- `/api/profile/remove-fact` (POST) — Remove a stored fact (auth required)
- `/api/users/:userId/profile` (GET) — Inspect persisted profile data
- Other admin endpoints for dev-mock, news processing, dashboard, etc.

## UX notes
- The inline confirmation flow is intentionally lightweight and non-modal. Mid-confidence suggestions are shown as a small inline prompt with `Yes/No/Edit` buttons, keeping the chat natural while giving users control.
- Sensitive facts (e.g., `birthday`) are tagged as high-sensitivity in the definitions; configure the system to require explicit consent before persisting such items in production.

## Development & Testing
- Unit-test `extractStructuredFacts` with many phrasing variations.
- Integration-test confirmation and embedding flows (requires `EMBEDDING_URL`).
- Monitor acceptance/rejection metrics to tune thresholds.

## Project Structure

```
AURAaichatbot/
├── index.html                 # Frontend chat interface
├── webhook-api/               # Node.js backend
│   ├── server.js              # Main API and WebSocket server
│   ├── embeddingMatcher.js    # Embedding-backed semantic matcher
│   ├── fact_definitions.js    # Structured fact definitions and examples
│   ├── news-processor.js      # News analysis and mood system
│   ├── news-data.json         # Mood state persistence
│   ├── profile.json           # Profile store (persisted)
│   └── package.json
├── docker-compose.yml         # Docker services configuration
└── README.md
```

## Next steps
- Add telemetry to track confirm/auto-save rates
- Admin UI for tuning thresholds and fact priorities
- Privacy consent flows for high-sensitivity facts

---

If you'd like, I can update the README with deployment examples for popular embedding providers or add a short troubleshooting section for common errors (embedding failures, WebSocket bind issues).