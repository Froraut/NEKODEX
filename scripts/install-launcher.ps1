$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

if ($PSVersionTable.PSVersion.Major -lt 6) {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
}

function Get-ResponseHeaderValue {
  param($Headers, [string]$Name)
  if ($null -eq $Headers) { return $null }
  try {
    $Values = $Headers.GetValues($Name)
    if ($Values) { return (@($Values) -join ", ") }
  } catch {}
  try {
    $Value = $Headers[$Name]
    if ($Value) { return (@($Value) -join ", ") }
  } catch {}
  return $null
}

function Get-ReleaseLookupRateLimitError {
  param($Failure)
  $Response = $Failure.Exception.Response
  if ($null -eq $Response) { return $null }
  try { $Status = [int]$Response.StatusCode } catch { return $null }
  if ($Status -ne 403 -and $Status -ne 429) { return $null }
  $Remaining = Get-ResponseHeaderValue $Response.Headers "X-RateLimit-Remaining"
  $RetryAfter = Get-ResponseHeaderValue $Response.Headers "Retry-After"
  $Detail = [string]$Failure.ErrorDetails.Message
  if ($Status -ne 429 -and $Remaining -ne "0" -and -not $RetryAfter -and $Detail -notmatch '(?i)rate.limit') { return $null }

  $RetryAt = $null
  $DelaySeconds = [long]0
  $ResetSeconds = [long]0
  $RetryDate = [DateTimeOffset]::MinValue
  if ($RetryAfter -and [long]::TryParse($RetryAfter, [ref]$DelaySeconds) -and $DelaySeconds -ge 0) {
    try { $RetryAt = [DateTimeOffset]::UtcNow.AddSeconds($DelaySeconds) } catch {}
  } elseif ($RetryAfter -and [DateTimeOffset]::TryParse($RetryAfter, [ref]$RetryDate)) {
    $RetryAt = $RetryDate.ToUniversalTime()
  }
  if (-not $RetryAt) {
    $Reset = Get-ResponseHeaderValue $Response.Headers "X-RateLimit-Reset"
    if ([long]::TryParse($Reset, [ref]$ResetSeconds) -and $ResetSeconds -gt 0) {
      try { $RetryAt = [DateTimeOffset]::FromUnixTimeSeconds($ResetSeconds) } catch {}
    }
  }
  $When = if ($RetryAt) { " Retry after $($RetryAt.ToString('yyyy-MM-dd HH:mm:ss')) UTC." } else { " Retry after GitHub resets the limit." }
  return "GitHub API rate limit blocked release lookup (HTTP $Status).$When To skip API lookup, set CODEX_WEB_GPT_VERSION to a known published NEKODEX version and rerun this installer; checksum and Authenticode publisher verification still apply."
}

function Invoke-WithRetry {
  param(
    [Parameter(Mandatory = $true)][scriptblock]$Operation,
    [Parameter(Mandatory = $true)][string]$Label,
    [switch]$ReleaseLookup
  )
  for ($Attempt = 1; $Attempt -le 3; $Attempt++) {
    try {
      return & $Operation
    } catch {
      if ($ReleaseLookup) {
        $RateLimitError = Get-ReleaseLookupRateLimitError $_
        if ($RateLimitError) { throw $RateLimitError }
      }
      if ($Attempt -eq 3) {
        throw "$Label failed after $Attempt attempts: $($_.Exception.Message)"
      }
      Start-Sleep -Seconds (2 * $Attempt)
    }
  }
}

function Test-IsFullyQualifiedWindowsPath {
  param([AllowEmptyString()][string]$Path)
  return $Path -match '^(?:[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+(?:[\\/]|$))'
}

$Repository = if ($env:CODEX_WEB_GPT_REPOSITORY) { $env:CODEX_WEB_GPT_REPOSITORY } else { "Froraut/NEKODEX" }
$TrustedRepository = "Froraut/NEKODEX"
# Windows releases remain unsigned previews until a real Authenticode publisher
# certificate is provisioned and its public thumbprint is committed here.
$TrustedPublisherThumbprints = @()
if ($Repository -notmatch '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$') {
  throw "Invalid GitHub repository: $Repository"
}
if ($Repository -cne $TrustedRepository) {
  throw "The standalone installer trusts releases from $TrustedRepository only"
}
if (-not [Environment]::Is64BitOperatingSystem) {
  throw "The packaged Windows launcher requires 64-bit Windows"
}
$Arch = "x64"
if ($TrustedPublisherThumbprints.Count -eq 0) {
  throw "Authenticated Windows standalone installation is unavailable because NEKODEX has no provisioned Authenticode publisher identity. Unsigned preview artifacts are not accepted by this installer."
}
foreach ($Thumbprint in $TrustedPublisherThumbprints) {
  if ($Thumbprint -notmatch '^[A-Fa-f0-9]{40}$') { throw "Invalid packaged NEKODEX publisher thumbprint" }
}

