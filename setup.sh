#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

if ! command -v python >/dev/null 2>&1; then
  echo "Python is required. Please install Python 3.11+ and retry."
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required for javascript-obfuscator. Please install Node/npm (Linux) and retry."
  exit 1
fi

if [[ ! -d ".venv" ]]; then
  python -m venv .venv
fi

if [[ -f ".venv/bin/activate" ]]; then
  source ".venv/bin/activate"
else
  echo "Unable to find venv activation script (.venv/bin/activate). Please check .venv creation." >&2
  exit 1
fi

echo "Venv ready: $(python -V)"

pip install --upgrade pip
pip install -r requirements.txt

npm install -g javascript-obfuscator

echo "Setup complete. Activate the venv with 'source .venv/bin/activate', then run './start.sh'."
