#!/bin/bash
# Double-click to start Maestro on macOS.
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  for p in /opt/homebrew/bin /usr/local/bin "$HOME/.volta/bin"; do [ -x "$p/node" ] && export PATH="$p:$PATH"; done
fi
if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "Maestro needs Node.js (free). Opening the download page…"
  echo "Install the LTS version, then double-click 'Start Maestro' again."
  open "https://nodejs.org/en/download"
  read -n 1 -s -r -p "Press any key to close."
  exit 1
fi
node bin/maestro.js start
