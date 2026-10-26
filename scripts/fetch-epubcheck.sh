#!/usr/bin/env bash
# Downloads EPUBCheck into tools/ (gitignored). Usage: ./scripts/fetch-epubcheck.sh
set -euo pipefail
V=5.4.0
cd "$(dirname "$0")/.."
[ -d tools/epubcheck-$V ] && exit 0
mkdir -p tools && curl -fL -o tools/epubcheck.zip "https://github.com/w3c/epubcheck/releases/download/v$V/epubcheck-$V.zip"
unzip -q tools/epubcheck.zip -d tools && rm tools/epubcheck.zip
