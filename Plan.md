# PHPaibot Development Plan

## Project Vision
Create a proactive PHP chatbot that simulates human-like thinking by:
1. Generating "random thoughts" based on previous conversations, current events, and general knowledge
2. Maintaining memory of past interactions
3. Developing a personality that evolves based on user interactions
4. Initiating conversations rather than just responding

## Architecture Overview (Current PoC)

The project has evolved into a lightweight, proof-of-concept demonstrating a hybrid push/pull chat system.

- **Frontend (HTML/JS)**: A single-page chat interface that uses WebSockets to receive proactive messages and standard HTTP requests (Fetch) to send user messages.
- **Backend (Node.js)**: An Express.js server that runs the main chat logic, including a WebSocket server for pushing messages and an API for handling user responses.
- **Remote AI Models**: The system uses a remote, OpenAI-compatible endpoint (like Ollama) for both language model inference and text embeddings.
- **Memory (JSON File)**: Conversation history and vectors are stored in a local `db.json` file. The backend performs an in-memory cosine similarity search for context retrieval.

## Phased Development Plan

### Phase 1: PoC & Core Conversational Loop [Completed]
- **Goal**: Create a working chatbot with a proactive push-based interface and contextual memory.
- **Achievements**:
    - Implemented a WebSocket push-based frontend (`index.html`) and a Node.js backend (`webhook-api/server.js`).
    - Externalized AI models to a remote Ollama endpoint, removing all local AI/ML Docker services.
    - Replaced the Qdrant vector database with a lightweight local `db.json` file for memory, including an in-memory cosine similarity search for context retrieval.
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
- **Tasks**:
    - Add a Profile store (e.g., a `profile.json` file) to track user interests and Aura's personality traits (e.g., "curious, witty, helpful").
    - Enhance the "Thinker" loop to consult the profile when generating new thoughts, making them more personalized.
    - Implement a mechanism for the AI to update the user profile based on topics discussed in conversation.

## Next Steps
The immediate next step is to begin **Phase 2** by replacing the static, hardcoded array of questions with a dynamic generation process, making Aura a true "thinker".
