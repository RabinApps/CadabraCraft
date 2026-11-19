#!/usr/bin/env bash
# Downloads the sherpa-onnx text-to-speech program (bundled as a Tauri sidecar for the audiobook export) into
# apps/desktop/src-tauri/binaries/ (gitignored), with the licence texts the build ships.
# Usage: ./scripts/fetch-sherpa.sh [--all]
# Default: the host target triple only. --all: every triple the release builds (needs lipo on macOS for the universal binary).
# Every download is checked against the sha256 pinned below; a mismatch aborts. The voices are NOT bundled: the app
# downloads them on request (see "Voice download" in docs/architecture.md).
#
# The static builds are used on purpose: one self-contained executable (ONNX Runtime linked in), so Tauri's
# `externalBin` can place it next to the app with no shared libraries to ship. Their archives are big (200 to 410 MB,
# they hold every sherpa tool); only `bin/sherpa-onnx-offline-tts` is kept. The Windows build is the static-CRT (MT)
# one so it needs no Visual C++ runtime on the user's machine.
set -euo pipefail
SHERPA_V=2.0.1
HERE=$(cd "$(dirname "$0")" && pwd)
cd "$HERE/../apps/desktop/src-tauri"
OUT=binaries
mkdir -p "$OUT/licenses"

# One scratch dir per run, removed on every exit path (failed download, hash mismatch, bad archive).
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

sha256() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }

PY=$(command -v python3 || command -v python || true)
[ -n "$PY" ] || { echo "python3 is needed to unpack the .tar.bz2 archive" >&2; exit 1; }

# triple (Tauri's name) | release asset | pinned sha256 (the digest GitHub publishes for the release asset; the macOS
# arm64 one was also checked against the downloaded file, which was run with Piper and Kokoro voices)
asset_for() {
  case "$1" in
    aarch64-apple-darwin) echo "sherpa-onnx-v$SHERPA_V-osx-arm64-static.tar.bz2 b50c214d939e22c7cd776ed6efc35c7d58dba943762bbd72438a638468cec1b6" ;;
    x86_64-apple-darwin) echo "sherpa-onnx-v$SHERPA_V-osx-x64-static.tar.bz2 745660d30b3c2fab4aafba1838b2f01e04d2c0c6b92d61bfe6e64d72ee110372" ;;
    x86_64-pc-windows-msvc) echo "sherpa-onnx-v$SHERPA_V-win-x64-static-MT-Release.tar.bz2 58c810ac46f20e3828968175606063a31df4cff21a1931fe5b69a03e70c5a5b7" ;;
    x86_64-unknown-linux-gnu) echo "sherpa-onnx-v$SHERPA_V-linux-x64-static.tar.bz2 8b34cf773b65e4be3e7ace12fb6a65fcd8f4e8fe06516ae9b7bcaf405dcb308c" ;;
    aarch64-unknown-linux-gnu) echo "sherpa-onnx-v$SHERPA_V-linux-aarch64-static.tar.bz2 fd87d4052e3a7c0040447e84157a2133e192b04d672a98f1187f9c27a2b17b74" ;; # the digest GitHub publishes for the asset (CI runner is arm64)
    *) echo "No pinned sherpa-onnx build for target $1" >&2; return 1 ;;
  esac
}

# Reads the archive as a stream (no shell tar needed: Git Bash on Windows has no bzip2) and keeps only bin/<name>.
extract_bin() { # extract_bin <archive> <program name> <dest>
  "$PY" -I -c '
import os, sys, tarfile
archive, name, dest = sys.argv[1:4]
with tarfile.open(archive, "r|bz2") as t:
    for m in t:
        parts = m.name.split("/")
        if m.isfile() and len(parts) >= 2 and parts[-2] == "bin" and parts[-1] == name:
            src = t.extractfile(m)
            with open(dest, "wb") as out:
                while chunk := src.read(1 << 20):
                    out.write(chunk)
            sys.exit(0)
sys.exit("bin/" + name + " is not in " + archive)
' "$@"
}

fetch_file() { # fetch_file <url> <sha256> <dest>
  local tmp="$TMP/$(basename "$3")"
  curl -fL --retry 5 --retry-delay 5 --retry-all-errors -o "$tmp" "$1"
  local got; got=$(sha256 "$tmp")
  [ "$got" = "$2" ] || { echo "sha256 mismatch for $1: got $got" >&2; return 1; }
  mv "$tmp" "$3"
}

fetch_licenses() {
  [ -f "$OUT/licenses/Sherpa-onnx-LICENSE.txt" ] && [ -f "$OUT/licenses/Onnxruntime-LICENSE.txt" ] && return 0
  # sherpa-onnx (Apache-2.0) and ONNX Runtime (MIT, linked into the static program). The archives carry no licence files.
  fetch_file "https://raw.githubusercontent.com/k2-fsa/sherpa-onnx/v$SHERPA_V/LICENSE" cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30 "$OUT/licenses/Sherpa-onnx-LICENSE.txt"
  # The ONNX Runtime repository no longer serves its LICENSE (github.com/microsoft/onnxruntime answers 404, which failed the
  # CI fetch), so the MIT text is kept in the repo (scripts/vendor/) and checked against the same pinned digest.
  local vendored="$HERE/vendor/Onnxruntime-LICENSE.txt"
  [ "$(sha256 "$vendored")" = 2f07c72751aed99790b8a4869cf2311df85a860b22ded05fa22803587a48922c ] || { echo "sha256 mismatch for $vendored" >&2; return 1; }
  cp "$vendored" "$OUT/licenses/Onnxruntime-LICENSE.txt"
}

fetch_sherpa() { # fetch_sherpa <triple>
  local triple=$1 exe=""
  [[ $triple == *windows* ]] && exe=".exe"
  local dest="$OUT/sherpa-onnx-offline-tts-$triple$exe"
  [ -f "$dest" ] && return 0
  read -r asset want <<<"$(asset_for "$triple")"
  local tmp="$TMP/sherpa-$triple"
  mkdir -p "$tmp"
  curl -fL --retry 5 --retry-delay 5 --retry-all-errors -o "$tmp/$asset" "https://github.com/k2-fsa/sherpa-onnx/releases/download/v$SHERPA_V/$asset"
  local got; got=$(sha256 "$tmp/$asset")
  [ "$got" = "$want" ] || { echo "sha256 mismatch for $asset: got $got" >&2; return 1; }
  extract_bin "$tmp/$asset" "sherpa-onnx-offline-tts$exe" "$dest.partial" # publish atomically so an interrupted run never leaves a half file
  chmod +x "$dest.partial"
  mv "$dest.partial" "$dest"
  rm -rf "$tmp" # these archives are hundreds of MB: do not keep one around while the next target downloads
}

if [ "${1:-}" = "--all" ]; then
  for t in aarch64-apple-darwin x86_64-apple-darwin x86_64-pc-windows-msvc x86_64-unknown-linux-gnu; do fetch_sherpa "$t"; done
  if command -v lipo >/dev/null 2>&1; then # tauri build --target universal-apple-darwin wants one fat sidecar
    lipo -create -output "$OUT/sherpa-onnx-offline-tts-universal-apple-darwin" "$OUT/sherpa-onnx-offline-tts-aarch64-apple-darwin" "$OUT/sherpa-onnx-offline-tts-x86_64-apple-darwin"
  fi
else
  fetch_sherpa "$(rustc -vV | sed -n 's/^host: //p')"
fi
fetch_licenses
