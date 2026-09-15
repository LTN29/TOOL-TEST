$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$stopped = 0
$pidFile = Join-Path $root '.run\local-pids.json'
$records = if (Test-Path -LiteralPath $pidFile) { @(Get-Content -LiteralPath $pidFile -Raw | ConvertFrom-Json) } else { @() }
foreach ($record in $records) {
  $connection = Get-NetTCPConnection -LocalPort $record.Port -State Listen -ErrorAction SilentlyContinue | Where-Object OwningProcess -eq $record.Pid
  if ($connection) {
    Stop-Process -Id $record.Pid -Force -ErrorAction SilentlyContinue
    Write-Host "Da dung tien trinh cua project tren cong $($record.Port)"
    $stopped++
  } else { Write-Warning "Bo qua PID $($record.Pid): khong con lang nghe tren cong da ghi nhan." }
}
if (Test-Path -LiteralPath $pidFile) { Remove-Item -LiteralPath $pidFile -Force }
if ($stopped -eq 0) { Write-Host 'Khong co tien trinh nao cua project dang lang nghe.' }
