@echo off
cd /d "%~dp0"
docker compose -f docker-compose.n8n.yml down
pause
