$ErrorActionPreference = 'Stop'
foreach ($name in @('RUNNER_TEMP','GITHUB_ENV','WINDOWS_PFX_BASE64','WINDOWS_PFX_PASSWORD','CODEX_WEB_GPT_WINDOWS_CERT_SHA1')) {
  if (-not [Environment]::GetEnvironmentVariable($name)) { throw "Missing release signing input: $name" }
}
if ($env:CODEX_WEB_GPT_WINDOWS_CERT_SHA1 -notmatch '^[A-Fa-f0-9]{40}$') { throw 'Invalid expected Windows publisher certificate thumbprint' }
$certificateFile = Join-Path $env:RUNNER_TEMP 'codex-web-release-signing.pfx'
try {
  [IO.File]::WriteAllBytes($certificateFile, [Convert]::FromBase64String($env:WINDOWS_PFX_BASE64))
  $password = ConvertTo-SecureString $env:WINDOWS_PFX_PASSWORD -AsPlainText -Force
  $certificate = Import-PfxCertificate -FilePath $certificateFile -Password $password -CertStoreLocation Cert:\CurrentUser\My
  if (-not ($certificate | Where-Object { $_.Thumbprint -eq $env:CODEX_WEB_GPT_WINDOWS_CERT_SHA1 -and $_.HasPrivateKey })) {
    throw 'Imported Windows certificate does not match the configured publisher thumbprint/private key'
  }
} finally { Remove-Item -LiteralPath $certificateFile -Force -ErrorAction SilentlyContinue }
$tools = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin" -Filter signtool.exe -Recurse | Where-Object { $_.FullName -match '\\x64\\signtool\.exe$' } | Sort-Object FullName -Descending
if (-not $tools) { throw 'Windows SDK x64 signtool is unavailable' }
"CODEX_WEB_GPT_SIGNTOOL=$($tools[0].FullName)" | Out-File -FilePath $env:GITHUB_ENV -Encoding utf8 -Append
