# Put the last commit on the CasaOS server. Run from a normal PowerShell window on a computer on the home network or VPN:
#   powershell -ExecutionPolicy Bypass -File scripts\deploy-casaos.ps1
# Add -DryRun to build the release archive and stop before touching the server.
# It asks for the server password (two or three times: copy, log in, sudo). Nothing secret is stored or printed.
param(
  [string]$Server = 'gordon@192.168.1.50',
  [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)

if (git status --porcelain) { throw 'There are uncommitted changes. The release is built from the last commit, so commit (or stash) first.' }
git fetch -q
$rev = (git rev-parse --short HEAD).Trim()
if ((git rev-parse HEAD).Trim() -ne (git rev-parse origin/main).Trim()) { Write-Host 'Note: HEAD is not the same as origin/main (not pushed, or behind).' -ForegroundColor Yellow }

Write-Host "Running the unit tests first..."
npm test --silent
if ($LASTEXITCODE -ne 0) { throw 'Unit tests failed. Not deploying.' }

$tar = Join-Path $env:TEMP "gordonite-$rev.tar"
git archive --format=tar -o $tar HEAD
$hash = (Get-FileHash $tar -Algorithm SHA256).Hash.ToLower()
Write-Host "Release $rev  ($([math]::Round((Get-Item $tar).Length / 1MB, 1)) MB)  SHA-256 $hash"
if ($DryRun) { Write-Host 'Dry run: stopping before the server.'; exit 0 }

$remote = "$Server`:/home/gordon/gordonite/releases/"
Write-Host "`nCopying to $Server (password prompt)..."
scp $tar "deploy/casaos-update.sh" $remote
if ($LASTEXITCODE -ne 0) { throw 'Copy failed. Nothing was changed on the server.' }

Write-Host "`nRunning the update on the server (password prompts: login, then sudo)..."
$script = '/home/gordon/gordonite/releases/casaos-update.sh'
$command = 'sed -i ''s/\r$//'' {0} && bash {0} {1} {2}' -f $script, $rev, $hash
ssh -t $Server $command
if ($LASTEXITCODE -ne 0) { throw 'The update reported a problem. Read the output above and tell Claude; do not retry blindly.' }
Write-Host "`nDeployed $rev. Open http://192.168.1.50:8082 and reload." -ForegroundColor Green
