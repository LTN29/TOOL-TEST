#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
stopped=0
for port in 4300 5173 4311; do
  while read -r pid; do
    [ -n "$pid" ] || continue
    cwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')"
    if [[ "$cwd" == "$ROOT"* ]]; then
      kill "$pid"
      echo "Đã dừng tiến trình của project trên cổng $port"
      stopped=1
    else
      echo "Không dừng PID $pid trên cổng $port vì không thuộc project này."
    fi
  done < <(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)
done
[ "$stopped" -eq 1 ] || echo "Không có dịch vụ nào của project đang chạy."
