param(
  [string]$CertificatePath,
  [string]$KeyPath
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
if ([bool]$CertificatePath -ne [bool]$KeyPath) {
  throw 'Provide both -CertificatePath and -KeyPath for HTTPS, or neither for Chromium localhost HTTP.'
}

# Keep this profile isolated from the autonomous Yandex preview on port 5176.
$variableNames = @('VITE_LOCAL_REDESIGN', 'VITE_REFERENCE_API', 'VITE_PUBLIC_THEME', 'VITE_CACHE_DIR', 'VITE_API_BASE_URL', 'VITE_AUTH_BASE_URL', 'REFERENCE_API_CERT', 'REFERENCE_API_KEY', 'REFERENCE_API_CANONICAL_ORIGIN')
$previousValues = @{}
foreach ($name in $variableNames) { $previousValues[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
try {
  $env:VITE_LOCAL_REDESIGN = '0'
  $env:VITE_REFERENCE_API = '1'
  $env:VITE_PUBLIC_THEME = 'reference'
  $env:VITE_CACHE_DIR = Join-Path $projectRoot '.tmp/vite-reference-api'
  $env:VITE_API_BASE_URL = '/api/v1'
  $env:VITE_AUTH_BASE_URL = '/api/auth'
  $env:REFERENCE_API_CERT = ''
  $env:REFERENCE_API_KEY = ''
  $env:REFERENCE_API_CANONICAL_ORIGIN = '0'
  $scheme = 'http'
  if ($CertificatePath) {
    $env:REFERENCE_API_CERT = (Resolve-Path -LiteralPath $CertificatePath).Path
    $env:REFERENCE_API_KEY = (Resolve-Path -LiteralPath $KeyPath).Path
    $scheme = 'https'
  }
  Write-Host "Connected reference preview: ${scheme}://localhost:5177/"
  Write-Host 'API: https://shoditsa.ru. Sign in yourself with your existing email and password.'
  Write-Host 'Gameplay uses your real account. Yandex/email-link return flows must use the main site.'
  npm run dev:web -- --mode reference-api --host 127.0.0.1 --port 5177 --strictPort
  if ($LASTEXITCODE -ne 0) { throw "Vite exited with code $LASTEXITCODE" }
} finally {
  foreach ($name in $variableNames) { [Environment]::SetEnvironmentVariable($name, $previousValues[$name], 'Process') }
}
