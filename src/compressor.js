import { splitSentences, estimateTokens, deduplicateSentences } from './utils.js';
import { summarize as textrank } from './algorithms/textrank.js';
import { summarize as lexrank } from './algorithms/lexrank.js';
import { summarize as lsa } from './algorithms/lsa.js';
import { extractKeywords } from './algorithms/keyword.js';
import { compressRequirements } from './algorithms/requirements.js';
import { compressPrompt } from './algorithms/prompt.js';

/**
 * Compress text using a local NLP algorithm.
 *
 * @param {string} text
 * @param {object} options
 * @param {'sentences'|'keywords'|'requirements'|'prompt'} options.mode
 * @param {'textrank'|'lexrank'|'lsa'}                      options.algorithm
 * @param {number}  options.ratio
 * @param {boolean} options.stats
 */
export function compress(text, { algorithm = 'textrank', ratio = 0.3, stats = false, mode = 'sentences' } = {}) {
  const { sentences: rawSentences, lang } = splitSentences(text);

  // ── Deduplication (all modes except prompt, which works on raw text) ─────
  const { sentences, removed } = mode === 'prompt'
    ? { sentences: rawSentences, removed: 0 }
    : deduplicateSentences(rawSentences, lang);
  if (removed > 0) {
    process.stderr.write(`Note: removed ${removed} duplicate/near-duplicate sentence(s).\n`);
  }

  // ── Prompt mode ──────────────────────────────────────────────────────────
  if (mode === 'prompt') {
    const { lines, tool } = compressPrompt(text, ratio);
    const result = lines.join('\n');
    process.stdout.write(result + '\n');
    if (stats) printStats(tool, sentences.length, lines.length, text, result);
    return;
  }

  // ── Requirements mode ────────────────────────────────────────────────────
  if (mode === 'requirements') {
    const { lines, tool, origCount } = compressRequirements(text, ratio);
    const result = lines.join('\n');
    process.stdout.write(result + '\n');
    if (stats) printStats(tool, origCount, lines.length, text, result);
    return;
  }

  // ── Keyword extraction mode ──────────────────────────────────────────────
  if (mode === 'keywords') {
    const { lines, tool } = extractKeywords(sentences, ratio, lang);
    const result = lines.join('\n');
    process.stdout.write(result + '\n');
    if (stats) printStats(tool, sentences.length, lines.length, text, result);
    return;
  }

  // ── Sentence extraction mode ─────────────────────────────────────────────
  if (sentences.length <= 2) {
    // Too few sentences to extract from; fall through to keyword extraction
    // so the user still gets compression rather than verbatim passthrough.
    process.stderr.write(
      `Note: only ${sentences.length} sentence(s) detected; applying keyword extraction instead.\n`
    );
    const { lines, tool } = extractKeywords(sentences, ratio, lang);
    const result = lines.join('\n');
    process.stdout.write(result + '\n');
    if (stats) printStats(tool, sentences.length, lines.length, text, result);
    return;
  }

  let result;
  switch (algorithm) {
    case 'lexrank': result = lexrank(sentences, ratio, lang); break;
    case 'lsa':     result = lsa(sentences, ratio, lang);     break;
    default:        result = textrank(sentences, ratio, lang);
  }

  process.stdout.write(result + '\n');

  if (stats) printStats(algorithm, sentences.length, result.split('\n').length, text, result);
}

function printStats(algorithm, origCount, keptCount, origText, resultText) {
  const origTokens = estimateTokens(origText);
  const outTokens  = estimateTokens(resultText);
  const saved      = origTokens - outTokens;
  const pct        = origTokens > 0 ? ((saved / origTokens) * 100).toFixed(1) : '0.0';
  const sep        = '─'.repeat(42);
  process.stderr.write(`\n${sep}\n`);
  process.stderr.write(`Algorithm : ${algorithm}\n`);
  process.stderr.write(`Sentences : ${origCount} → ${keptCount}\n`);
  process.stderr.write(`Tokens    : ~${origTokens} → ~${outTokens} (saved ${pct}%)\n`);
  process.stderr.write(`${sep}\n`);
}
