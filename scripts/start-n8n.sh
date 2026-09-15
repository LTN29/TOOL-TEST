#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
docker info >/dev/null 2>&1 || { echo "Docker Desktop chưa chạy."; exit 1; }
docker compose -f docker-compose.n8n.yml up -d --wait mysql n8n
open http://localhost:5678
echo "n8n đang chạy nền tại http://localhost:5678"
