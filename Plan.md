# AURA.ai Development Plan (Updated)

## Purpose of this update
This update captures the recent production hardening work including relationship tracking, error handling improvements, rate limiting, chat logic refinements, and migration to external Qdrant cloud database so we can pick up development later with a clear roadmap and status.

## Recent accomplishments
- Added `webhook-api/fact_definitions.js` with a curated list of structured facts, priorities, templates, and example values.
- Replaced the previous hardcoded regex array with a definition-driven extraction pipeline.
- Implemented `askedQuestions` tracking in profiles to prevent repetitive questioning and to honor configurable cooldowns.
- Implemented inline, non-modal confirmation flow (WS-driven) for mid-confidence extractions and endpoint `POST /api/profile/confirm-fact` to accept/reject facts.
- Implemented an embedding-backed matcher (`webhook-api/embeddingMatcher.js`) that preloads example embeddings and performs semantic matching to handle paraphrases.
- Added server-side handling to auto-save high-confidence extractions and to prompt inline confirmations for mid-confidence matches.
- Added in-chat Profile UI and server endpoint `POST /api/profile/remove-fact` to allow users to view and remove stored facts.
- Implemented telemetry collection (`webhook-api/telemetry.json` + `telemetryStore`) and a secure admin endpoint `GET /api/admin/telemetry` plus a small telemetry UI on the admin dashboard.
- Improved frontend WebSocket reliability: `index.html` now includes automatic reconnect with exponential backoff and periodic keepalive pings to reduce reverse-proxy disconnects.
- Fixed news-influenced thought selection to use the most recent Qdrant news entries (sorted by `payload.timestamp`) and added selection logging for easier debugging (`webhook-api/news-processor.js`).
- **COMPLETED**: Added relationship tracking system - Extended profileStore.js with relationship tracking and shared interest discovery.
- **COMPLETED**: Production hardening - Added rate limiting (30 req/min), memory leak prevention, service health monitoring, and configuration validation.
- **COMPLETED**: Improved chat logic - Fixed intrusive mood/news injection to only trigger on direct questions, not casual mentions.
- **COMPLETED**: Robust error handling - Better JSON parsing with fallbacks for malformed LLM responses.
- **NEW: Migrated to external Qdrant cloud database** - Updated system to use cloud-hosted Qdrant with API key authentication.
- **NEW: Vector size validation** - Added automatic vector size validation and adjustment to prevent Bad Request errors.
- **NEW: Environment configuration** - Created .env.example files for easier setup and deployment.
- **NEW: Fixed vector embedding context retrieval** - Resolved Qdrant Bad Request errors with client-side filtering approach.
- **NEW: Neo4j GraphStore integration** - Added optional graph database support with hybrid JSON/Neo4j storage and graceful fallback.

## Short-term plan (next sprint)
1. ✅ **COMPLETED**: Tune thresholds and add production hardening features
2. ✅ **COMPLETED**: Add relationship tracking system for user connections
3. ✅ **COMPLETED**: Fix intrusive mood/news injection in chat responses
4. ✅ **COMPLETED**: Add robust error handling for JSON parsing failures
5. ✅ **COMPLETED**: Fix vector embedding context retrieval Bad Request errors
6. ✅ **COMPLETED**: Integrate Neo4j GraphStore with hybrid JSON/Neo4j storage
7. Add unit/integration tests for `extractStructuredFacts`, embedding matcher, and confirmation flows.
8. Add aggregated telemetry views (counts by event type and fact key) and CSV export for offline analysis.
9. Consider adding a server-side WS heartbeat/ping to complement client-side keepalives and to detect stale sockets behind proxies.

## Recent infra changes (notes)
- Per-user idle/proactive timers and deferred greeting logic implemented to stop repeated global greetings and to target proactive thoughts to individual users.
- Undelivered thoughts are now stored to disk per-user and delivered when the user next authenticates.
- Added `GET /api/debug/states` (admin-only) to inspect userStates and aid debugging.
- Added rate limiting middleware (`rateLimiter.js`) and service health monitoring (`healthChecker.js`).
- Extended profileStore.js with relationship tracking capabilities and shared interest discovery.
- Improved chat logic to be more contextual and less intrusive with mood/news injection.
- **NEW: Migrated to external Qdrant cloud database** with API key authentication for improved scalability and reliability.
- **NEW: Added dynamic vector size validation** to automatically handle embedding dimension mismatches and prevent storage errors.
- **NEW: Fixed vector embedding context retrieval** - Resolved Qdrant Bad Request errors by removing server-side filters and implementing client-side filtering.
- **NEW: Integrated Neo4j GraphStore** - Added optional graph database support with hybrid JSON/Neo4j storage, graceful fallback, and enhanced relationship API.
- **NEW: Created environment configuration templates** (.env.example files) for easier deployment setup including Neo4j configuration.

## Medium-term plan
1. Create an admin UI for tuning thresholds and viewing per-fact metrics (accept/confirm/reject counts) — extend the current dashboard telemetry card.
2. Integrate optional NLP/NER service for entity extraction (names, dates, places) to complement regex + embeddings.
3. Implement privacy/consent flows for high-sensitivity facts (e.g., require explicit modal consent before storing birthdays or contact info).
4. Improve onboarding UX: disclose what the system remembers and provide a simple "memory" settings panel in the profile modal.
5. Add automated testing suite for fact extraction, confirmation flows, and relationship tracking.

## Long-term plan
1. Curriculum learning: adapt the question ordering per user cohort and domain (e.g., ask gaming facts earlier for gamers).
2. Retention & compliance: add export/delete tools and retention policies for user data.
3. Deploy monitoring and periodic auditing of saved facts to detect potential PII captures that need special handling.
4. Consider Neo4j migration for advanced relationship queries when JSON approach hits performance limits.

## Testing & validation
- Create a test-suite of example utterances for each fact (canonical and paraphrased) and assert expected extraction/confirmation behavior.
- Simulate user sessions to measure how often the system asks discovery questions and how frequently users confirm/reject.
- Use local `DEV_MOCK` to run fast offline tests without calling remote embeddings/LLMs.
- Test relationship tracking and shared interest discovery with multiple user profiles.

## Production readiness status
✅ **COMPLETED**:
- Rate limiting (30 requests/minute per user)
- Memory leak prevention (automatic WebSocket cleanup)
- Service health monitoring with graceful fallbacks
- Configuration validation on startup
- Robust JSON parsing with error handling
- Relationship tracking system
- Contextual mood/news injection

## Notes for future work
- The system defaults are conservative: auto-save only for high-confidence regex or embedding matches. Inline confirmation balances natural conversation with data quality.
- Example embeddings are preloaded at server startup; if `fact_definitions.js` changes, restart the server to refresh cached embeddings.
- Telemetry is stored in `webhook-api/telemetry.json` — consider connecting this to a metrics/analytics pipeline for long-term storage and dashboards.
- Relationship system is JSON-based and suitable for moderate user bases; consider Neo4j migration for complex graph queries at scale.

---

**Status**: Phase 3 is now complete with production-ready hardening. The system is ready for deployment with comprehensive error handling, rate limiting, and relationship tracking capabilities.

Next priorities:
- Add automated testing suite
- Implement aggregated telemetry views
- Add admin UI for threshold tuning
