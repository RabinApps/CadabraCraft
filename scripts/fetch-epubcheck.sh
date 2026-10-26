#!/usr/bin/env bash
# Downloads EPUBCheck into tools/ (gitignored). Usage: ./scripts/fetch-epubcheck.sh
# Works on macOS, Linux and Windows (Git Bash / MSYS / WSL); needs curl plus any one zip extractor.
set -euo pipefail
V=5.4.0
cd "$(dirname "$0")/.."
[ -d tools/epubcheck-$V ] && exit 0

extract_zip() { # extract_zip <zip> <dest>
  local zip=$1 dest=$2
  if command -v unzip >/dev/null 2>&1; then
    unzip -q "$zip" -d "$dest"
  elif command -v bsdtar >/dev/null 2>&1; then
    bsdtar -xf "$zip" -C "$dest"
  elif tar --version 2>/dev/null | grep -qi bsdtar; then
    tar -xf "$zip" -C "$dest"
  elif command -v python3 >/dev/null 2>&1; then
    python3 -I -c 'import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])' "$zip" "$dest"
  elif command -v python >/dev/null 2>&1; then
    python -I -c 'import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])' "$zip" "$dest"
  elif command -v powershell.exe >/dev/null 2>&1; then
    powershell.exe -NoProfile -Command "Expand-Archive -Force -LiteralPath '$(cygpath -w "$zip" 2>/dev/null || echo "$zip")' -DestinationPath '$(cygpath -w "$dest" 2>/dev/null || echo "$dest")'"
  elif install_unzip; then
    unzip -q "$zip" -d "$dest"
  else
    echo "No zip extractor found and could not install unzip; install unzip or python3 manually." >&2
    return 1
  fi
}

install_unzip() { # Linux only: install unzip with whichever package manager exists
  local sudo=""
  [ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null 2>&1 && sudo="sudo"
  echo "No zip extractor found; installing unzip..." >&2
  if command -v apt-get >/dev/null 2>&1; then
    $sudo apt-get update && $sudo apt-get install -y unzip
  elif command -v dnf >/dev/null 2>&1; then
    $sudo dnf install -y unzip
  elif command -v yum >/dev/null 2>&1; then
    $sudo yum install -y unzip
  elif command -v apk >/dev/null 2>&1; then
    $sudo apk add unzip
  elif command -v pacman >/dev/null 2>&1; then
    $sudo pacman -S --noconfirm unzip
  elif command -v zypper >/dev/null 2>&1; then
    $sudo zypper install -y unzip
  else
    return 1
  fi
}

mkdir -p tools
curl -fL -o tools/epubcheck.zip "https://github.com/w3c/epubcheck/releases/download/v$V/epubcheck-$V.zip"
extract_zip tools/epubcheck.zip tools
rm tools/epubcheck.zip
