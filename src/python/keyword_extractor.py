#!/usr/bin/env python3
"""
Keyword extractor using various NLP tools (POS-based filtering).

Reads JSON from stdin:
  {"sentences": [...], "lang": "en"|"zh", "ratio": 0.3}

Writes JSON to stdout:
  {"tool": "...", "results": [[word, ...], ...], "corrected": false}
  {"tool": null, "results": null, "error": "..."}

Pipeline:
  1. pycorrector  — fix typos in Chinese (auto-installed if missing)
  2. POS tagging  — extract content words by ratio

Recommended tool (covers both EN and ZH, one install):
  spaCy — installed automatically on first use.

ratio controls POS density:
  <= 0.3  → nouns only
  <= 0.5  → nouns + verbs
  <= 0.7  → nouns + verbs + adjectives
  >  0.7  → all content words (+ adverbs, numbers)
"""

import sys
import json
import subprocess
import importlib


# ── Auto-install helpers ───────────────────────────────────────────────────────

def _pip_install(package):
    """
    Install a package via pip into the current Python environment.
    Uses --user to work on macOS externally-managed Python (PEP 668).
    """
    sys.stderr.write(f'[tcomp] "{package}" not found — installing via pip --user...\n')
    r = subprocess.run(
        [sys.executable, '-m', 'pip', 'install', package, '--quiet', '--user'],
        capture_output=True, text=True
    )
    if r.returncode != 0:
        sys.stderr.write(f'[tcomp] Install failed: {r.stderr.strip()}\n')
        return False
    sys.stderr.write(f'[tcomp] "{package}" installed.\n')
    return True


def _ensure_import(pip_name, import_name=None):
    """
    Import a module by name. If ImportError, auto-install the pip package
    and retry. Returns the imported module; raises ImportError on failure.
    """
    mod_name = import_name or pip_name
    # Remove stale cache entry so the re-import finds the newly installed package
    sys.modules.pop(mod_name, None)
    try:
        return importlib.import_module(mod_name)
    except ImportError:
        if _pip_install(pip_name):
            sys.modules.pop(mod_name, None)
            return importlib.import_module(mod_name)
        raise ImportError(f'Could not install {pip_name}')


def _ensure_spacy_model(spacy_mod, model_name):
    """Load a spaCy model, auto-downloading it if not present."""
    try:
        return spacy_mod.load(model_name)
    except OSError:
        sys.stderr.write(f'[tcomp] spaCy model "{model_name}" not found — downloading...\n')
        r = subprocess.run(
            [sys.executable, '-m', 'spacy', 'download', model_name, '--quiet'],
            capture_output=True, text=True
        )
        if r.returncode != 0:
            raise OSError(f'spacy download {model_name} failed: {r.stderr.strip()}')
        sys.stderr.write(f'[tcomp] "{model_name}" downloaded.\n')
        return spacy_mod.load(model_name)


# ── Typo correction ───────────────────────────────────────────────────────────

def try_pycorrector(sentences):
    """
    Correct typos in Chinese sentences using pycorrector.
    Auto-installs pycorrector if not present.
    Returns (corrected_sentences, was_corrected).
    """
    try:
        pycorrector = _ensure_import('pycorrector')
        corrected = []
        changed = False
        for s in sentences:
            result, _ = pycorrector.correct(s)
            if result != s:
                changed = True
            corrected.append(result)
        return corrected, changed
    except Exception as e:
        sys.stderr.write(f'[tcomp] pycorrector skipped: {e}\n')
        return sentences, False


# ── POS tag sets per tool ─────────────────────────────────────────────────────

def pos_sets_spacy(ratio):
    """Universal POS tags used by spaCy (EN and ZH models)."""
    tags = {'NOUN', 'PROPN'}
    if ratio > 0.3: tags |= {'VERB'}
    if ratio > 0.5: tags |= {'ADJ'}
    if ratio > 0.7: tags |= {'ADV', 'NUM'}
    return tags

def pos_sets_nltk(ratio):
    """Penn Treebank tags used by NLTK."""
    tags = {'NN', 'NNS', 'NNP', 'NNPS'}
    if ratio > 0.3: tags |= {'VB', 'VBD', 'VBG', 'VBN', 'VBP', 'VBZ'}
    if ratio > 0.5: tags |= {'JJ', 'JJR', 'JJS'}
    if ratio > 0.7: tags |= {'RB', 'RBR', 'RBS', 'CD'}
    return tags

def pos_sets_lac(ratio):
    """百度 LAC 词性标签."""
    tags = {'n', 'nz', 'nw', 'nr', 'ns', 'nt', 'nco'}
    if ratio > 0.3: tags |= {'v', 'vd', 'vn'}
    if ratio > 0.5: tags |= {'a', 'ad', 'an'}
    if ratio > 0.7: tags |= {'d', 'm', 'q', 'eng', 'f'}
    return tags

def pos_sets_thulac(ratio):
    """THULAC 词性标签."""
    tags = {'n', 'np', 'ns', 'ni', 'nz'}
    if ratio > 0.3: tags |= {'v'}
    if ratio > 0.5: tags |= {'a'}
    if ratio > 0.7: tags |= {'d', 'm', 'q', 'x'}
    return tags

def pos_sets_ltp(ratio):
    """哈工大 LTP 词性标签 (PKU tagset)."""
    tags = {'n', 'nd', 'nh', 'ni', 'nl', 'ns', 'nt', 'nz'}
    if ratio > 0.3: tags |= {'v'}
    if ratio > 0.5: tags |= {'a'}
    if ratio > 0.7: tags |= {'d', 'j', 'i', 'm', 'q'}
    return tags

