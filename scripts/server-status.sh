#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
docker compose --env-file .env.server -f docker-compose.server.yml ps
echo "API health:"
curl --silent --show-error --max-time 5 http://127.0.0.1:4300/health || true
echo
echo "n8n health:"
curl --silent --show-error --max-time 5 http://127.0.0.1:5678/healthz || true
echo
