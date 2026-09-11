param([Parameter(Mandatory=$true)][string]$Path, [Parameter(Mandatory=$true)][string]$ExpectedThumbprint)
$ErrorActionPreference = 'Stop'
if ($ExpectedThumbprint -notmatch '^[A-Fa-f0-9]{40}$') { throw 'Invalid expected publisher certificate thumbprint' }
$signature = Get-AuthenticodeSignature -LiteralPath $Path
if ($signature.Status -ne 'Valid' -or $null -eq $signature.SignerCertificate -or $null -eq $signature.TimeStamperCertificate) {
  throw 'Release executable requires a valid timestamped Authenticode signature'
}
if ($signature.SignerCertificate.Thumbprint -ne $ExpectedThumbprint) { throw 'Release executable publisher certificate does not match the configured identity' }
