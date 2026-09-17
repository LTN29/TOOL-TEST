$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location -LiteralPath $projectRoot
if (-not (Test-Path 'apps/worker/node_modules') -or -not (Test-Path 'apps/desktop/node_modules')) { throw 'Run npm run install:all first.' }
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $projectRoot 'apps/desktop/vendor/playwright-browsers'
npm --prefix apps/worker exec -- playwright install --no-shell chromium
if ($LASTEXITCODE -ne 0) { throw 'Playwright Chromium install failed.' }
npm run build
if ($LASTEXITCODE -ne 0) { throw 'Renderer build failed.' }
npm --prefix apps/desktop run build:win
if ($LASTEXITCODE -ne 0) { throw 'Windows installer build failed.' }
Write-Host 'Installer output: release/desktop/.'
