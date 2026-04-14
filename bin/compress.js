#!/usr/bin/env node

import { readFileSync, existsSync } from 'fs';
import { createInterface } from 'readline';
import { program } from 'commander';
import { compress } from '../src/compressor.js';

const ALGORITHMS = ['textrank', 'lexrank', 'lsa'];
const MODES = ['sentences', 'keywords', 'requirements', 'prompt'];

program
  .name('tcomp')
  .description('Compress text or software requirements using local NLP algorithms (no API key needed)')
  .argument('[file]', 'Input file to compress (reads from stdin if omitted)')
  .option('-t, --text <string>', 'Input text directly (alternative to file/stdin)')
  .option('-m, --mode <mode>', `Processing mode: ${MODES.join(' | ')}`, 'sentences')
  .option('-a, --algorithm <name>', `Sentence-mode algorithm: ${ALGORITHMS.join(' | ')}`, 'textrank')
  .option('-r, --ratio <number>',
    'sentences: fraction to keep (0.1–0.9) | keywords/requirements: POS density (0.1–0.9)', '0.5')
  .option('--stats', 'Show token statistics and tool info', false)
  .addHelpText('after', `
Modes:
  sentences     Extract key sentences (default). Uses TextRank / LexRank / LSA.
  keywords      Compress every sentence to content words via POS tagging.
  requirements  Purpose-built for SRS / BRD documents. Strips modal boilerplate,
                preserves requirement IDs, then applies keyword extraction.
  prompt        Purpose-built for AI prompt inputs. Strips polite openers,
                self-reference ("帮我/给我/for me"), indefinite articles/classifiers,
                then applies keyword extraction.
                Uses Python tools in priority order:
                  English : spaCy → NLTK
                  Chinese : 百度 LAC → THULAC → 哈工大 LTP → HanLP
                Falls back to JS stopword-filtering when no Python tool is found.

POS density (--ratio, keywords / requirements mode):
  ≤ 0.3   nouns only
  ≤ 0.5   nouns + verbs          ← recommended for requirements
  ≤ 0.7   nouns + verbs + adjectives
  > 0.7   all content words (+ adverbs, numerals)

Supported requirement ID formats:
  REQ-001  FR-1  NFR-12  UC-3  US-5  SRS-10
  [REQ-1]  (FR-2)  需求1:  需求编号：FR-01

Examples:
  compress srs.md -m requirements --stats
  compress srs.md -m requirements -r 0.5 --stats
  cat requirements.txt | compress -m requirements -r 0.3
  echo "辛苦您，给我生成一个打卡工具" | compress -m prompt
  echo "Could you please help me write a REST API" | compress -m prompt
  echo "Long article..." | compress --stats
  compress doc.txt -a lexrank -r 0.3 --stats
  `)
  .action(async (file, options) => {
    if (!MODES.includes(options.mode)) {
      process.stderr.write(
        `Error: Unknown mode "${options.mode}". Use: ${MODES.join(', ')}\n`
      );
      process.exit(1);
    }

    if (options.mode === 'sentences' && !ALGORITHMS.includes(options.algorithm)) {
      process.stderr.write(
        `Error: Unknown algorithm "${options.algorithm}". Use: ${ALGORITHMS.join(', ')}\n`
      );
      process.exit(1);
    }

    const ratio = parseFloat(options.ratio);
    if (isNaN(ratio) || ratio < 0.1 || ratio > 0.9) {
      process.stderr.write('Error: --ratio must be a number between 0.1 and 0.9\n');
      process.exit(1);
    }

    let text = '';

    if (options.text) {
      text = options.text;
    } else if (file) {
      if (!existsSync(file)) {
        process.stderr.write(`Error: File not found: ${file}\n`);
        process.exit(1);
      }
      text = readFileSync(file, 'utf8');
    } else if (!process.stdin.isTTY) {
      text = await readStdin();
    } else {
      program.help();
      process.exit(0);
    }

    if (!text.trim()) {
      process.stderr.write('Error: Input text is empty.\n');
      process.exit(1);
    }

    try {
      compress(text, {
        mode: options.mode,
        algorithm: options.algorithm,
        ratio,
        stats: options.stats
      });
    } catch (err) {
      process.stderr.write(`Error: ${err.message}\n`);
      process.exit(1);
    }
  });

program.parse();

function readStdin() {
  return new Promise((resolve, reject) => {
    const lines = [];
    const rl = createInterface({ input: process.stdin });
    rl.on('line', line => lines.push(line));
    rl.on('close', () => resolve(lines.join('\n')));
    rl.on('error', reject);
  });
}
