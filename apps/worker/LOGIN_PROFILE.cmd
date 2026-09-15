@echo off
cd /d %~dp0
if "%~1"=="" (
  echo Usage: LOGIN_PROFILE.cmd simi_fb_01
  pause
  exit /b 1
)
if not exist .env copy .env.example .env >nul
if not exist node_modules npm install
npx playwright install chromium
npm run login -- %~1
