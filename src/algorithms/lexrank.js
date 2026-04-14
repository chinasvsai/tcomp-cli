/**
 * LexRank extractive summarizer.
 * Similarity via TF-IDF cosine; sparse graph (threshold); PageRank ranking.
 */
import { tokenize, selectTopSentences, pageRank } from '../utils.js';

function buildTfIdf(tokenizedSentences) {
  const N = tokenizedSentences.length;

  const df = new Map();
  for (const tokens of tokenizedSentences) {
    for (const t of new Set(tokens)) {
      df.set(t, (df.get(t) ?? 0) + 1);
    }
  }

  const vecs = tokenizedSentences.map(tokens => {
    const tf = new Map();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);

    const vec = new Map();
    for (const [t, count] of tf) {
      const idf = Math.log(N / (df.get(t) ?? 1)) + 1;
      vec.set(t, count * idf);
    }
    return vec;
  });

  // Pre-compute L2 norms so cosine() doesn't traverse vecB on every pair call.
  const norms = vecs.map(vec => {
    let sq = 0;
    for (const v of vec.values()) sq += v * v;
    return Math.sqrt(sq);
  });

  return { vecs, norms };
}

function cosine(vecA, normA, vecB, normB) {
  if (normA === 0 || normB === 0) return 0;
  let dot = 0;
  for (const [t, v] of vecA) {
    dot += v * (vecB.get(t) ?? 0);
  }
  return dot / (normA * normB);
}

export function summarize(sentences, ratio, lang, threshold = 0.1) {
  const n = sentences.length;
  const numKeep = Math.max(1, Math.round(n * ratio));
  const tokenized = sentences.map(s => tokenize(s, lang));
  const { vecs, norms } = buildTfIdf(tokenized);

  const matrix = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const sim = cosine(vecs[i], norms[i], vecs[j], norms[j]);
      const val = sim < threshold ? 0 : sim;
      matrix[i][j] = val;
      matrix[j][i] = val;
    }
  }

  const scores = pageRank(matrix);
  return selectTopSentences(sentences, scores, numKeep).join('\n');
}
