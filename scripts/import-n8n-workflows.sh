#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

docker info >/dev/null 2>&1 || { echo "Docker Desktop chưa chạy."; exit 1; }
docker compose -f docker-compose.n8n.yml up -d --wait mysql n8n

echo "Import 5 workflow SIMI vào n8n..."
for file in \
  01-fb-campaign-dispatcher.json \
  02-fb-manual-dispatcher.json \
  03-fb-failed-job-retry.json \
  04-fb-worker-watchdog.json \
  05-fb-session-check.json
do
  docker compose -f docker-compose.n8n.yml exec -T n8n n8n import:workflow --input="/workflows/$file"
done

echo "Import hoàn tất. Mở http://localhost:5678, kiểm tra 5 workflow và nhấn Publish cho từng workflow."
echo "Chỉ chạy lệnh import một lần; chạy lại có thể tạo bản sao workflow."
