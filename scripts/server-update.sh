#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
git diff --quiet && git diff --cached --quiet || { echo "Working tree có thay đổi; dừng để không ghi đè." >&2; exit 1; }
git pull --ff-only
bash scripts/server-start.sh
echo "Đã cập nhật code, chạy migration idempotent và kiểm tra API health."
