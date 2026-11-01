# One-line install for Windows (PowerShell):
#   irm https://raw.githubusercontent.com/Techr-hub/maestrobrain/main/install.ps1 | iex
$ErrorActionPreference = 'Stop'
$dest = if ($env:MAESTRO_DIR) { $env:MAESTRO_DIR } else { Join-Path $HOME 'maestro-brain' }
$zipUrl = 'https://github.com/Techr-hub/maestrobrain/archive/refs/heads/main.zip'

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host 'Maestro needs Node.js 18.17+ (free). Install the LTS version from https://nodejs.org, then run this again.'
  Start-Process 'https://nodejs.org/en/download'
  return
}

if (Test-Path (Join-Path $dest 'bin\maestro.js')) {
  Write-Host "Maestro is already installed in $dest. Starting it..."
} else {
  Write-Host "Downloading Maestro into $dest..."
  $tmp = Join-Path ([IO.Path]::GetTempPath()) ('maestro-' + [guid]::NewGuid())
  New-Item -ItemType Directory -Path $tmp | Out-Null
  $zip = Join-Path $tmp 'maestro.zip'
  Invoke-WebRequest -Uri $zipUrl -OutFile $zip -UseBasicParsing
  Expand-Archive -Path $zip -DestinationPath $tmp
  $src = Get-ChildItem -Path $tmp -Directory | Select-Object -First 1
  New-Item -ItemType Directory -Force -Path $dest | Out-Null
  Copy-Item -Path (Join-Path $src.FullName '*') -Destination $dest -Recurse -Force
  Remove-Item -Recurse -Force $tmp
}

Set-Location $dest
Write-Host "Next time, double-click 'Start Maestro.bat' in $dest, or run: cd `"$dest`"; npm start"
node bin\maestro.js start
