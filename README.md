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

## Components

- **PHP Frontend Server**: An Apache server running in Docker to serve the `index.html` file.
- **Node.js Backend**: The core of the application, handling chat logic, memory, WebSocket communication, and news processing.
- **QDRANT Vector Database**: Provides semantic search and context storage. The `docker-compose.yml` in this repo comments out the Qdrant service by default; configure `QDRANT_URL` to point to your Qdrant instance if you run it remotely.
- **LLM & Embeddings**: Expects OpenAI-compatible endpoints (configure `LLM_URL` and `EMBEDDING_URL`). The server calls `v1/chat/completions` and `v1/embeddings` paths — compatible gateways include Ollama, OpenRouter, or other OpenAI-style APIs.
- **News Integration**: Optional RSS parsing for news; you can use SearxNG or let the server fetch RSS directly (see `webhook-api/news-processor.js`).
- **Docker Compose**: Manages the local services.

## Features

### ✅ **Phase 1: Core Conversational Loop** [Completed]
- WebSocket push-based frontend and Node.js backend
- QDRANT vector database integration
- Conversational memory with semantic context retrieval
- Idle timer for proactive engagement

### ✅ **Phase 2: The Thinker** [Completed]
- **Dynamic Thought Generation**: LLM-powered proactive thoughts instead of hardcoded responses
- **News-Aware Personality**: Processes BBC RSS feeds and generates thoughts influenced by current events
- **Emotional State Tracking**: Mood system (-10 to +10) that responds to news sentiment
- **Context-Aware Thoughts**: References recent conversations and current events
- **Natural Conversation Model**: Separates proactive thoughts from conversational responses

### 🔄 **Phase 3: Personality & Evolution** [In Progress]
- **User & Bot Profiles (Implemented)**: `profileStore` persists user interests, sentiment averages, trust level, and conversation topics.
- **Feedback Loops (In Progress)**: `/api/feedback` lets conversations update the personality system; the dashboard visualizes evolving state.
- **Opinion Formation (In Progress)**: `/api/opinions` exposes Aura’s topic-level opinions derived from news mood + feedback signals.
- **Structured Fact Memory (In Progress)**: Conversations extract long-lived facts (name, favorites, attributes) so Aura can remember and reuse them naturally.
- **Curiosity-Driven Learning (Implemented)**: Aura proactively asks discovery questions to learn about users, integrated into both proactive thoughts and conversational responses. Missing facts are prioritized and questions feel natural, not like an interview.
- **Persistent Identity (Implemented)**: The chat UI prompts for a display name and stores a device-bound user ID so Aura recognizes you between sessions.
- **Admin / Dev Controls (Implemented)**: `/api/admin/dev-mock`, `/api/admin/reset-mood`, `/api/admin/clear-news`, and the `/admin` dashboard make tuning and testing easier.
- **Unified UI Origin (Implemented)**: The webhook API now serves `/chat` so the SPA and API share origin and avoid manual query overrides.

## Getting Started

### Prerequisites

- Docker and Docker Compose (note: modern Docker supports the `docker compose` plugin; either `docker compose` or `docker-compose` may work depending on your installation)
- A running OpenAI-compatible LLM endpoint (set `LLM_URL`)
- An embeddings endpoint (set `EMBEDDING_URL`)
- A QDRANT server reachable at the `QDRANT_URL` you configure (the included `docker-compose.yml` has Qdrant commented out by default)
- (Optional) SearxNG or another RSS parser if you want to use an external RSS parsing service

### Installation

1.  **Clone this repository:**
    ```bash
    git clone https://github.com/username/AURAaichatbot.git
    cd AURAaichatbot 
    cd webhook-api && npm install
    ```

2.  **Configure Remote Services (production):**
    Open `docker-compose.yml` and ensure the environment variables point to your services:
    - `LLM_URL` and `EMBEDDING_URL` for an OpenAI-compatible gateway (e.g., Ollama, OpenRouter)
    - `QDRANT_URL` for vector database

3.  **Start the Docker services (or run the webhook API directly):**
    ```bash
    docker-compose up -d
    # or run the webhook API directly for development:
    PORT=4002 node webhook-api/server.js
    ```

4.  **Access the Chat Interface:**
    - If serving via the webhook API (recommended): `http://localhost:4002/chat`
    - If serving via the PHP/Apache container at `:8889`: `http://localhost:8889/index.html?api_base=http://localhost:4002`

5.  **Development mock mode:**
    The server has a dev-mock mode to allow local testing without external LLM/embedding services:
    - Start with `DEV_MOCK=true` in the environment to enable the mock on startup.
    - Or toggle at runtime via the admin endpoint:
      - `GET /api/admin/dev-mock` — returns `{ devMock: true|false }`
      - `POST /api/admin/dev-mock` — JSON body `{ "enabled": true|false }` to enable/disable the mock

6.  **Optional: Setup Automated News Processing:**
    ```bash
    ./setup-cron.sh
    ```

## API Endpoints

