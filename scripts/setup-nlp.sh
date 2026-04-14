#!/usr/bin/env bash
# tcomp NLP tools installer
# ─────────────────────────────────────────────────────────────────────────────
# Creates an isolated Python virtual environment at ~/.tcomp/venv and installs
# spaCy (recommended tool for both EN and ZH) + pycorrector (typo correction).
#
# After running this script, tcomp will automatically use the venv Python
# instead of the system Python, bypassing macOS externally-managed restrictions.
#
# Usage:
#   bash scripts/setup-nlp.sh           # install all (default)
#   bash scripts/setup-nlp.sh --zh      # Chinese only (spaCy zh model)
#   bash scripts/setup-nlp.sh --en      # English only (spaCy en model)
#   bash scripts/setup-nlp.sh --reset   # delete venv and start fresh
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

VENV_DIR="$HOME/.tcomp/venv"
CACHE_DIR="$HOME/.cache/tcomp"
PYTHON_CMD_FILE="$CACHE_DIR/python_cmd"
NO_TOOLS_FILE="$CACHE_DIR/no_python_tools"

ZH=true
EN=true
RESET=false

for arg in "$@"; do
  case "$arg" in
    --zh)    EN=false ;;
    --en)    ZH=false ;;
    --reset) RESET=true ;;
    -h|--help)
      sed -n '2,12p' "$0" | sed 's/^# \?//'
      exit 0 ;;
  esac
done

# ── Helpers ───────────────────────────────────────────────────────────────────
step() { echo ""; echo "▶ $*"; }
ok()   { echo "  ✓ $*"; }
fail() { echo "  ✗ $*" >&2; exit 1; }

# ── Reset ─────────────────────────────────────────────────────────────────────
if [ "$RESET" = true ]; then
  step "Resetting: removing $VENV_DIR"
  rm -rf "$VENV_DIR"
  rm -f "$PYTHON_CMD_FILE" "$NO_TOOLS_FILE"
  ok "Reset complete. Re-running setup..."
  echo ""
fi

# ── Check Python ──────────────────────────────────────────────────────────────
step "Checking Python installation"
if ! command -v python3 &>/dev/null; then
  fail "python3 not found. Install Python 3.9+ first:  brew install python"
fi
PY_VER=$(python3 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
PY_MAJOR=$(echo "$PY_VER" | cut -d. -f1)
PY_MINOR=$(echo "$PY_VER" | cut -d. -f2)
if [ "$PY_MAJOR" -lt 3 ] || { [ "$PY_MAJOR" -eq 3 ] && [ "$PY_MINOR" -lt 9 ]; }; then
  fail "Python 3.9+ required, found $PY_VER"
fi
ok "Python $PY_VER found"

# ── Create virtual environment ────────────────────────────────────────────────
step "Creating virtual environment at $VENV_DIR"
python3 -m venv "$VENV_DIR"
VENV_PYTHON="$VENV_DIR/bin/python"
VENV_PIP="$VENV_DIR/bin/pip"
ok "Virtual environment created"

# ── Upgrade pip ───────────────────────────────────────────────────────────────
step "Upgrading pip"
"$VENV_PIP" install --upgrade pip --quiet
ok "pip upgraded"

# ── Install spaCy ─────────────────────────────────────────────────────────────
step "Installing spaCy (recommended NLP tool for EN + ZH)"
"$VENV_PIP" install spacy --quiet
ok "spaCy installed: $("$VENV_PYTHON" -c 'import spacy; print(spacy.__version__)')"

# ── Download language models ──────────────────────────────────────────────────
if [ "$ZH" = true ]; then
  step "Downloading Chinese model: zh_core_web_sm (~43 MB)"
  "$VENV_PYTHON" -m spacy download zh_core_web_sm --quiet
  ok "zh_core_web_sm ready"
fi

if [ "$EN" = true ]; then
  step "Downloading English model: en_core_web_sm (~12 MB)"
  "$VENV_PYTHON" -m spacy download en_core_web_sm --quiet
  ok "en_core_web_sm ready"
fi

# ── Install pycorrector (Chinese typo correction) ─────────────────────────────
step "Installing pycorrector (Chinese typo correction)"
if "$VENV_PIP" install pycorrector --quiet 2>/dev/null; then
  ok "pycorrector installed"
else
  echo "  ⚠ pycorrector install failed — skipping (optional)"
fi

# ── Save Python path for tcomp ────────────────────────────────────────────────
step "Registering venv with tcomp"
mkdir -p "$CACHE_DIR"
echo "$VENV_PYTHON" > "$PYTHON_CMD_FILE"
rm -f "$NO_TOOLS_FILE"   # clear "unavailable" cache so tcomp retries immediately
ok "Saved to $PYTHON_CMD_FILE"

# ── Quick smoke test ──────────────────────────────────────────────────────────
step "Running smoke test"
TEST_RESULT=$( echo '{"sentences":["用户注册账号"],"lang":"zh","ratio":0.5}' \
  | "$VENV_PYTHON" "$(dirname "$0")/../src/python/keyword_extractor.py" 2>/dev/null )
if echo "$TEST_RESULT" | grep -q '"tool"'; then
  TOOL=$(echo "$TEST_RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin)['tool'])")
  ok "Extraction works — tool: $TOOL"
else
  echo "  ⚠ Smoke test inconclusive (packages may need a restart)"
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════"
echo "  Setup complete!"
echo "  Python : $VENV_PYTHON"
echo "  tcomp will now use spaCy for better compression quality."
echo ""
echo "  To uninstall / reset:"
echo "    bash scripts/setup-nlp.sh --reset"
echo "═══════════════════════════════════════════"
