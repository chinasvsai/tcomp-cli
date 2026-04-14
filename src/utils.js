/**
 * Shared utilities: language detection, sentence splitting, tokenization,
 * token estimation, and sentence selection.
 */

// ── Stop words ────────────────────────────────────────────────────────────────

/**
 * Full stopword set – used for tokenization / TF-IDF similarity only.
 * Do NOT use this for display output: it includes negation words ('not', 'no')
 * that are semantically critical in requirements and constraints.
 */
export const EN_STOPWORDS = new Set([
  'a','an','the','and','or','but','in','on','at','to','for','of','with',
  'by','from','is','are','was','were','be','been','being','have','has',
  'had','do','does','did','will','would','could','should','may','might',
  'shall','can','need','dare','ought','used','this','that','these','those',
  'i','me','my','we','our','you','your','he','his','she','her','it','its',
  'they','their','them','what','which','who','whom','not','no','nor','so',
  'yet','both','either','neither','each','few','more','most','other','some',
  'such','than','too','very','just','about','above','after','before','between',
  'during','into','through','under','over','also','up','if','then','as','all'
]);

/**
 * Minimal set for display / output filtering (English).
 * Excludes negation words ('not', 'no', 'nor') and modal verbs
 * that carry constraint meaning in requirements documents.
 */
export const EN_DISPLAY_STOPWORDS = new Set([
  'a','an','the','and','or','but','in','on','at','to','for','of','with',
  'by','from','is','are','was','were','be','been','being','have','has',
  'had','do','does','did','this','that','these','those',
  'i','me','my','we','our','you','your','he','his','she','her','it','its',
  'they','their','them','what','which','who','whom',
  'both','either','neither','each','other','some','such','than',
  'also','up','if','then','as'
]);

/**
 * Full stopword set – used for tokenization / TF-IDF similarity only.
 * Do NOT use this for display output: it includes semantically meaningful
 * words such as '不' (negation) and '有' (exist / have).
 */
export const ZH_STOPWORDS = new Set([
  '的','了','是','在','我','有','和','就','不','人','都','一','一个',
  '上','也','很','到','说','要','去','你','会','着','没有','看','好',
  '自己','这','那','里','来','就是','但','而且','如果','因为','所以',
  '虽然','但是','然后','之后','以及','或者','并且','不过','可以','这个',
  '那个','这些','那些','什么','怎么','如何','为什么','哪里','哪个',
  '已经','还是','只是','只有','应该','能够','可能','需要','没有','非常'
]);

/**
 * Minimal set for display / output filtering.
 * Contains ONLY pure grammatical particles and interjections that carry
 * no semantic weight regardless of context (safe to remove from output).
 * Intentionally excludes: 不 (negation), 有 (existence), modal verbs, etc.
 */
export const ZH_DISPLAY_STOPWORDS = new Set([
  '的','了','着','地',                // structural particles (NOT '得': used in '不得' = must not)
  '嘛','吧','呀','啊','哦','呢','呵','哇','诶','嗯','哈'  // sentence-final particles
]);

// ── Language detection ────────────────────────────────────────────────────────

export function detectLanguage(text) {
  const cjk = (text.match(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g) || []).length;
  return cjk / text.length > 0.1 ? 'zh' : 'en';
}

// ── Sentence splitting ────────────────────────────────────────────────────────

/** 返回 { sentences, lang } 避免下游重复检测语言 */
export function splitSentences(text) {
  const lang = detectLanguage(text);

  let sentences;
  if (lang === 'zh') {
    sentences = text.split(/[。！？；\n]+/).map(s => s.trim());
  } else {
    sentences = text.split(/(?<=[.!?])\s+|\n+/).map(s => s.trim());
  }

  return { sentences: sentences.filter(s => s.length >= 4), lang };
}

// ── Tokenization ─────────────────────────────────────────────────────────────

export function tokenize(sentence, lang) {
  if (lang === 'zh') {
    // 只保留 CJK 字符，过滤标点/空白；unigrams + bigrams 滑窗
    const chars = sentence.replace(/[^\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g, '').split('');
    const tokens = [...chars];
    for (let i = 0; i < chars.length - 1; i++) {
      tokens.push(chars[i] + chars[i + 1]);
    }
    return tokens.filter(t => !ZH_STOPWORDS.has(t));
  }

  // English: lowercase, strip punctuation, split, remove stopwords
  return sentence
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1 && !EN_STOPWORDS.has(w));
}

// ── Sentence deduplication ────────────────────────────────────────────────────

/**
 * Remove duplicate and near-duplicate sentences before compression.
 *
 * Phase 1 – exact dedup: normalise whitespace + lowercase, discard repeats.
 * Phase 2 – near-dedup: token Jaccard similarity > 0.85 (catches slight
 *            rephrasing of the same sentence, e.g. repeated questions).
 *
 * @param {string[]} sentences
 * @param {string}   lang  'en' | 'zh'
 * @returns {{ sentences: string[], removed: number }}
 */
export function deduplicateSentences(sentences, lang) {
  if (sentences.length <= 1) return { sentences, removed: 0 };
  const original = sentences.length;

  // Phase 1: exact dedup (normalised)
  const seen = new Set();
  const unique = sentences.filter(s => {
    const key = s.trim().replace(/\s+/g, ' ').toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Phase 2: near-dedup via token Jaccard
  if (unique.length <= 1) return { sentences: unique, removed: original - unique.length };
  const sets = unique.map(s => new Set(tokenize(s, lang)));
  const keptIdx = [];
  for (let i = 0; i < unique.length; i++) {
    let nearDup = false;
    for (const j of keptIdx) {
      const a = sets[j], b = sets[i];
      let inter = 0;
      for (const t of b) if (a.has(t)) inter++;
      const union = a.size + b.size - inter;
      if (union > 0 && inter / union > 0.85) { nearDup = true; break; }
    }
    if (!nearDup) keptIdx.push(i);
  }

  const result = keptIdx.map(i => unique[i]);
  return { sentences: result, removed: original - result.length };
}



export function estimateTokens(text) {
  if (!text) return 0;
  const cjkCount = (text.match(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g) || []).length;
  const nonCjkCount = text.length - cjkCount;
  return Math.ceil(cjkCount / 1.5 + nonCjkCount / 4);
}

// ── Sentence selection (preserves original order) ────────────────────────────

export function selectTopSentences(sentences, scores, n) {
  const indexed = sentences.map((s, i) => ({ s, score: scores[i], i }));
  indexed.sort((a, b) => b.score - a.score);
  const top = indexed.slice(0, n);
  top.sort((a, b) => a.i - b.i);
  return top.map(x => x.s);
}

// ── PageRank（TextRank / LexRank 共用）────────────────────────────────────────

export function pageRank(matrix, d = 0.85, maxIter = 100, tol = 1e-6) {
  const n = matrix.length;
  const norm = matrix.map(row => {
    const sum = row.reduce((a, v) => a + v, 0);
    return sum === 0 ? row.map(() => 1 / n) : row.map(v => v / sum);
  });

  let scores = new Array(n).fill(1 / n);
  for (let iter = 0; iter < maxIter; iter++) {
    const next = new Array(n).fill((1 - d) / n);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        next[j] += d * norm[i][j] * scores[i];
      }
    }
    const delta = next.reduce((acc, v, i) => acc + Math.abs(v - scores[i]), 0);
    scores = next;
    if (delta < tol) break;
  }
  return scores;
}
