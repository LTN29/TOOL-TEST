#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
docker compose --env-file .env.server -f docker-compose.server.yml stop n8n api mysql
echo "Đã dừng container; volume MySQL/n8n được giữ nguyên."
