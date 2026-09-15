@echo off
cd /d "%~dp0"
where docker >nul 2>&1 || (echo [LOI] Chua cai hoac chua mo Docker Desktop. & pause & exit /b 1)
docker compose -f docker-compose.n8n.yml up -d --wait mysql n8n
if errorlevel 1 (pause & exit /b 1)
start "" http://localhost:5678
echo n8n dang chay nen tai http://localhost:5678
pause
