#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
if [[ "$(uname -s)" != Darwin ]]; then echo "Chỉ chạy script cài server này trên macOS." >&2; exit 1; fi
for tool in git docker openssl; do command -v "$tool" >/dev/null || { echo "Thiếu $tool" >&2; exit 1; }; done
docker info >/dev/null 2>&1 || { echo "Docker Desktop chưa chạy. Hãy mở Docker Desktop trước." >&2; exit 1; }
if [[ ! -f .env.server ]]; then
  cp .env.server.example .env.server
  chmod 600 .env.server
  root_password="$(openssl rand -hex 24)"
  app_password="$(openssl rand -hex 24)"
  n8n_key="$(openssl rand -hex 32)"
  internal_token="$(openssl rand -hex 32)"
  activation_code="$(openssl rand -hex 12)"
  sed -i '' "s/CHANGE_ME_ROOT/$root_password/;s/CHANGE_ME_APP/$app_password/;s/CHANGE_ME_N8N_KEY/$n8n_key/;s/CHANGE_ME_INTERNAL_TOKEN/$internal_token/;s/CHANGE_ME_DEVICE_ACTIVATION/$activation_code/" .env.server
  echo "Đã tạo .env.server (quyền 600) với khóa ngẫu nhiên; không commit file này."
else
  echo "Giữ nguyên .env.server hiện có; không ghi đè khóa/mật khẩu."
fi
echo "Cấu hình đã sẵn sàng. Đọc HUONG_DAN_SERVER_MAC_MINI.md trước khi chạy bash scripts/server-start.sh"
