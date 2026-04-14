/**
 * Keyword extraction mode: compress each sentence to its content words.
 *
 * Calls `src/python/keyword_extractor.py` via subprocess, trying tools in order:
 *   English : spaCy → NLTK
 *   Chinese : 百度 LAC → THULAC → 哈工大 LTP → HanLP
 *
 * Falls back to JS-only stopword filtering if Python / all tools are unavailable.
 *
 * ratio controls POS density passed to the Python script:
 *   ≤ 0.3  → nouns only (most compressed)
 *   ≤ 0.5  → nouns + verbs
 *   ≤ 0.7  → nouns + verbs + adjectives
 *   > 0.7  → all content words (+ adverbs, numerals)
 */

import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, writeFileSync, statSync, mkdirSync, unlinkSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { ZH_DISPLAY_STOPWORDS, EN_DISPLAY_STOPWORDS } from '../utils.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PYTHON_SCRIPT = join(__dirname, '../python/keyword_extractor.py');

// ── File-based availability cache ─────────────────────────────────────────────
// Persists across invocations (each tcomp call is a fresh process).
// When all Python NLP tools fail, a marker file is written so subsequent
// calls skip the 25s retry loop immediately.

const CACHE_DIR  = join(homedir(), '.cache', 'tcomp');
const NO_TOOLS   = join(CACHE_DIR, 'no_python_tools');
const PYTHON_CMD = join(CACHE_DIR, 'python_cmd');   // written by scripts/setup-nlp.sh
const CACHE_TTL  = 60 * 60 * 1000; // 1 h — re-probe after user installs tools

function pythonToolsCached() {
  try {
    return existsSync(NO_TOOLS) && (Date.now() - statSync(NO_TOOLS).mtimeMs) < CACHE_TTL;
  } catch { return false; }
}

function cacheUnavailable() {
  try { mkdirSync(CACHE_DIR, { recursive: true }); writeFileSync(NO_TOOLS, ''); } catch { /* ignore */ }
}

function clearCache() {
  try { unlinkSync(NO_TOOLS); } catch { /* file may not exist */ }
}

/**
 * @param {string[]} sentences
 * @param {number}   ratio
 * @param {string}   lang  'en' | 'zh'
 * @returns {{ lines: string[], tool: string }}
 */
export function extractKeywords(sentences, ratio, lang) {
  const python = tryPythonExtraction(sentences, ratio, lang);
  if (python) return python;
  return fallbackExtraction(sentences, lang);
}

// ── Python subprocess ─────────────────────────────────────────────────────────

// Cache Python availability: null = untested, false = unavailable, string = command.
// Avoids re-probing on every extractKeywords() call and prevents the 120s worst-case
// block (two 60s spawnSync attempts) when Python is simply not installed.
let _pythonCmd = null;

function findPython() {
  if (_pythonCmd !== null) return _pythonCmd;

  // 1. Check for venv Python registered by scripts/setup-nlp.sh
  try {
    if (existsSync(PYTHON_CMD)) {
      const configured = readFileSync(PYTHON_CMD, 'utf8').trim();
      if (configured && existsSync(configured)) {
        const probe = spawnSync(configured, ['--version'], { encoding: 'utf8', timeout: 2_000 });
        if (probe.status === 0) {
          _pythonCmd = configured;
          return configured;
        }
      }
    }
  } catch { /* fall through to system probe */ }

  // 2. Fall back to system python3 / python
  for (const cmd of ['python3', 'python']) {
    const probe = spawnSync(cmd, ['--version'], { encoding: 'utf8', timeout: 2_000 });
    if (probe.status === 0) {
      _pythonCmd = cmd;
      return cmd;
    }
  }
  _pythonCmd = false;
  return false;
}

function tryPythonExtraction(sentences, ratio, lang) {
  // Fast path: skip Python entirely if all tools previously failed (< 1 h ago)
  if (pythonToolsCached()) return null;

  const cmd = findPython();
  if (!cmd) return null;

  const payload = JSON.stringify({ sentences, lang, ratio });
  let res;
  try {
    res = spawnSync(cmd, [PYTHON_SCRIPT], {
      input: payload,
      encoding: 'utf8',
      timeout: 300_000,   // 5 min — allows auto-install of spaCy + model on first run
    });
  } catch {
    return null;
  }

  if (res.status !== 0 || !res.stdout?.trim()) return null;

  let data;
  try {
    data = JSON.parse(res.stdout);
  } catch {
    return null;
  }

  if (!data.results) {
    cacheUnavailable();  // all tools failed — skip Python on next call for 1 h
    return null;
  }

  clearCache();  // tools are working — remove stale "unavailable" marker

  if (data.corrected) {
    process.stderr.write('Note: pycorrector applied typo corrections before extraction.\n');
  }

  const sep = lang === 'zh' ? '' : ' ';
  return {
    lines: data.results.map(kws => kws.join(sep)).filter(Boolean),
    tool: data.tool ?? 'python',
  };
}

// ── JS fallback (stopword removal, no POS tagging) ────────────────────────────

function fallbackExtraction(sentences, lang) {
  process.stderr.write(
    'Warning: no Python NLP tool found; using JS stopword fallback.\n' +
    '         Install spaCy or NLTK (EN) / LAC or THULAC (ZH) for better quality.\n'
  );
  return {
    lines: sentences.map(s => fallbackSentence(s, lang)).filter(Boolean),
    tool: 'js-fallback',
  };
}

/**
 * Minimal JS keyword extraction.
 *
 * Chinese: keep all CJK characters not in ZH_DISPLAY_STOPWORDS (pure particles),
 *          AND preserve adjacent ASCII runs (digits, units, %, letters).
 *          Crucially does NOT filter '不' (negation) or '有' (existence).
 *
 * English: remove stopwords; keep words length > 2.
 */
function fallbackSentence(sentence, lang) {
  if (lang === 'zh') {
    const result = [];
    let ascii = '';
    for (const ch of sentence) {
      const isCJK = /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(ch);
      // Preserve digits, letters, %, °, common unit symbols
      const isUseful = /[0-9a-zA-Z%°℃\.\-\/]/.test(ch);

      if (isCJK) {
        if (ascii) { result.push(ascii); ascii = ''; }
        if (!ZH_DISPLAY_STOPWORDS.has(ch)) result.push(ch);
      } else if (isUseful) {
        ascii += ch;
      } else {
        if (ascii) { result.push(ascii); ascii = ''; }
      }
    }
    if (ascii) result.push(ascii);
    return result.join('');
  }
  // English: remove display-stopwords; preserve numbers, decimals, percentages.
  // Protect decimal points (X.Y) from punctuation stripping via placeholder.
  const cleaned = sentence.toLowerCase()
    .replace(/(\d)\.(\d)/g, '$1\u00b7$2')   // protect decimal points → ·
    .replace(/[^a-z0-9\s%\u00b7]/g, ' ')    // strip other punctuation
    .replace(/\u00b7/g, '.');                // restore decimal points
  return cleaned
    .split(/\s+/)
    .filter(w => w.length > 0 && (/\d/.test(w) || (w.length > 2 && !EN_DISPLAY_STOPWORDS.has(w))))
    .join(' ');
}
