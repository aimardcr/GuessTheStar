#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

activate_venv() {
  if [[ -d ".venv/bin" ]]; then
    source ".venv/bin/activate"
  elif [[ -d ".venv/Scripts" ]]; then
    source ".venv/Scripts/activate"
  fi
}

javascript-obfuscator static/js/app.js --output static/js/app.js \
  --compact true \
  --control-flow-flattening true \
  --control-flow-flattening-threshold 1 \
  --dead-code-injection true \
  --dead-code-injection-threshold 0.6 \
  --disable-console-output true \
  --identifier-names-generator mangled \
  --numbers-to-expressions true \
  --rename-globals true \
  --self-defending true \
  --split-strings true \
  --split-strings-chunk-length 5 \
  --string-array true \
  --string-array-encoding base64 \
  --string-array-threshold 1 \
  --string-array-wrappers-count 5 \
  --string-array-wrappers-type variable \
  --string-array-wrappers-chained-calls true \
  --string-array-rotate true \
  --string-array-shuffle true

javascript-obfuscator static/js/leaderboard.js --output static/js/leaderboard.js \
  --compact true \
  --control-flow-flattening true \
  --control-flow-flattening-threshold 1 \
  --dead-code-injection true \
  --dead-code-injection-threshold 0.6 \
  --disable-console-output true \
  --identifier-names-generator mangled \
  --numbers-to-expressions true \
  --rename-globals true \
  --self-defending true \
  --split-strings true \
  --split-strings-chunk-length 5 \
  --string-array true \
  --string-array-encoding base64 \
  --string-array-threshold 1 \
  --string-array-wrappers-count 5 \
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
