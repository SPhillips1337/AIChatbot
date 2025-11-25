# PHPaibot Development Plan (Updated)

## Purpose of this update
This update captures the recent implementation work for structured facts, embedding-backed confirmation, inline profile UI, and telemetry so we can pick up development later with a clear roadmap and status.

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

## Short-term plan (next sprint)
1. Tune thresholds: adjust `EMBED_AUTO_SAVE_SIM`, `EMBED_CONFIRM_SIM`, and extraction confidence thresholds based on telemetry.
2. Add unit/integration tests for `extractStructuredFacts`, embedding matcher, and confirmation flows.
3. Add aggregated telemetry views (counts by event type and fact key) and CSV export for offline analysis.
4. Harden authentication checks and ensure all profile mutations require proper `X-User-Id` / `X-Auth-Token` headers.
5. Add a small admin debug endpoint to preview which news items will be used for the next news-influenced thought (preview only, admin-only).
6. Consider adding a server-side WS heartbeat/ping to complement client-side keepalives and to detect stale sockets behind proxies.

## Short-term plan (next sprint)
1. Tune thresholds: adjust `EMBED_AUTO_SAVE_SIM`, `EMBED_CONFIRM_SIM`, and extraction confidence thresholds based on telemetry.
2. Add unit/integration tests for `extractStructuredFacts`, embedding matcher, and confirmation flows.
3. Add aggregated telemetry views (counts by event type and fact key) and CSV export for offline analysis.
4. Harden authentication checks and ensure all profile mutations require proper `X-User-Id` / `X-Auth-Token` headers.

## Medium-term plan
1. Create an admin UI for tuning thresholds and viewing per-fact metrics (accept/confirm/reject counts) — extend the current dashboard telemetry card.
2. Integrate optional NLP/NER service for entity extraction (names, dates, places) to complement regex + embeddings.
3. Implement privacy/consent flows for high-sensitivity facts (e.g., require explicit modal consent before storing birthdays or contact info).
4. Improve onboarding UX: disclose what the system remembers and provide a simple “memory” settings panel in the profile modal.

## Long-term plan
1. Curriculum learning: adapt the question ordering per user cohort and domain (e.g., ask gaming facts earlier for gamers).
2. Retention & compliance: add export/delete tools and retention policies for user data.
3. Deploy monitoring and periodic auditing of saved facts to detect potential PII captures that need special handling.

## Testing & validation
- Create a test-suite of example utterances for each fact (canonical and paraphrased) and assert expected extraction/confirmation behavior.
- Simulate user sessions to measure how often the system asks discovery questions and how frequently users confirm/reject.
- Use local `DEV_MOCK` to run fast offline tests without calling remote embeddings/LLMs.

## Notes for future work
- The system defaults are conservative: auto-save only for high-confidence regex or embedding matches. Inline confirmation balances natural conversation with data quality.
- Example embeddings are preloaded at server startup; if `fact_definitions.js` changes, restart the server to refresh cached embeddings.
- Telemetry is stored in `webhook-api/telemetry.json` — consider connecting this to a metrics/analytics pipeline for long-term storage and dashboards.

---

Next options I can take for you:
- Implement aggregated telemetry views and CSV export now.
- Add admin UI controls to adjust thresholds live from the dashboard.
- Add unit tests for extraction and confirmation flows.

Which would you like me to implement next?