def pos_sets_hanlp(ratio):
    """HanLP CTB 词性标签."""
    tags = {'NN', 'NR', 'NT'}
    if ratio > 0.3: tags |= {'VV', 'VA', 'VC'}
    if ratio > 0.5: tags |= {'JJ', 'AD'}
    if ratio > 0.7: tags |= {'CD', 'OD', 'FW', 'QP'}
    return tags


# ── English tools ─────────────────────────────────────────────────────────────

def try_spacy_en(sentences, ratio):
    """spaCy English — auto-installs spaCy and en_core_web_sm if missing."""
    spacy = _ensure_import('spacy')
    keep = pos_sets_spacy(ratio)
    nlp = _ensure_spacy_model(spacy, 'en_core_web_sm')
    results = []
    for sent in sentences:
        doc = nlp(sent)
        results.append([
            t.text for t in doc
            if t.pos_ in keep and not t.is_stop and len(t.text) > 1
        ])
    return 'spacy', results


def try_nltk_en(sentences, ratio):
    """NLTK English — auto-installs NLTK package and downloads required data."""
    nltk = _ensure_import('nltk')
    from nltk.tokenize import word_tokenize
    from nltk.tag import pos_tag
    for resource in ('punkt', 'averaged_perceptron_tagger',
                     'punkt_tab', 'averaged_perceptron_tagger_eng'):
        try:
            nltk.data.find(f'tokenizers/{resource}')
        except LookupError:
            try:
                nltk.download(resource, quiet=True)
            except Exception:
                pass
    keep = pos_sets_nltk(ratio)
    results = []
    for sent in sentences:
        tagged = pos_tag(word_tokenize(sent))
        results.append([w for w, t in tagged if t in keep and len(w) > 1])
    return 'nltk', results


# ── Chinese tools ─────────────────────────────────────────────────────────────

def try_spacy_zh(sentences, ratio):
    """
    Recommended Chinese tool — spaCy with zh_core_web_sm.
    Auto-installs spaCy and downloads the model on first use.
    Uses Universal POS tagset (same as English model).
    """
    spacy = _ensure_import('spacy')
    keep = pos_sets_spacy(ratio)
    nlp = _ensure_spacy_model(spacy, 'zh_core_web_sm')
    results = []
    for sent in sentences:
        doc = nlp(sent)
        results.append([
            t.text for t in doc
            if t.pos_ in keep and not t.is_stop and len(t.text) > 0
        ])
    return 'spacy-zh', results


def try_lac_zh(sentences, ratio):
    """百度 LAC — auto-installs lac if missing."""
    LAC_mod = _ensure_import('lac', 'LAC')
    LAC = LAC_mod.LAC
    lac = LAC(mode='lac')
    keep = pos_sets_lac(ratio)
    results = []
    for sent in sentences:
        words, tags = lac.run(sent)
        results.append([w for w, t in zip(words, tags) if t in keep])
    return 'lac', results


def try_thulac_zh(sentences, ratio):
    """THULAC — auto-installs thulac if missing."""
    thulac = _ensure_import('thulac')
    thu = thulac.thulac(seg_only=False)
    keep = pos_sets_thulac(ratio)
    results = []
    for sent in sentences:
        pairs = thu.cut(sent, text=False)
        results.append([w for w, t in pairs if t in keep])
    return 'thulac', results


def try_ltp_zh(sentences, ratio):
    """哈工大 LTP — auto-installs ltp if missing."""
    ltp_mod = _ensure_import('ltp')
    LTP = ltp_mod.LTP
    ltp = LTP()
    output = ltp.pipeline(sentences, tasks=['cws', 'pos'])
    keep = pos_sets_ltp(ratio)
    results = []
    for words, tags in zip(output.cws, output.pos):
        results.append([w for w, t in zip(words, tags) if t in keep])
    return 'ltp', results


def try_hanlp_zh(sentences, ratio):
    """HanLP — auto-installs hanlp if missing."""
    hanlp = _ensure_import('hanlp')
    HanLP = hanlp.load(hanlp.pretrained.mtl.CLOSE_TOK_POS_NER_SRL_DEP_SDP_CON_ELECTRA_SMALL_ZH)
    keep = pos_sets_hanlp(ratio)
    results = []
    for sent in sentences:
        r = HanLP(sent)
        results.append([
            w for w, t in zip(r['tok/fine'], r['pos/ctb'])
            if t in keep
        ])
    return 'hanlp', results


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    try:
        data = json.loads(sys.stdin.read())
    except json.JSONDecodeError as e:
        print(json.dumps({'tool': None, 'results': None, 'error': f'Invalid JSON input: {e}'}))
        sys.exit(1)

    sentences = data.get('sentences', [])
    lang = data.get('lang', 'en')
    ratio = float(data.get('ratio', 0.5))

    if not sentences:
        print(json.dumps({'tool': 'none', 'results': [], 'corrected': False}))
        return

    # ── Step 1: typo correction (Chinese only, auto-installs pycorrector) ────
    corrections_made = False
    if lang == 'zh':
        sentences, corrections_made = try_pycorrector(sentences)

    # ── Step 2: POS-based keyword extraction (tools auto-install if missing) ──
    if lang == 'en':
        candidates = [try_spacy_en, try_nltk_en]
    else:
        candidates = [try_spacy_zh, try_lac_zh, try_thulac_zh, try_ltp_zh, try_hanlp_zh]

    last_error = None
    for fn in candidates:
        try:
            tool, results = fn(sentences, ratio)
            print(json.dumps({'tool': tool, 'results': results, 'corrected': corrections_made}))
            return
        except Exception as e:
            last_error = f'{fn.__name__}: {e}'
            continue

    print(json.dumps({
        'tool': None,
        'results': None,
        'corrected': corrections_made,
        'error': f'No NLP tool available. Last error: {last_error}'
    }))


if __name__ == '__main__':
    main()
