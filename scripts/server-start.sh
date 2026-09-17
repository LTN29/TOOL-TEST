#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
[[ -f .env.server ]] || { echo "Thiếu .env.server; chạy bash scripts/server-install-mac.sh" >&2; exit 1; }
if grep -Eq '^DRY_RUN=false[[:space:]]*$' .env.server; then
  echo "Server kit hiện chỉ cho phép DRY_RUN=true cho tới khi hoàn tất device auth và outbound Worker." >&2
  exit 1
fi
docker info >/dev/null 2>&1 || { echo "Docker Desktop chưa chạy" >&2; exit 1; }
mkdir -p updates
compose=(docker compose --env-file .env.server -f docker-compose.server.yml)
"${compose[@]}" up -d --build --wait mysql api
bash scripts/server-migrate.sh
"${compose[@]}" up -d --wait n8n
curl --fail --silent --show-error http://127.0.0.1:4300/health
echo
echo "Central services bind local-only; Cloudflare Tunnel (nếu có) được quản lý riêng. Script này không Publish n8n workflow."
