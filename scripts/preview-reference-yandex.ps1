#requires -Version 5.1
param(
  [switch]$PrepareCertificate,
  [switch]$OpenBrowserOnly,
  [switch]$CheckOnly,
  [ValidateRange(1, 65535)][int]$Port = 5180,
  [string]$CertificatePath,
  [string]$KeyPath
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$previewRoot = Join-Path $projectRoot '.tmp/reference-yandex'
$defaultCertificate = Join-Path $previewRoot 'shoditsa-local.pem'
$defaultKey = Join-Path $previewRoot 'shoditsa-local-key.pem'
$publicCertificate = Join-Path $previewRoot 'shoditsa-local.cer'
Set-Location -LiteralPath $projectRoot

if ($PrepareCertificate) {
  if ($PSVersionTable.PSVersion.Major -lt 7) {
    throw 'Creating a new certificate requires PowerShell 7. Opening the preview with an existing certificate works in Windows PowerShell 5.1.'
  }
  if ($CertificatePath -or $KeyPath) { throw 'PrepareCertificate uses only its dedicated .tmp/reference-yandex paths.' }
  New-Item -ItemType Directory -Path $previewRoot -Force | Out-Null
  if ((Test-Path -LiteralPath $defaultCertificate) -or (Test-Path -LiteralPath $defaultKey)) {
    if (!(Test-Path -LiteralPath $defaultCertificate) -or !(Test-Path -LiteralPath $defaultKey)) {
      throw 'Only one certificate file exists. Inspect the dedicated preview directory before regenerating anything.'
    }
    Write-Host 'Reusing the existing local preview certificate; no certificate or trust store was changed.'
  } else {
    $rsa = [System.Security.Cryptography.RSA]::Create(2048)
    $request = [System.Security.Cryptography.X509Certificates.CertificateRequest]::new(
      'CN=shoditsa.ru, OU=Local reference preview', $rsa,
      [System.Security.Cryptography.HashAlgorithmName]::SHA256,
      [System.Security.Cryptography.RSASignaturePadding]::Pkcs1
    )
    $san = [System.Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder]::new()
    $san.AddDnsName('shoditsa.ru')
    $request.CertificateExtensions.Add($san.Build())
    $request.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($false, $false, 0, $true))
    $usage = [System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::DigitalSignature -bor [System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::KeyEncipherment
    $request.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509KeyUsageExtension]::new($usage, $true))
    $purposes = [System.Security.Cryptography.OidCollection]::new()
    $purposes.Add([System.Security.Cryptography.Oid]::new('1.3.6.1.5.5.7.3.1')) | Out-Null
    $request.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]::new($purposes, $true))
    $certificate = $request.CreateSelfSigned([DateTimeOffset]::UtcNow.AddMinutes(-5), [DateTimeOffset]::UtcNow.AddDays(30))
    try {
      [System.IO.File]::WriteAllText($defaultCertificate, $certificate.ExportCertificatePem())
      [System.IO.File]::WriteAllText($defaultKey, $rsa.ExportPkcs8PrivateKeyPem())
      [System.IO.File]::WriteAllBytes($publicCertificate, $certificate.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Cert))
    } finally { $certificate.Dispose(); $rsa.Dispose() }
  }
  $certificate = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($defaultCertificate)
  try {
    Write-Host "Prepared public certificate: $publicCertificate"
    Write-Host "Subject: $($certificate.Subject)"
    Write-Host "SHA-1 thumbprint (for identifying/removing only this certificate): $($certificate.Thumbprint)"
    Write-Host "Expires: $($certificate.NotAfter.ToString('u'))"
    Write-Host 'No trust was installed. Review the .cer and manually trust it for Current User before launching.'
    Write-Host 'The private key stays in .tmp/reference-yandex and must not be shared or committed.'
  } finally { $certificate.Dispose() }
  return
}

