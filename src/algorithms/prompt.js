/**
 * Prompt mode: strip conversational filler from AI prompt inputs,
 * then apply keyword extraction on the semantic core.
 *
 * Targets patterns specific to human-to-AI prompts:
 *   - Polite openers     ("辛苦您", "Could you please", …)
 *   - Self-reference     ("给我", "帮我", "for me", …)
 *   - Indefinite articles/classifiers ("一个", "a/an", …)
 *   - Request formulae   ("我想要", "I would like you to", …)
 *
 * After stripping, keyword extraction is applied for further compression.
 */

import { extractKeywords } from './keyword.js';
import { detectLanguage } from '../utils.js';

// ── Chinese prompt patterns ───────────────────────────────────────────────────
// Ordered longest-first to avoid partial matches. All use /g flag.

const ZH_PROMPT = [
  // Polite openers (sentence-initial) – 您/你 both covered
  /^[\s,，。]*(?:您好|你好)[,，。！!]?\s*/,
  /^[\s,，。]*(?:辛苦[您你]?|麻烦[您你]?|劳驾|打扰[一下了]?)[,，。！!]?\s*/,
  /^[\s,，。]*(?:感谢[您你]?|谢谢[您你]?)[,，。！!]?\s*/,
  /^[\s,，。]*(?:请问)[,，。！!]?\s*/,

  // Combined "麻烦你帮我/请您帮我" type phrases
  /(?:麻烦|请)[您你]?\s*帮[我一下]?\s*/g,

  // "请帮我/请给我/请为我" and variants
  /请(?:[您你]\s*)?(?:帮(?:[我一]下?)?|给我|为我|协助(?:[我你])?|帮助(?:[我你])?)\s*/g,

  // "[你/您]帮我/你给我" – pronoun + action + self-reference
  /[你您]\s*(?:帮[我一下]?|给我|为我)\s*/g,

  // Standalone "帮我/给我/为我" at start of clause
  /(?:^|[,，；;])\s*(?:帮(?:我|一下)|给我|为我)\s*/g,

  // "我想要/我想/我需要/我希望/我要" + optional AI reference
  /我(?:想要?|需要|希望|要)\s*(?:[你您]|系统|AI|助手|模型)?\s*(?:帮(?:[我一]下?)?|给我)?\s*/g,
  /我(?:想要?|需要|希望|要)\s*/g,

  // "能否/可以/能不能/麻烦" request openers in mid-sentence
  /(?:能否|可以|能不能|麻烦[您你]?)\s*(?:帮(?:[我一]下?)?|给我)?\s*/g,

  // Indefinite classifiers: 一个/一份/一套/一段/一篇/一下/一些
  /一(?:个|份|套|段|篇|下|些|种|批|系列)/g,
];

// ── English prompt patterns ───────────────────────────────────────────────────

const EN_PROMPT = [
  // "Could/Can/Would you (please) (help me)?"
  /\b(?:could|can|would|will)\s+you\s+(?:please\s+)?(?:help\s+(?:me\s+)?(?:to\s+)?)?/gi,
  // "Please (help me / could you)"
  /^please\s+(?:help\s+(?:me\s+)?(?:to\s+)?)?/gi,
  /\bplease\s+(?:help\s+(?:me\s+)?(?:to\s+)?)?/gi,
  // "I (would like|want|need) (you) (to)"
  /\bi\s+(?:would\s+like|want|need)\s+(?:you\s+)?(?:to\s+)?/gi,
  // "Help me (to)"
  /\bhelp\s+me\s+(?:to\s+)?/gi,
  // "for me" at end of clause
  /\s+for\s+me\b/gi,
  // "generate/create/write/make me a/an"
  /\b(?:generate|create|write|make|build|design|develop)\s+me\s+/gi,
  // Indefinite articles before nouns (when followed by content): a/an
  // Only strip leading "a " or "an " to avoid over-stripping mid-sentence
  /^an?\s+/gi,
];

// ── Core stripper ─────────────────────────────────────────────────────────────

function stripPromptFiller(text, lang) {
  let s = text.trim();
  const patterns = lang === 'zh' ? ZH_PROMPT : EN_PROMPT;
  for (const re of patterns) {
    s = s.replace(re, ' ');
    if (re.global) re.lastIndex = 0;
  }
  return s.replace(/\s{2,}/g, ' ').trim();
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Compress prompt text by stripping conversational filler then extracting keywords.
 *
 * @param {string} text
 * @param {number} ratio  – POS density for keyword extraction
 * @returns {{ lines: string[], tool: string }}
 */
export function compressPrompt(text, ratio) {
  const lang = detectLanguage(text);

  // Split into logical prompts (one per line; multi-line prompts kept together)
  const items = text.split(/\n{2,}/).map(s => s.replace(/\n/g, ' ').trim()).filter(Boolean);
  const actualItems = items.length > 1 ? items : text.split(/\n/).map(s => s.trim()).filter(Boolean);

  // Strip filler from each item
  const stripped = actualItems.map(item => stripPromptFiller(item, lang));

  // Apply keyword extraction on the stripped bodies
  const { lines: kwLines, tool } = extractKeywords(stripped, ratio, lang);

  // Map back; fall back to stripped text if keyword extraction empties a line
  const lines = stripped.map((s, i) => {
    const kw = kwLines[i] ?? '';
    return kw || s;   // if keywords empty, keep the stripped version
  }).filter(Boolean);

  return { lines, tool };
}
