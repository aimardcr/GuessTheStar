#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

activate_venv() {
  if [[ -d ".venv/bin" ]]; then
    source ".venv/bin/activate"
  fi
}

activate_venv
export PATH="/usr/local/bin:/usr/bin:$PATH"

if ! command -v javascript-obfuscator >/dev/null 2>&1; then
  echo "javascript-obfuscator not found. Run ./setup.sh first." >&2
  exit 127
fi

if ! command -v gunicorn >/dev/null 2>&1; then
  echo "gunicorn not found. Run ./setup.sh first." >&2
  exit 127
fi

javascript-obfuscator static/js/app.js --output static/js/app.js \
  --compact true \
  --control-flow-flattening false \
  --disable-console-output true \
  --identifier-names-generator mangled \
  --rename-globals true \
  --split-strings true \
  --split-strings-chunk-length 8 \
  --string-array true \
  --string-array-encoding base64 \
  --string-array-threshold 0.5 \
  --string-array-wrappers-count 1 \
  --string-array-wrappers-type variable \
  --string-array-wrappers-chained-calls true \
  --string-array-rotate true \
  --string-array-shuffle true

javascript-obfuscator static/js/leaderboard.js --output static/js/leaderboard.js \
  --compact true \
  --control-flow-flattening false \
  --disable-console-output true \
  --identifier-names-generator mangled \
  --rename-globals true \
  --split-strings true \
  --split-strings-chunk-length 8 \
  --string-array true \
  --string-array-encoding base64 \
  --string-array-threshold 0.5 \
  --string-array-wrappers-count 1 \
  --string-array-wrappers-type variable \
  --string-array-wrappers-chained-calls true \
  --string-array-rotate true \
  --string-array-shuffle true

export FLASK_APP=app.py
export FLASK_ENV=production
GUNICORN_WORKERS="${GUNICORN_WORKERS:-4}"
GUNICORN_BIND="${GUNICORN_BIND:-0.0.0.0:5555}"
GUNICORN_TIMEOUT="${GUNICORN_TIMEOUT:-60}"

exec gunicorn \
  --workers "${GUNICORN_WORKERS}" \
  --bind "${GUNICORN_BIND}" \
  --timeout "${GUNICORN_TIMEOUT}" \
  --access-logfile "-" \
  --error-logfile "-" \
  --log-level "info" \
  app:app
