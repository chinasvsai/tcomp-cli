/**
 * TextRank extractive summarizer.
 * Similarity = |Set(S1) ∩ Set(S2)| / (log2(|S1|+2) + log2(|S2|+2))
 * Ranking via PageRank on the resulting graph.
 */
import { tokenize, selectTopSentences, pageRank } from '../utils.js';

function overlapSimilarity(setA, setB) {
  if (setA.size === 0 || setB.size === 0) return 0;
  let overlap = 0;
  for (const t of setB) {
    if (setA.has(t)) overlap++;
  }
  return overlap / (Math.log2(setA.size + 2) + Math.log2(setB.size + 2));
}

export function summarize(sentences, ratio, lang) {
  const n = sentences.length;
  const numKeep = Math.max(1, Math.round(n * ratio));
  const tokenized = sentences.map(s => tokenize(s, lang));
  // Pre-build Sets once; avoids creating O(n²) throwaway Set objects inside the loop.
  const tokenSets = tokenized.map(tokens => new Set(tokens));

  const matrix = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const sim = overlapSimilarity(tokenSets[i], tokenSets[j]);
      matrix[i][j] = sim;
      matrix[j][i] = sim;
    }
  }

  const scores = pageRank(matrix);
  return selectTopSentences(sentences, scores, numKeep).join('\n');
}
