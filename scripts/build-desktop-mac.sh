#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
[[ "$(uname -s)" == "Darwin" ]] || { echo "Bộ cài macOS phải build trên Mac." >&2; exit 1; }
[[ -d apps/worker/node_modules && -d apps/desktop/node_modules ]] || { echo "Chạy npm run install:all trước." >&2; exit 1; }
export PLAYWRIGHT_BROWSERS_PATH="$ROOT/apps/desktop/vendor/playwright-browsers"
npm --prefix apps/worker exec -- playwright install --no-shell chromium
npm run build
npm --prefix apps/desktop run build:mac
echo "Bộ cài nằm trong release/desktop/."