- **`/health`** *(GET)* – Simple liveness probe for container/platform checks.
- **`/chat`** *(GET)* – Serves the chat UI directly from the webhook API so UI and API share an origin.
- **`/api/chat`** *(POST)* – Main conversational endpoint; accepts `{ message, userId, displayName }` and streams responses through the proactive pipeline.
- **`/api/trigger-thought`** *(POST)* – Allows external automations (e.g., n8n) to broadcast a proactive message via WebSockets.
- **`/api/mood`** *(GET)* – Returns the current emotional state, recent topics, and timestamp.
- **`/api/process-news`** *(GET/POST)* – Manually trigger news ingestion and mood updates.
- **`/api/dashboard`** *(GET)* – Aggregated Phase‑3 telemetry (mood, news, recent activity) for the admin dashboard.
- **`/api/evolution`** *(GET)* – Detailed Phase‑3 data: AI opinions, user stats, interaction totals.
- **`/api/users`**, **`/api/users/:userId/profile`** *(GET)* – Inspect persisted user/bot profile data.
- **`/api/opinions`**, **`/api/opinions/:topic`** *(GET)* – Read Aura’s evolving topic-level opinions.
- **`/api/feedback`** *(POST)* – Submit topic-level feedback that shapes personality/opinion models.
- **`/api/news/:id`** *(DELETE)* – Remove a specific news embedding by point ID.
- **`/api/news/bulk`** *(DELETE)* – Bulk-delete news embeddings that match a title filter.
- **`/api/admin/dev-mock`** *(GET/POST)* – View or toggle deterministic dev-mock mode.
- **`/api/admin/reset-mood`**, **`/api/admin/clear-news`** *(POST)* – Reset in-memory mood state and optionally purge stored news.
- **`/api/thoughts/:userId`** *(GET)* – Legacy polling endpoint for proactive thoughts; superseded by WebSockets but still available.
- **`/admin`** *(GET)* – Serves `dashboard.html`, the in-repo admin UI.
- **`/api/auth/register`** *(POST)* – Create a password-protected profile; returns `userId` and display name.
- **`/api/auth/login`** *(POST)* – Authenticate with an existing profile and retrieve the associated `userId`.

### Authentication & Identity

- Aura now keeps memory keyed to server-side accounts stored in `webhook-api/accounts.json`.
- The chat UI prompts for a display name + password; the same credentials work across devices, ensuring one continuous profile per person.
- Passwords are hashed with `crypto.scrypt` + per-user salt before persisting to disk.
- The `Switch Profile` link in the menu lets you log out locally (clears stored auth info) without affecting server data.
- Accounts include a `role` (`admin` or `user`). Set admin IDs via `ADMIN_USER_IDS` env (comma-separated user IDs) or edit `accounts.json`. Admins see dashboard + news controls; standard users don’t.

### UI Boot & Access Flow

- Visiting `/` immediately redirects to `/chat`, but the SPA now waits for a valid `{userId, token}` session before opening WebSockets or sending `/api/chat` requests. If you see the loading spinner persist, complete the login/register modal once so the UI can proceed.
- `/chat` and the websocket connection share the webhook API’s origin, so tokens stored in `localStorage` are automatically attached to subsequent requests.
- Admin-level APIs (e.g., `/admin`, `/api/process-news`, `/api/admin/*`, `/api/news/*`) enforce the `X-User-Id` / `X-Auth-Token` headers issued during login and will reject access attempts from unauthenticated or non-admin identities.

## News Integration

The system automatically processes news feeds every 30 minutes:
- **BBC World News**: `https://feeds.bbci.co.uk/news/world/rss.xml`
- **BBC Top Stories**: `http://feeds.bbci.co.uk/news/rss.xml`

News analysis includes:
- Emotional impact scoring (-5 to +5)
- Topic extraction and tracking
- Mood state updates
- Context storage in QDRANT for thought generation

## Project Structure

```
AURAaichatbot/
├── index.html                 # Frontend chat interface
├── webhook-api/               # Node.js backend
│   ├── server.js              # Main API and WebSocket server
│   ├── news-processor.js      # News analysis and mood system
│   ├── news-data.json         # Mood state persistence
│   ├── accounts.json          # Generated user credential store (gitignored)
│   └── package.json
├── legacy/                    # Original PHP implementation (archived)
├── docker-compose.yml         # Docker services configuration
├── setup-cron.sh             # Automated news processing setup
├── ai-brain.json             # Structured project information
└── README.md                 # This file
```

## Current Capabilities

- **Intelligent Conversations**: Context-aware responses using semantic search
- **Proactive Engagement**: Dynamic thought generation based on LLM and current events
- **Emotional Intelligence**: Mood tracking and news sentiment analysis
- **Real-time Updates**: WebSocket-based proactive message delivery
- **News Awareness**: Current events influence conversation topics
- **Curiosity-Driven Learning**: Aura asks natural discovery questions to learn about users, building a knowledge base over time
- **Scalable Architecture**: QDRANT vector database for production-ready memory
- **Persistent Identity**: LocalStorage-backed IDs + name prompt keep the same persona across sessions on a device
