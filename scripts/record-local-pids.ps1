$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$deadline = (Get-Date).AddSeconds(90)
do {
  $records = @()
  foreach ($port in 4300,5173,4311) {
    $connection = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($connection) { $records += [PSCustomObject]@{ Port=$port; Pid=$connection.OwningProcess } }
  }
  if ($records.Count -eq 3) {
    $runDir = Join-Path $root '.run'
    New-Item -ItemType Directory -Path $runDir -Force | Out-Null
    $records | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runDir 'local-pids.json') -Encoding UTF8
    Start-Process 'http://localhost:5173'
    exit 0
  }
  Start-Sleep -Seconds 2
} while ((Get-Date) -lt $deadline)
Write-Warning 'Web chưa sẵn sàng sau 90 giây.'
