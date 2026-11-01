#!/bin/bash
# One-line install for Mac and Linux (no Gatekeeper prompts, because curl downloads are not quarantined):
#   curl -fsSL https://raw.githubusercontent.com/Techr-hub/maestrobrain/main/install.sh | bash
set -e
DEST="${MAESTRO_DIR:-$HOME/maestro-brain}"
ZIP_URL="https://github.com/Techr-hub/maestrobrain/archive/refs/heads/main.zip"

for p in /opt/homebrew/bin /usr/local/bin "$HOME/.volta/bin"; do [ -x "$p/node" ] && export PATH="$p:$PATH"; done
if ! command -v node >/dev/null 2>&1; then
  echo "Maestro needs Node.js 18.17+ (free). Install the LTS version from https://nodejs.org, then run this again."
  command -v open >/dev/null && open "https://nodejs.org/en/download"
  exit 1
fi

if [ -f "$DEST/bin/maestro.js" ]; then
  echo "Maestro is already installed in $DEST. Starting it…"
else
  echo "Downloading Maestro into $DEST…"
  TMP="$(mktemp -d)"
  curl -fsSL "$ZIP_URL" -o "$TMP/maestro.zip"
  unzip -q "$TMP/maestro.zip" -d "$TMP"
  SRC="$(find "$TMP" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
  mkdir -p "$DEST" && cp -R "$SRC"/. "$DEST"/
  rm -rf "$TMP"
  chmod +x "$DEST/Start Maestro.command" 2>/dev/null || true
fi

cd "$DEST"
echo "Next time, start Maestro with:  cd \"$DEST\" && npm start"
exec node bin/maestro.js start < /dev/null
