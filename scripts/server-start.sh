#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
[[ -f .env.server ]] || { echo "Thiếu .env.server; chạy bash scripts/server-install-mac.sh" >&2; exit 1; }

docker info >/dev/null 2>&1 || { echo "Docker Desktop chưa chạy" >&2; exit 1; }
mkdir -p updates
compose=(docker compose --env-file .env.server -f docker-compose.server.yml)
"${compose[@]}" up -d --build --wait mysql api
bash scripts/server-migrate.sh
"${compose[@]}" up -d --wait n8n
curl --fail --silent --show-error http://127.0.0.1:4300/health
echo
echo "Central services bind local-only; Cloudflare Tunnel (nếu có) được quản lý riêng. Script này không Publish n8n workflow."
