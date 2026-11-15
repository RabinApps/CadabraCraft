#!/usr/bin/env bash
# Installs Ace by DAISY (EPUB accessibility checker) into tools/ace (gitignored), outside the pnpm workspace so its build scripts and lockfile stay out of ours.
# Usage: ./scripts/fetch-ace.sh   Needs node and npm. Ace drives headless Chrome through Puppeteer: set PUPPETEER_EXECUTABLE_PATH to an installed Chrome/Chromium to skip Puppeteer's own browser download.
set -euo pipefail
V=1.4.6
cd "$(dirname "$0")/.."
if [ -x tools/ace/node_modules/.bin/ace ] && [ "$(node -p "require('./tools/ace/node_modules/@daisy/ace/package.json').version")" = "$V" ]; then
  # An earlier run left Ace behind but its Chrome may live elsewhere: with PUPPETEER_CACHE_DIR set (CI keeps it per job), fetch it there.
  if [ -n "${PUPPETEER_CACHE_DIR:-}" ] && [ -z "${PUPPETEER_EXECUTABLE_PATH:-}" ] && [ ! -d "$PUPPETEER_CACHE_DIR/chrome-headless-shell" ]; then
    (cd tools/ace && ./node_modules/.bin/puppeteer browsers install chrome-headless-shell)
  fi
  exit 0
fi

mkdir -p tools/ace
echo '{"name":"ace-tool","private":true}' > tools/ace/package.json
# --save-exact pins the version; npm checks every dependency against the integrity hashes it resolves.
npm install --prefix tools/ace --save-exact --no-audit --no-fund "@daisy/ace@$V"
