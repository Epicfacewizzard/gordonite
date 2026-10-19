# Put the last commit on the CasaOS server. Run from a normal PowerShell window on a computer on the home network or VPN:
#   powershell -ExecutionPolicy Bypass -File scripts\deploy-casaos.ps1
# Add -DryRun to build the release archive and stop before touching the server.
#
# Password prompts: ONE per deploy (sudo on the server). The copy and the login use a deploy key
# (~/.ssh/gordonite_deploy). The first run makes that key and installs it on the server, which asks for the server
# password one extra time, once ever. Nothing secret is stored in the repository or printed.
param(
  [string]$Server = 'gordon@192.168.1.50',
  [switch]$DryRun,
  [switch]$Inspect   # read-only: show what the server has (images, containers, which Compose file) and change nothing
)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)

$key = Join-Path $HOME '.ssh\gordonite_deploy'
$sshOpts = @('-i', $key, '-o', 'IdentitiesOnly=yes')

# Makes the deploy key (no passphrase, on this computer only) and puts it on the server if the server does not take it yet.
function Use-DeployKey {
  $ErrorActionPreference = 'Continue' # Windows PowerShell turns a native command's stderr into an error under 'Stop'
  if (-not (Test-Path $key)) {
    Write-Host "Making a deploy key at $key (one time)..."
    New-Item -ItemType Directory -Force (Split-Path $key) | Out-Null
    ssh-keygen -q -t ed25519 -N '""' -C "gordonite-deploy@$env:COMPUTERNAME" -f $key
    if ($LASTEXITCODE -ne 0) { throw 'Could not make the deploy key.' }
  }
  ssh @sshOpts -o BatchMode=yes -o ConnectTimeout=10 $Server true 2>$null
  if ($LASTEXITCODE -eq 0) { return }
  Write-Host "`nInstalling the deploy key on $Server (one time; enter the server password)..."
  Get-Content "$key.pub" | ssh $Server 'umask 077; mkdir -p ~/.ssh && f=~/.ssh/authorized_keys && { [ ! -s $f ] || sed -i -e ''$a\'' $f; } && cat >> $f'
  if ($LASTEXITCODE -ne 0) { throw 'Could not install the deploy key. Nothing else was changed on the server.' }
  ssh @sshOpts -o BatchMode=yes -o ConnectTimeout=10 $Server true
  if ($LASTEXITCODE -ne 0) { throw 'The server still does not accept the deploy key. Nothing else was changed on the server.' }
}

if ($Inspect) {
  Use-DeployKey
  Write-Host "Looking at $Server (read-only; password prompt: sudo)..."
  scp @sshOpts "deploy/casaos-inspect.sh" "$Server`:/home/gordon/gordonite/releases/"
  if ($LASTEXITCODE -ne 0) { throw 'Copy failed.' }
  $inspect = '/home/gordon/gordonite/releases/casaos-inspect.sh'
  ssh @sshOpts -t $Server ('sed -i ''s/\r$//'' {0} && bash {0}' -f $inspect)
  exit $LASTEXITCODE
}

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

Use-DeployKey

$remote = "$Server`:/home/gordon/gordonite/releases/"
Write-Host "`nCopying to $Server..."
scp @sshOpts $tar "deploy/casaos-update.sh" $remote
if ($LASTEXITCODE -ne 0) { throw 'Copy failed. Nothing was changed on the server.' }

Write-Host "`nRunning the update on the server (password prompt: sudo)..."
$script = '/home/gordon/gordonite/releases/casaos-update.sh'
$command = 'sed -i ''s/\r$//'' {0} && bash {0} {1} {2}' -f $script, $rev, $hash
ssh @sshOpts -t $Server $command
if ($LASTEXITCODE -ne 0) { throw 'The update reported a problem. Read the output above and tell Claude; do not retry blindly.' }
Write-Host "`nDeployed $rev. Open http://192.168.1.50:8082 and reload." -ForegroundColor Green