$Version = $env:CODEX_WEB_GPT_VERSION
if (-not $Version) {
  $Published = @(Invoke-WithRetry -Label "Resolving published releases" -ReleaseLookup -Operation {
    Invoke-RestMethod "https://api.github.com/repos/$Repository/releases?per_page=10" -TimeoutSec 60
  })
  foreach ($Release in $Published) {
    $Candidate = [string]$Release.tag_name
    if ($Candidate.StartsWith("v")) { $Candidate = $Candidate.Substring(1) }
    if ($Candidate -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]*$') { continue }
    $RequiredAsset = "codex-web-gpt-$Candidate-win-$Arch.exe"
    if (@($Release.assets | Where-Object { $_.name -ceq $RequiredAsset }).Count -gt 0) {
      $Version = $Candidate
      break
    }
  }
  if (-not $Version) {
    throw "No published NEKODEX release among the newest 10 has a win-$Arch.exe asset; set CODEX_WEB_GPT_VERSION explicitly"
  }
}
if ($Version -and $Version.StartsWith("v")) { $Version = $Version.Substring(1) }
if (-not $Version) { throw "Could not resolve the latest NEKODEX release" }
if ($Version -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]*$') { throw "Invalid release version: $Version" }

$Asset = "codex-web-gpt-$Version-win-$Arch.exe"
$BaseUrl = "https://github.com/$Repository/releases/download/v$Version"
$Temp = Join-Path ([System.IO.Path]::GetTempPath()) "codex-web-gpt-$([guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $Temp | Out-Null
try {
  if (Get-Process -Name "NEKODEX", "Codex Web GPT" -ErrorAction SilentlyContinue) {
    throw "Quit NEKODEX before updating it"
  }
  $Installer = Join-Path $Temp $Asset
  $Checksums = Join-Path $Temp "checksums.txt"
  $null = Invoke-WithRetry -Label "Downloading $Asset" -Operation {
    Remove-Item $Installer -Force -ErrorAction SilentlyContinue
    Invoke-WebRequest "$BaseUrl/$Asset" -OutFile $Installer -TimeoutSec 900 -UseBasicParsing
  }
  $null = Invoke-WithRetry -Label "Downloading checksums.txt" -Operation {
    Remove-Item $Checksums -Force -ErrorAction SilentlyContinue
    Invoke-WebRequest "$BaseUrl/checksums.txt" -OutFile $Checksums -TimeoutSec 60 -UseBasicParsing
  }
  $ExpectedLine = Get-Content $Checksums | Where-Object { $_ -match "\s$([regex]::Escape($Asset))$" } | Select-Object -First 1
  if (-not $ExpectedLine) { throw "checksums.txt has no entry for $Asset" }
  $Expected = ($ExpectedLine -split "\s+")[0].ToLowerInvariant()
  $Actual = (Get-FileHash -Algorithm SHA256 $Installer).Hash.ToLowerInvariant()
  if ($Actual -ne $Expected) { throw "SHA-256 verification failed for $Asset" }
  $Signature = Get-AuthenticodeSignature -LiteralPath $Installer
  if ($Signature.Status -ne 'Valid' -or -not $Signature.SignerCertificate -or -not $Signature.TimeStamperCertificate) {
    throw "Windows installer has no valid timestamped Authenticode signature. Unsigned previews are not accepted."
  }
  $SignerThumbprint = $Signature.SignerCertificate.Thumbprint.ToUpperInvariant()
  if ($TrustedPublisherThumbprints -notcontains $SignerThumbprint) {
    throw "Windows installer publisher identity does not match NEKODEX"
  }
  $Process = Start-Process -FilePath $Installer -ArgumentList "/S", "/currentuser" -Wait -PassThru
  if ($Process.ExitCode -ne 0) { throw "Installer exited with code $($Process.ExitCode)" }
  $InstallRegistry = "HKCU:\Software\d1a6026a-6210-588e-9a2b-da3936f94e02"
  $InstallLocation = [string](Get-ItemPropertyValue -LiteralPath $InstallRegistry -Name "InstallLocation")
  if (-not (Test-IsFullyQualifiedWindowsPath $InstallLocation)) {
    throw "Installer recorded an invalid InstallLocation: $InstallLocation"
  }
  $Executable = Join-Path $InstallLocation "NEKODEX.exe"
  if (-not (Test-Path $Executable)) { throw "Installed launcher was not found at $Executable" }
  Start-Process $Executable
  Write-Host "Installed $Executable"
} finally {
  Remove-Item -Recurse -Force $Temp -ErrorAction SilentlyContinue
}
