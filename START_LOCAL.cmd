@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>&1 || (echo [LOI] Chua cai Node.js 22+ & pause & exit /b 1)
where npm >nul 2>&1 || (echo [LOI] Khong tim thay npm & pause & exit /b 1)
where docker >nul 2>&1 || (echo [LOI] Chua cai Docker Desktop de chay MySQL. & pause & exit /b 1)
if not exist .env copy .env.example .env >nul
if not exist node_modules call npm install || (pause & exit /b 1)
if not exist apps\api\node_modules call npm --prefix apps/api install || (pause & exit /b 1)
if not exist apps\web\node_modules call npm --prefix apps/web install || (pause & exit /b 1)
if not exist apps\worker\node_modules call npm --prefix apps/worker install || (pause & exit /b 1)
docker compose -f docker-compose.n8n.yml up -d --wait mysql || (echo [LOI] Khong the khoi dong MySQL Docker. & pause & exit /b 1)
for %%P in (4300 5173 4311) do powershell -NoProfile -Command "if(Get-NetTCPConnection -LocalPort %%P -State Listen -ErrorAction SilentlyContinue){exit 1}" || (echo [LOI] Cong %%P dang duoc su dung. Hay chay STOP_LOCAL.cmd hoac dong ung dung chiem cong. & pause & exit /b 1)
start "" /b powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\record-local-pids.ps1"
echo Dang chay API, Web va Trinh dieu khien Facebook trong mot terminal...
call npm run dev
endlocal
