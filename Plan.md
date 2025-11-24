# PHPaibot Development Plan (Updated)

## Purpose of this update
This update documents a focused effort to improve Aura's structured fact collection and discovery question system and to introduce optional NLP/embedding-backed confirmation to reduce overfitting on example facts (e.g., "favorite color"). It captures the current state and next steps for Phase 3.

## Motivation
During testing and feedback we observed the system over-emphasizes certain example facts (notably `favorite_color`) because the original fact extraction relied on a small set of regexes seeded from early examples. To make Aura more natural and useful, we will:

- Expand the ontology of structured facts Aura tries to learn.
- Add templates and rotation/paraphrase behavior so questions don't sound repetitive.
- Track question history to avoid repeats and respect user preferences.
- Add a confidence model and an optional confirmation flow for low-confidence extractions.
- Optionally integrate lightweight NLP/NER and/or embedding-based semantic matching to improve extraction and paraphrase handling.

## Short-term Plan (next sprint)
1. Add `webhook-api/fact_definitions.js` with a curated list of fact definitions (key, label, priority, sensitivity, optional regex, question templates). (Completed)
2. Replace the hardcoded `FACT_PATTERNS` with dynamic loading from `fact_definitions.js` and adjust `extractStructuredFacts` to use the new definitions. (In progress / code updated)
3. Improve `detectMissingFacts` to compute priority from definitions and existing profile data. (In progress / code updated)
4. Track `askedQuestions` in user profiles so we only re-ask after a configurable cooldown. (Planned)
5. Add a basic confirmation flow: when an extraction is low-confidence, present a clarifying question to the user before persisting. (Planned)

## Medium-term Plan (following weeks)
1. Add embedding-backed confirmation: generate embeddings for candidate answers and compare to canonical example embeddings to decide when to confirm. This requires `EMBEDDING_URL` to be configured for production.
2. Add optional NLP/NER integration (e.g., a lightweight local library or an external spaCy endpoint) to extract entities like PERSON, GPE, DATE for higher accuracy.
3. Implement paraphrasing of templates using the configured LLM to keep questions fresh.
4. Add rate-limiting and session scoring to limit discovery questions to a comfortable cadence (e.g., at most 1 discovery question per idle event, max 3/day).
5. Add UI components for users to view and manage stored facts, and to opt out of memory collection.

## Long-term Plan
1. Continuous profiling and metrics: track acceptance rates of discovery questions, false positive extractions, and user-initiated deletions to refine the curriculum and priorities.
2. Privacy & compliance: add explicit consent, retention policies, and export/delete tools for user data.
3. Personalization & curriculum learning: dynamically reorder discovery priorities based on user interaction patterns and domain (e.g., gaming users get gaming questions earlier).

## Implementation Notes
- The code now loads `webhook-api/fact_definitions.js` which contains templates and optional regexes. Regexes are used when present for deterministic extraction. For facts without regex, future NLP/embedding approaches will be used.
- `detectMissingFacts` now uses definition priorities and requiredConfidence thresholds.
- The next code changes will add `askedQuestions` metadata into `profileStore` and a confirmation endpoint that the client can use to confirm suspect facts.

## Testing Plan
- Unit tests for `extractStructuredFacts` with many natural-language variants to ensure we do not over-extract or mis-label inputs.
- Integration tests for the confirmation flow (simulate user confirming / rejecting candidate facts).
- Manual QA: run the UI and observe discovery question cadence and phrasing; measure how often users confirm or correct facts.

## Current status (summary)
- Server and WebSocket stack: Running (Node.js webhook API). UI served at `/chat`.
- Fact extraction: Migrated to a definition-driven model (`webhook-api/fact_definitions.js`). Regex-driven extractions retained where useful; broader support via NLP/embeddings is planned.
- Next code steps: Add profile question history, confirmation flow, and optional embedding/NLP integration.

---

If you'd like, I can continue and implement the confirmation flow and the `askedQuestions` persistence next, or prototype an embedding-backed candidate matcher (requires `EMBEDDING_URL`). Which would you prefer me to implement next?