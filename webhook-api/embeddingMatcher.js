module.exports = function makeEmbeddingMatcher(options = {}) {
  const { generateEmbeddings, factDefinitions = [], similarityThreshold = 0.78 } = options;
  if (!generateEmbeddings) {
    throw new Error('generateEmbeddings function required');
  }

  const exampleEmbeddings = {}; // key -> [{ text, embedding }]

  function cosine(a, b) {
    if (!a || !b || a.length !== b.length) return 0;
    let dot = 0, sa = 0, sb = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      sa += a[i] * a[i];
      sb += b[i] * b[i];
    }
    if (sa === 0 || sb === 0) return 0;
    return dot / (Math.sqrt(sa) * Math.sqrt(sb));
  }

  async function preloadExampleEmbeddings() {
    try {
      for (const def of factDefinitions) {
        if (!def.examples || !def.examples.length) continue;
        exampleEmbeddings[def.key] = [];
        for (const ex of def.examples) {
          try {
            const emb = await generateEmbeddings(ex);
            exampleEmbeddings[def.key].push({ text: ex, embedding: emb });
          } catch (e) {
            console.warn('Failed to embed example for', def.key, ex, e.message || e);
          }
        }
      }
      console.log('Preloaded example embeddings for', Object.keys(exampleEmbeddings).length, 'facts');
    } catch (err) {
      console.error('Error preloading example embeddings:', err);
    }
  }

  async function match(text) {
    try {
      if (!text) return null;
      const emb = await generateEmbeddings(text);
      let best = null;
      for (const [key, examples] of Object.entries(exampleEmbeddings)) {
        for (const ex of examples) {
          const sim = cosine(emb, ex.embedding);
          if (!best || sim > best.similarity) {
            best = { key, value: ex.text, similarity: sim };
          }
        }
      }
      if (best && best.similarity >= similarityThreshold) return best;
      return null;
    } catch (err) {
      console.error('Embedding match error:', err);
      return null;
    }
  }

  return {
    preloadExampleEmbeddings,
    match
  };
};
