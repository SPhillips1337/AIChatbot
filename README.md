# PHPaibot - A Thinking Chatbot

PHPaibot is a proactive PHP chatbot that simulates human-like thinking by generating thoughts, maintaining memory, and evolving personality. Unlike traditional chatbots that only respond to user inputs, PHPaibot can initiate conversations with "random thoughts" based on previous interactions.

This project has evolved into a proof-of-concept demonstrating a hybrid push/pull chat system.

## Architecture

PHPaibot uses a simple but powerful architecture:

1.  **Frontend (HTML/JS)**: A single-page chat interface that communicates with the backend. It uses WebSockets to receive proactive messages from the AI and standard HTTP requests (Fetch) to send user messages.
2.  **Backend (Node.js)**: An Express.js server that runs the main chat logic. It features a WebSocket server for pushing messages to the client and an API endpoint (`/api/chat`) for handling user responses.
3.  **Remote AI Models**: The system is configured to use a remote, OpenAI-compatible endpoint (like Ollama) for both language model inference and text embeddings. This externalizes the heavy AI workload.
4.  **Memory (JSON File)**: To keep the PoC lightweight, conversation history and vectors are stored in a local `db.json` file. The backend performs an in-memory cosine similarity search to retrieve context.

## Components

- **PHP Frontend Server**: An Apache server running in Docker to serve the `index.html` file.
- **Node.js Backend**: The core of the application, handling chat logic, memory, and WebSocket communication.
- **Remote Ollama Endpoint**: Provides LLM and embedding models. (External dependency)
- **Docker Compose**: Manages the local services.

## Getting Started

### Prerequisites

- Docker and Docker Compose
- A running remote Ollama (or other OpenAI-compatible) endpoint.

### Installation

1.  **Clone this repository:**
    ```bash
    git clone https://github.com/username/PHPaibot.git
    cd PHPaibot
    ```

2.  **Configure Remote AI Endpoint:**
    Open `docker-compose.yml` and ensure the `LLM_URL` and `EMBEDDING_URL` environment variables for the `webhook-api` service point to your remote Ollama endpoint.

3.  **Start the Docker services:**
    Run the following command. This will stop any old containers and start fresh ones with the current configuration.
    ```bash
    docker-compose up -d
    ```

4.  **Access the Chat Interface:**
    Open your browser and navigate to:
    **http://localhost:8889/index.html**
    *(Note: The port is set to 8889 in `docker-compose.yml`)*

## Development Plan

The core conversational PoC is complete. The next phases focus on making the AI more intelligent and dynamic.

### Phase 1: PoC & Core Conversational Loop [Completed]
- Implement WebSocket push-based frontend and Node.js backend.
- Externalize AI models to a remote endpoint.
- Replace vector database with a local JSON file for simplicity.
- Implement conversational memory with context retrieval.
- Implement an idle timer to manage proactive thoughts.

### Phase 2: The Thinker [Next]
- Replace the hardcoded list of proactive thoughts with dynamically generated ones.
- Integrate external data sources (e.g., news APIs, RSS feeds) to give Aura new topics to think about.

### Phase 3: Personality & Evolution
- Add a persistent profile for the user and the AI to track preferences and personality traits.
- Implement feedback loops to allow the AI to learn and adapt from interactions.

## Project Structure

```
PHPaibot/
├── index.html                 # Frontend chat interface
├── webhook-api/               # Node.js backend
│   ├── server.js              # API and WebSocket implementation
│   ├── db.json                # Conversation memory (created automatically)
│   └── package.json
├── docker-compose.yml         # Docker services configuration
├── ai-brain.json              # Structured project information for AI tools
└── README.md                  # This file
```
