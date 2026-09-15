#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "== SIMI: thiết lập Mac mini =="
command -v node >/dev/null || { echo "Thiếu Node.js 22+. Cài bằng: brew install node@22"; exit 1; }
command -v npm >/dev/null || { echo "Không tìm thấy npm."; exit 1; }
command -v docker >/dev/null || { echo "Thiếu Docker Desktop. Hãy cài và mở Docker Desktop trước."; exit 1; }
docker info >/dev/null 2>&1 || { echo "Docker Desktop chưa chạy."; exit 1; }

if [ ! -f .env ]; then
  cp .env.example .env
  TOKEN="$(openssl rand -hex 32)"
  KEY="$(openssl rand -hex 32)"
  ROOT_DB_PASSWORD="$(openssl rand -hex 24)"
  APP_DB_PASSWORD="$(openssl rand -hex 24)"
  sed -i '' "s/replace_with_a_long_random_token/$TOKEN/" .env
  sed -i '' "s/replace_with_a_long_random_key/$KEY/" .env
  sed -i '' "s/change_me_root/$ROOT_DB_PASSWORD/" .env
  sed -i '' "s/change_me_app/$APP_DB_PASSWORD/" .env
  echo "Đã tạo .env và khóa bảo mật ngẫu nhiên. Hãy sửa thông tin MySQL trong file này."
fi

cp .env apps/api/.env
cp .env apps/worker/.env
npm run install:all
npm run playwright:install
npm run build
npm run check
docker compose -f docker-compose.n8n.yml up -d --wait mysql
npm run db:setup

chmod +x scripts/start-local.sh scripts/stop-local.sh scripts/start-n8n.sh scripts/stop-n8n.sh
echo "MySQL Docker đang chạy tại 127.0.0.1:3307. Tiếp theo đăng nhập từng profile Facebook rồi chạy ./scripts/start-local.sh"
