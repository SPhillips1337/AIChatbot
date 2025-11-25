# Archived n8n Workflows

This folder contains archived n8n workflow JSON exports that were previously used for automation with n8n. They are optional and not required for the core AURA.ai application.

Files:
- `conversation-processing.json` — webhook-based workflow to generate embeddings and store conversation points in Qdrant.
- `thought-generation.json` — scheduled workflow to retrieve recent conversations and generate "thoughts" using an LLM.

Usage:
1. Install and run n8n (https://n8n.io/) or import these workflows into an existing n8n instance.
2. Update endpoint URLs in the workflows (e.g., `qdrant`, `embedding-service`, `llm-service`) to match your environment.
3. Import via the n8n editor (`Import` → paste JSON) or place the JSON into your n8n workflows directory.

Notes:
- These files are kept for operational convenience and can be restored to an `n8n` instance if you choose to run automation alongside the chatbot.
- They are not referenced by the Node.js or PHP application code and may be safely edited or removed if you do not plan to use n8n.