/**
 * Requirements mode: strip boilerplate from software requirement items,
 * then apply keyword extraction to leave only the semantic core.
 *
 * Two-pass pipeline per requirement line:
 *   1. normaliseReq()  – strip req-IDs, modal phrases, filler patterns
 *   2. extractKeywords() – POS-based filtering (Python tools or JS fallback)
 *
 * Output: one compressed line per non-empty requirement, prefixed with the
 * original requirement ID if present.
 *
 * Supported ID formats: REQ-001, FR-1, NFR-12, UC-3, US-5, SRS-10,
 *                        [REQ-1], (FR-2), "需求1:", "需求编号：FR-01"
 */

import { extractKeywords } from './keyword.js';
import { detectLanguage } from '../utils.js';

// ── English boilerplate patterns (ordered: longest first to avoid partial matches) ──

const EN_BOILERPLATE = [
  // Actor + modal + optional "be able to"
  /\b(the\s+)?(system|software|application|app|platform|service|module|component|product)\s+(shall\s+be\s+able\s+to|must\s+be\s+able\s+to|should\s+be\s+able\s+to|will\s+be\s+able\s+to|can|shall|must|should|will|may|needs?\s+to|is\s+required\s+to|is\s+expected\s+to)\s+/gi,
  /\b(the\s+)?(user|users|operator|operators|administrator|admin|client|customer|end[\s-]user)\s+(shall\s+be\s+able\s+to|must\s+be\s+able\s+to|should\s+be\s+able\s+to|can|shall|must|should|will|may|needs?\s+to|is\s+able\s+to)\s+/gi,
  // Impersonal boilerplate
  /\bit\s+(is|shall\s+be)\s+(required|necessary|mandatory|possible)\s+(that|for)\s+/gi,
  /\bthere\s+(shall|must|should)\s+be\s+(a\s+|an\s+)?/gi,
  /\bthe\s+(following|above|below)\s+(requirements?\s+)?(shall|must|should|will)\s+(be\s+)?/gi,
  // Purpose clauses
  /\bin\s+order\s+to\s+/gi,
  /\bso\s+that\s+/gi,
  /\bfor\s+the\s+purpose\s+of\s+/gi,
  /\bwith\s+the\s+(aim|goal|purpose|intent|objective)\s+of\s+/gi,
  // Common hedges / filler
  /\b(at\s+(all\s+)?times?|at\s+any\s+time|under\s+(all\s+)?circumstances?)\b/gi,
  /\b(in\s+(a|an)\s+\w+\s+manner)\b/gi,
  /\bthe\s+ability\s+to\s+/gi,
  /\bfunctionality\s+(to\s+|for\s+)/gi,
  /\bthe\s+capability\s+to\s+/gi,
  /\bprovide\s+(the\s+)?(user\s+with\s+(the\s+)?)?ability\s+to\s+/gi,
  // "this requirement", "this feature"
  /\bthis\s+(requirement|feature|function|capability|section)\s+/gi,
];

// ── Chinese boilerplate patterns ──

const ZH_BOILERPLATE = [
  // Actor + modal
  /[（(]?(?:系统|软件|应用|平台|服务|模块|组件|产品)[）)]?\s*(?:应该|应当|需要|必须|需|要|将|可以|能够|允许|支持|提供|实现|具备)\s*/g,
  /[（(]?(?:用户|使用者|操作员|管理员|客户|终端用户|访客)[）)]?\s*(?:应该|应当|需要|可以|能够|能|可|须)\s*/g,
  // "需求：" / "需求编号："
  /(?:需求编号|编号|需求号|序号)[：:]\s*[\w\-]+\s*/g,
  // Impersonal constructions
  /系统(?:的功能|功能)?\s*(?:应该|应当|需要|必须|将会?)\s*/g,
  /要求(?:系统|软件|应用)?\s*/g,
  /(?:功能要求|非功能要求|功能需求|非功能需求)[：:]\s*/g,
  // Purpose markers – only strip "为了" (purpose), NOT standalone "为" (copula/preposition)
  /为了\s*/g,
  /以便\s*/g,
  /从而\s*/g,
  // Filler connectives
  /(?:在任何情况下|在所有情况下|始终|总是)\s*/g,
  /以\w{1,3}方式\s*/g,
  /具备以下功能[：:]\s*/g,
];

