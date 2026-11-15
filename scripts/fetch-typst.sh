#!/usr/bin/env bash
# Downloads the Typst CLI (bundled as a Tauri sidecar) and the Inter fonts (bundled as resources) into
# apps/desktop/src-tauri/binaries/ (gitignored). Usage: ./scripts/fetch-typst.sh [--all]
# Default: the host target triple only. --all: every triple the release builds (needs lipo on macOS for the universal binary).
# Every download is checked against the sha256 pinned below; a mismatch aborts.
set -euo pipefail
TYPST_V=0.15.1
INTER_V=4.1
cd "$(dirname "$0")/../apps/desktop/src-tauri"
OUT=binaries
mkdir -p "$OUT/fonts" "$OUT/licenses"

# One scratch dir per run, removed on every exit path (failed download, hash mismatch, bad archive).
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

sha256() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }

# triple (Tauri's name) | release asset | pinned sha256
asset_for() {
  case "$1" in
    aarch64-apple-darwin) echo "typst-aarch64-apple-darwin.tar.xz 48f62ed034aa3a7978309579ac6ca00045e2ef0da73114e8af27cfd8e74dc05a" ;;
    x86_64-apple-darwin) echo "typst-x86_64-apple-darwin.tar.xz 7f9fdd9584866245de9a79e0add8f9236fae6f40a8a45e2c4771ccc14db4e0fa" ;;
    x86_64-pc-windows-msvc) echo "typst-x86_64-pc-windows-msvc.zip 19ce3551153c2fe7ee9fa2f95208310c8f4d3209fedb699e0333faf8913f6736" ;;
    x86_64-unknown-linux-gnu) echo "typst-x86_64-unknown-linux-musl.tar.xz a6d077d0a95eed5a2eba715b2dae06be954f624ccbf85758a03f389ded33118c" ;; # static musl build runs on any glibc
    aarch64-unknown-linux-gnu) echo "typst-aarch64-unknown-linux-musl.tar.xz 5aa8d74a3d906e60ea12a66ac2f37f8eef1b14cbad7182a745e393a10c23dcee" ;; # static musl build, like x86_64
    *) echo "No pinned Typst build for target $1" >&2; return 1 ;;
  esac
}

unzip_to() { # unzip_to <zip> <dest> [members...]; Git Bash on Windows has no unzip
  local zip=$1 dest=$2; shift 2
  if command -v unzip >/dev/null 2>&1; then unzip -q "$zip" "$@" -d "$dest"
  elif command -v bsdtar >/dev/null 2>&1; then bsdtar -xf "$zip" -C "$dest" "$@"
  elif command -v python3 >/dev/null 2>&1; then python3 -I -c 'import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])' "$zip" "$dest"
  else powershell.exe -NoProfile -Command "Expand-Archive -Force -LiteralPath '$(cygpath -w "$zip")' -DestinationPath '$(cygpath -w "$dest")'"
  fi
}

fetch_typst() { # fetch_typst <triple>
  local triple=$1 exe=""
  [[ $triple == *windows* ]] && exe=".exe"
  local dest="$OUT/typst-$triple$exe"
  [ -f "$dest" ] && [ -f "$OUT/licenses/Typst-LICENSE.txt" ] && return 0
  read -r asset want <<<"$(asset_for "$triple")"
  local tmp="$TMP/typst-$triple"
  mkdir -p "$tmp"
  curl -fL -o "$tmp/$asset" "https://github.com/typst/typst/releases/download/v$TYPST_V/$asset"
  local got; got=$(sha256 "$tmp/$asset")
  [ "$got" = "$want" ] || { echo "sha256 mismatch for $asset: got $got" >&2; return 1; }
  if [[ $asset == *.zip ]]; then unzip_to "$tmp/$asset" "$tmp"; else
    command -v xz >/dev/null 2>&1 || { echo "xz is needed to unpack $asset (Debian and Ubuntu: apt install xz-utils)" >&2; return 1; }
    tar -xJf "$tmp/$asset" -C "$tmp"
  fi
  cp "$tmp"/typst-*/LICENSE "$OUT/licenses/Typst-LICENSE.txt" # Apache-2.0 asks that the license and NOTICE travel with redistributions
  cp "$tmp"/typst-*/NOTICE "$OUT/licenses/Typst-NOTICE.txt"
  cp "$tmp"/typst-*/typst$exe "$dest.partial" # publish atomically so an interrupted run never leaves a half file
  chmod +x "$dest.partial"
  mv "$dest.partial" "$dest"
}

fetch_fonts() {
  [ -f "$OUT/fonts/LICENSE.txt" ] && return 0 # copied last, so its presence means the set is complete
  local tmp="$TMP/inter"
  mkdir -p "$tmp"
  curl -fL -o "$tmp/inter.zip" "https://github.com/rsms/inter/releases/download/v$INTER_V/Inter-$INTER_V.zip"
  local got; got=$(sha256 "$tmp/inter.zip")
  [ "$got" = "9883fdd4a49d4fb66bd8177ba6625ef9a64aa45899767dde3d36aa425756b11e" ] || { echo "sha256 mismatch for Inter: got $got" >&2; return 1; }
  unzip_to "$tmp/inter.zip" "$tmp"
  for f in Regular Italic Bold BoldItalic; do cp "$tmp/extras/ttf/Inter-$f.ttf" "$OUT/fonts/"; done
  cp "$tmp/LICENSE.txt" "$OUT/fonts/LICENSE.txt"
}

if [ "${1:-}" = "--all" ]; then
  for t in aarch64-apple-darwin x86_64-apple-darwin x86_64-pc-windows-msvc x86_64-unknown-linux-gnu; do fetch_typst "$t"; done
  if command -v lipo >/dev/null 2>&1; then # tauri build --target universal-apple-darwin wants one fat sidecar
    lipo -create -output "$OUT/typst-universal-apple-darwin" "$OUT/typst-aarch64-apple-darwin" "$OUT/typst-x86_64-apple-darwin"
  fi
else
  if command -v rustc >/dev/null 2>&1; then
    fetch_typst "$(rustc -vV | sed -n 's/^host: //p')"
  else # the JS CI job has no Rust toolchain: Linux only, by CPU
    case "$(uname -m)" in
      x86_64) fetch_typst x86_64-unknown-linux-gnu ;;
      aarch64|arm64) fetch_typst aarch64-unknown-linux-gnu ;;
      *) echo "rustc not found and no Typst build for $(uname -m)" >&2; exit 1 ;;
    esac
  fi
fi
fetch_fonts
