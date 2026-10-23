$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$env:VITE_LOCAL_REDESIGN = '1'
Write-Host 'Local redesign: http://127.0.0.1:5175/?preview=afisha'
npm run dev:web -- --mode yandex --host 127.0.0.1 --port 5175 --strictPort
