/**
 * LSA (Latent Semantic Analysis) extractive summarizer.
 * Gong & Liu (2001): SVD on TF-IDF matrix, select sentence with max |V[j,k]|
 * for each concept k.
 */
import { SingularValueDecomposition } from 'ml-matrix';
import { tokenize, selectTopSentences } from '../utils.js';

function buildTfIdfMatrix(tokenizedSentences) {
  const N = tokenizedSentences.length;

  // Collect vocabulary and document frequencies
  const vocab = new Map();
  const df = new Map();

  for (const tokens of tokenizedSentences) {
    for (const t of new Set(tokens)) {
      df.set(t, (df.get(t) ?? 0) + 1);
    }
    for (const t of tokens) {
      if (!vocab.has(t)) vocab.set(t, vocab.size);
    }
  }

  const terms = vocab.size;
  // terms × sentences matrix
  const data = Array.from({ length: terms }, () => new Array(N).fill(0));

  for (let j = 0; j < N; j++) {
    const tf = new Map();
    for (const t of tokenizedSentences[j]) tf.set(t, (tf.get(t) ?? 0) + 1);

    for (const [t, count] of tf) {
      const i = vocab.get(t);
      const idf = Math.log(N / (df.get(t) ?? 1)) + 1;
      data[i][j] = count * idf;
    }
  }

  return data;
}

export function summarize(sentences, ratio, lang) {
  const n = sentences.length;
  const numKeep = Math.max(1, Math.round(n * ratio));
  const tokenized = sentences.map(s => tokenize(s, lang));

  const matData = buildTfIdfMatrix(tokenized);

  // Need at least 1 term and 2 sentences for SVD
  if (matData.length === 0) {
    return sentences.slice(0, numKeep).join('\n');
  }

  const svd = new SingularValueDecomposition(matData, { autoTranspose: true });
  // V: sentences × concepts
  const V = svd.rightSingularVectors;
  const rows = V.rows;    // = n (sentences)
  const cols = V.columns; // = concepts

  // For each concept k, pick argmax_j |V[j,k]|
  const selected = new Set();
  for (let k = 0; k < cols && selected.size < numKeep; k++) {
    let bestJ = 0;
    let bestVal = -Infinity;
    for (let j = 0; j < rows; j++) {
      const val = Math.abs(V.get(j, k));
      if (val > bestVal) { bestVal = val; bestJ = j; }
    }
    selected.add(bestJ);
  }

  // Supplement if not enough using max |V[j,:]| per sentence
  if (selected.size < numKeep) {
    const rowMax = Array.from({ length: rows }, (_, j) => {
      let m = 0;
      for (let k = 0; k < cols; k++) m = Math.max(m, Math.abs(V.get(j, k)));
      return { j, m };
    });
    rowMax.sort((a, b) => b.m - a.m);
    for (const { j } of rowMax) {
      if (selected.size >= numKeep) break;
      selected.add(j);
    }
  }

  const scores = new Array(n).fill(0);
  for (const idx of selected) scores[idx] = 1;
  return selectTopSentences(sentences, scores, numKeep).join('\n');
}
