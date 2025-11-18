#!/usr/bin/env node
/*
 Simple preflight check for required external services.
 Usage:
   LLM_URL="https://.../" EMBEDDING_URL="https://.../" QDRANT_URL="http://host:6333/" node scripts/preflight.js

 The script attempts:
 - QDRANT: GET /collections
 - EMBEDDING: POST /v1/embeddings (small test body)
 - LLM: POST /v1/chat/completions (small test body)

 Notes: the script only checks reachability and basic HTTP response. Authorization errors (401/403) count as "reachable but requires credentials".
*/

const { AbortController } = globalThis;
const timeoutMs = 8000;

function normalizeBase(url) {
  if (!url) return '';
  return url.endsWith('/') ? url : url + '/';
}

async function fetchWithTimeout(url, options = {}, ms = timeoutMs) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { signal: controller.signal, ...options });
    clearTimeout(id);
    return res;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

async function checkQdrant(url) {
  if (!url) return { ok: false, reason: 'QDRANT_URL not set' };
  const checkUrl = normalizeBase(url) + 'collections';
  try {
    const res = await fetchWithTimeout(checkUrl, { method: 'GET' });
    return { ok: res.status < 500, status: res.status, statusText: res.statusText };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

async function checkEmbeddings(url) {
  if (!url) return { ok: false, reason: 'EMBEDDING_URL not set' };
  const base = normalizeBase(url);
  const checkUrl = base + 'v1/embeddings';
  const body = JSON.stringify({ model: 'bge-m3:latest', input: 'ping' });
  try {
    const res = await fetchWithTimeout(checkUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body
    });
    return { ok: res.status < 500, status: res.status, statusText: res.statusText };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

async function checkLLM(url) {
  if (!url) return { ok: false, reason: 'LLM_URL not set' };
  const base = normalizeBase(url);
  const checkUrl = base + 'v1/chat/completions';
  const body = JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'system', content: 'ping' }], max_tokens: 1 });
  try {
    const res = await fetchWithTimeout(checkUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body
    });
    return { ok: res.status < 500, status: res.status, statusText: res.statusText };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

(async function main() {
  console.log('Running preflight checks...');

  const LLM_URL = process.env.LLM_URL || '';
  const EMBEDDING_URL = process.env.EMBEDDING_URL || '';
  const QDRANT_URL = process.env.QDRANT_URL || '';

  const results = {};

  results.qdrant = await checkQdrant(QDRANT_URL);
  results.embeddings = await checkEmbeddings(EMBEDDING_URL);
  results.llm = await checkLLM(LLM_URL);

  console.log('\nResults:');

  let allOk = true;

  if (results.qdrant.ok) {
    console.log(`- Qdrant: reachable (HTTP ${results.qdrant.status} ${results.qdrant.statusText || ''})`);
  } else {
    allOk = false;
    console.log(`- Qdrant: NOT OK -> ${results.qdrant.reason || `HTTP ${results.qdrant.status} ${results.qdrant.statusText || ''}`}`);
  }

  if (results.embeddings.ok) {
    console.log(`- Embeddings endpoint: reachable (HTTP ${results.embeddings.status} ${results.embeddings.statusText || ''})`);
  } else {
    allOk = false;
    console.log(`- Embeddings endpoint: NOT OK -> ${results.embeddings.reason || `HTTP ${results.embeddings.status} ${results.embeddings.statusText || ''}`}`);
  }

  if (results.llm.ok) {
    console.log(`- LLM endpoint: reachable (HTTP ${results.llm.status} ${results.llm.statusText || ''})`);
  } else {
    allOk = false;
    console.log(`- LLM endpoint: NOT OK -> ${results.llm.reason || `HTTP ${results.llm.status} ${results.llm.statusText || ''}`}`);
  }

  console.log('\nNotes:');
  console.log('- A 401/403 response generally means the service is reachable but requires authentication.');
  console.log('- If a service returns 404 or 400, it may still be reachable but the exact path/model may differ from defaults used here.');
  console.log('- To override endpoints for this check, set the environment variables: LLM_URL, EMBEDDING_URL, QDRANT_URL');

  if (!allOk) {
    console.error('\nPreflight failed: one or more services are not reachable or misconfigured.');
    process.exit(2);
  }

  console.log('\nPreflight succeeded: all required services appear reachable.');
  process.exit(0);
})();
