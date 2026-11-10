#!/usr/bin/env bash
# Stages EPUBCheck for the app bundle: copies the jar and its lib/ into apps/desktop/src-tauri/binaries/epubcheck/ (gitignored) and its
# license texts into binaries/licenses/. Fetches EPUBCheck first (scripts/fetch-epubcheck.sh, a pinned and checked download) when
# tools/ does not have it. Usage: ./scripts/stage-epubcheck.sh
# The Java runtime that runs it is built by scripts/build-jre.sh.
set -euo pipefail
V=5.4.0
cd "$(dirname "$0")/.."
./scripts/fetch-epubcheck.sh
SRC=tools/epubcheck-$V
OUT=apps/desktop/src-tauri/binaries
rm -rf "$OUT/epubcheck.partial"
mkdir -p "$OUT/epubcheck.partial" "$OUT/licenses"
cp "$SRC/epubcheck.jar" "$OUT/epubcheck.partial/"
cp -R "$SRC/lib" "$OUT/epubcheck.partial/lib"
cp "$SRC/LICENSE.txt" "$OUT/licenses/EPUBCheck-LICENSE.txt"
cp "$SRC/THIRD-PARTY.txt" "$OUT/licenses/EPUBCheck-THIRD-PARTY.txt"
if [ -d "$SRC/licenses" ]; then
  for f in "$SRC"/licenses/*; do [ -f "$f" ] && cp "$f" "$OUT/licenses/EPUBCheck-dep-$(basename "$f")"; done
fi
chmod -R u+rw "$OUT/epubcheck.partial" "$OUT"/licenses/EPUBCheck-*
rm -rf "$OUT/epubcheck"
mv "$OUT/epubcheck.partial" "$OUT/epubcheck"
echo "Staged EPUBCheck $V in $OUT/epubcheck"
