#!/usr/bin/env bash
# Downloads enwik8 (first 100,000,000 bytes of an English Wikipedia XML dump, Matt Mahoney's Large Text Compression
# Benchmark, Wikipedia text under CC BY-SA) into tools/enwik8/ (gitignored). Used by the large-input tests
# (packages/import-docx/test/large-input.test.ts, packages/mcp/test/large-input.test.ts); they skip without it,
# or fail when REQUIRE_ENWIK8=1. Usage: ./scripts/fetch-enwik8.sh
# Works on macOS, Linux and Windows (Git Bash / MSYS / WSL); needs curl plus any one zip extractor and a SHA-1 tool.
set -euo pipefail
cd "$(dirname "$0")/.."
SHA1=57b8363b814821dc9d47aa4d41f58733519076b2
SIZE=100000000
[ -f tools/enwik8/enwik8 ] && [ "$(wc -c < tools/enwik8/enwik8 | tr -d ' ')" = "$SIZE" ] && exit 0

sha1_of() { # sha1_of <file>
  if command -v sha1sum >/dev/null 2>&1; then sha1sum "$1" | cut -d' ' -f1
  elif command -v shasum >/dev/null 2>&1; then shasum -a 1 "$1" | cut -d' ' -f1
  elif command -v python3 >/dev/null 2>&1; then python3 -I -c 'import hashlib, sys; print(hashlib.sha1(open(sys.argv[1], "rb").read()).hexdigest())' "$1"
  else echo "No SHA-1 tool found (sha1sum, shasum or python3)." >&2; return 1
  fi
}

extract_zip() { # extract_zip <zip> <dest>
  local zip=$1 dest=$2
  if command -v unzip >/dev/null 2>&1; then unzip -q -o "$zip" -d "$dest"
  elif command -v bsdtar >/dev/null 2>&1; then bsdtar -xf "$zip" -C "$dest"
  elif command -v python3 >/dev/null 2>&1; then python3 -I -c 'import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])' "$zip" "$dest"
  else echo "No zip extractor found; install unzip or python3." >&2; return 1
  fi
}

rm -rf tools/enwik8
mkdir -p tools/enwik8
curl -fL -o tools/enwik8/enwik8.zip "https://mattmahoney.net/dc/enwik8.zip"
extract_zip tools/enwik8/enwik8.zip tools/enwik8
rm tools/enwik8/enwik8.zip
GOT=$(sha1_of tools/enwik8/enwik8)
if [ "$GOT" != "$SHA1" ]; then
  echo "enwik8 checksum mismatch: expected $SHA1, got $GOT. Deleting it." >&2
  rm -rf tools/enwik8
  exit 1
fi
echo "enwik8 ready in tools/enwik8/ (SHA-1 verified)"