// ── Requirement ID extraction ─────────────────────────────────────────────────

const ID_RE = /^[\[\(（]?\s*([A-Z]{1,4}[-_]\d+(?:\.\d+)?)\s*[\]\)）]?\s*[：:.\-–\s]+/i;
const ZH_NUM_RE = /^[\[\(（【]?\s*(需求|功能|非功能|FR|NFR|REQ|UC|US|SRS)\s*[：:.\-–]?\s*(\d+(?:\.\d+)?)\s*[\]\)）】]?\s*[：:.\-–\s]*/;

function extractId(line) {
  let m = line.match(ID_RE);
  if (m) return { id: m[1].toUpperCase(), rest: line.slice(m[0].length) };
  m = line.match(ZH_NUM_RE);
  if (m) return { id: `${m[1]}-${m[2]}`, rest: line.slice(m[0].length) };
  return { id: null, rest: line };
}

// ── Boilerplate stripping ─────────────────────────────────────────────────────

function stripBoilerplate(text, lang) {
  let s = text.trim();
  const patterns = lang === 'zh' ? ZH_BOILERPLATE : EN_BOILERPLATE;
  for (const re of patterns) {
    s = s.replace(re, ' ');
    re.lastIndex = 0; // reset stateful global regexes
  }
  return s.replace(/\s{2,}/g, ' ').trim();
}

// ── Split input into requirement items ───────────────────────────────────────
// Each item is one logical requirement. Handles:
//   • Numbered/lettered lists  (1. / a) / - / • / ★)
//   • Blank-line–separated paragraphs
//   • Fallback: sentence splitting

function splitRequirements(text) {
  // Try list-item splitting first
  const listRe = /(?:^|\n)\s*(?:\d+[.)、。]|[a-zA-Z][.)、]|[-•★▪►])\s+/;
  if (listRe.test(text)) {
    return text
      .split(/\n(?=\s*(?:\d+[.)、。]|[a-zA-Z][.)、]|[-•★▪►])\s+)/)
      .map(s => s.replace(/^\s*(?:\d+[.)、。]|[a-zA-Z][.)、]|[-•★▪►])\s+/, '').trim())
      .filter(Boolean);
  }
  // Blank-line paragraphs
  const paras = text.split(/\n{2,}/).map(s => s.replace(/\n/g, ' ').trim()).filter(Boolean);
  if (paras.length > 1) return paras;
  // Single-line or sentence-per-line
  return text.split(/\n/).map(s => s.trim()).filter(Boolean);
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * @param {string} text
 * @param {number} ratio  – POS density forwarded to keyword extractor
 * @returns {{ lines: string[], tool: string, origCount: number }}
 */
export function compressRequirements(text, ratio) {
  const lang = detectLanguage(text);
  const items = splitRequirements(text);

  // Step 1: extract IDs + strip boilerplate
  const stripped = items.map(item => {
    const { id, rest } = extractId(item);
    const clean = stripBoilerplate(rest, lang);
    return { id, clean };
  });

  // Step 2: keyword extraction on the stripped bodies
  const bodies = stripped.map(x => x.clean);
  const { lines: kwLines, tool } = extractKeywords(bodies, ratio, lang);

  // Step 3: re-attach IDs
  const lines = stripped
    .map(({ id }, i) => {
      const kw = kwLines[i] ?? '';
      if (!kw) return null;
      return id ? `[${id}] ${kw}` : kw;
    })
    .filter(Boolean);

  return { lines, tool, origCount: items.length };
}
