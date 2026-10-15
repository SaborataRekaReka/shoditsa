param([switch]$StatusOnly)
$ErrorActionPreference = 'Stop'
$tokenPath = $env:SHODITSA_YANDEX_TOKEN_DPAPI_FILE
if ([string]::IsNullOrWhiteSpace($tokenPath) -or -not (Test-Path -LiteralPath $tokenPath -PathType Leaf)) {
  if ($StatusOnly) { Write-Output '{"available":false,"reason":"not_configured"}' }
  exit 2
}
$secretPointer = [IntPtr]::Zero
try {
  $encryptedToken = Get-Content -LiteralPath $tokenPath -Raw
  $secureToken = ConvertTo-SecureString -String $encryptedToken.Trim()
  $secretPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
  $plainToken = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPointer)
  if ([string]::IsNullOrWhiteSpace($plainToken)) { throw 'Empty token' }
  if ($StatusOnly) { Write-Output '{"available":true}' } else { [Console]::Out.Write($plainToken) }
} catch {
  if ($StatusOnly) { Write-Output '{"available":false,"reason":"unreadable_or_wrong_user"}' }
  exit 3
} finally {
  if ($secretPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPointer) }
  $plainToken = $null
  if ($secureToken) { $secureToken.Dispose() }
}