if ([bool]$CertificatePath -ne [bool]$KeyPath) { throw 'Provide both CertificatePath and KeyPath, or use the prepared default files.' }
if (!$CertificatePath) { $CertificatePath = $defaultCertificate; $KeyPath = $defaultKey }
$CertificatePath = (Resolve-Path -LiteralPath $CertificatePath).Path
$KeyPath = (Resolve-Path -LiteralPath $KeyPath).Path
# Decode PEM explicitly: the Windows PowerShell 5.1 certificate API has no
# CreateFromPemFile. Only the public certificate is loaded here.
$certificateText = [System.IO.File]::ReadAllText($CertificatePath)
$certificateBase64 = $certificateText -replace '-----BEGIN CERTIFICATE-----|-----END CERTIFICATE-----|\s', ''
$certificate = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new([Convert]::FromBase64String($certificateBase64))
$chain = [System.Security.Cryptography.X509Certificates.X509Chain]::new()
$chain.ChainPolicy.RevocationMode = [System.Security.Cryptography.X509Certificates.X509RevocationMode]::NoCheck
try {
  if (!$chain.Build($certificate)) {
    throw 'The preview certificate is not trusted or valid. Review/trust its public .cer manually; this script never installs trust or bypasses TLS.'
  }
} finally { $chain.Dispose(); $certificate.Dispose() }

if ($OpenBrowserOnly -or $CheckOnly) {
  $tcp = [System.Net.Sockets.TcpClient]::new()
  try { $tcp.Connect('127.0.0.1', $Port) } finally { $tcp.Dispose() }
  $chrome = Join-Path $env:ProgramFiles 'Google/Chrome/Application/chrome.exe'
  if (!(Test-Path -LiteralPath $chrome)) { throw 'Chrome was not found in Program Files. Use a Chromium browser with the documented dedicated profile and resolver rule.' }
  $profile = Join-Path $previewRoot 'browser-profile'
  if ($CheckOnly) {
    Write-Host "Ready: trusted certificate, Chrome and local server on port $Port (PowerShell $($PSVersionTable.PSVersion))."
    return
  }
  # Only this dedicated browser process remaps the production hostname. The OS
  # and Vite continue to resolve the real upstream through normal DNS.
  Start-Process -FilePath $chrome -WindowStyle Normal -ArgumentList @(
    "--user-data-dir=`"$profile`"",
    "--host-resolver-rules=`"MAP shoditsa.ru:443 127.0.0.1:$Port`"",
    '--no-first-run',
    'https://shoditsa.ru/login?returnUrl=%2Flobby'
  ) | Out-Null
  return
}

$variableNames = @('VITE_LOCAL_REDESIGN', 'VITE_REFERENCE_API', 'VITE_PUBLIC_THEME', 'VITE_CACHE_DIR', 'VITE_API_BASE_URL', 'VITE_AUTH_BASE_URL', 'REFERENCE_API_CERT', 'REFERENCE_API_KEY', 'REFERENCE_API_CANONICAL_ORIGIN', 'REVIEW_PORT')
$previousValues = @{}
foreach ($name in $variableNames) { $previousValues[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
try {
  $env:VITE_LOCAL_REDESIGN = '0'
  $env:VITE_REFERENCE_API = '1'
  $env:VITE_PUBLIC_THEME = 'reference'
  $env:VITE_CACHE_DIR = Join-Path $projectRoot '.tmp/vite-reference-yandex'
  $env:VITE_API_BASE_URL = '/api/v1'
  $env:VITE_AUTH_BASE_URL = '/api/auth'
  $env:REFERENCE_API_CERT = $CertificatePath
  $env:REFERENCE_API_KEY = $KeyPath
  $env:REFERENCE_API_CANONICAL_ORIGIN = '1'
  $env:REVIEW_PORT = [string]$Port
  Write-Host "Local frontend: HTTPS loopback 127.0.0.1:$Port; browser origin: https://shoditsa.ru"
  Write-Host 'Run this script with -OpenBrowserOnly in another terminal once Vite is ready.'
  Write-Host 'The dedicated browser uses the real account API; sign in yourself with Yandex.'
  npm run preview:review -- --yandex
  if ($LASTEXITCODE -ne 0) { throw "Vite exited with code $LASTEXITCODE" }
} finally {
  foreach ($name in $variableNames) { [Environment]::SetEnvironmentVariable($name, $previousValues[$name], 'Process') }
}
