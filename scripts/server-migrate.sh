#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
[[ -f .env.server ]] || { echo "Thiếu .env.server" >&2; exit 1; }
compose=(docker compose --env-file .env.server -f docker-compose.server.yml)
"${compose[@]}" up -d --wait mysql
for migration in db/migrations/001_queue_controls.sql db/migrations/002_live_execution_safety.sql db/migrations/003_comment_groups.sql db/migrations/004_multi_desktop_runtime.sql db/migrations/005_device_pairing.sql; do
  echo "Applying $migration"
  "${compose[@]}" exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot "$MYSQL_DATABASE"' < "$migration"
done
echo "Migrations 001–005 applied. Không xóa/reset dữ liệu."
