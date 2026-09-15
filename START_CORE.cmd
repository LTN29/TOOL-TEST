@echo off
cd /d %~dp0
if not exist .env (
  copy .env.example .env >nul
  echo [IMPORTANT] .env was created. Edit passwords and N8N_ENCRYPTION_KEY before production use.
)
docker compose up -d --build
pause
