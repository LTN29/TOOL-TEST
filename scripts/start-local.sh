#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
docker info >/dev/null 2>&1 || { echo "Docker Desktop chưa chạy; MySQL không thể khởi động."; exit 1; }
docker compose -f docker-compose.n8n.yml up -d --wait mysql
for port in 4300 5173 4311; do
  if lsof -tiTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Cổng $port đang được sử dụng. Hãy chạy scripts/stop-local.sh hoặc kiểm tra ứng dụng chiếm cổng."
    exit 1
  fi
done
(for _ in {1..45}; do curl -fsS http://127.0.0.1:5173 >/dev/null 2>&1 && { open http://localhost:5173; exit; }; sleep 2; done) &
echo $! > .web-opener.pid
exec npm run dev
