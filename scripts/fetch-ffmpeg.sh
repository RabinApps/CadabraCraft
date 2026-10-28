#!/usr/bin/env bash
# Builds a minimal, LGPL-only ffmpeg (bundled as a Tauri sidecar for the M4B audiobook) into
# apps/desktop/src-tauri/binaries/ (gitignored), with the licence text the build ships.
# Usage: ./scripts/fetch-ffmpeg.sh [--all]
# Default: the host target triple only. --all: every triple a macOS release machine can make (arm64 and x64, then a
# universal binary with lipo). Windows and Linux are built on their own machines (CI does this).
# The source tarball is pinned to a sha256 below (and was checked against the FFmpeg release signing key,
# FCF9 86EA 15E6 E293 A564 4F10 B432 2F04 D676 58D8); a mismatch aborts before anything is built or placed. Set
# FFMPEG_TARBALL to an already downloaded copy of the tarball to build offline; it is checked against the same pin.
#
# Why build instead of download: no trustworthy prebuilt LGPL-only ffmpeg exists for macOS, and a build with only the
# parts we use (WAV/FLAC in, AAC and the MP4/M4B writer out, chapters and a cover picture) is about 2 MB instead of
# 100+ MB and has no GPL code to audit. Never add --enable-gpl, --enable-nonfree or --enable-version3 here: the
# licence of the app (Apache-2.0 with the Commons Clause) cannot ship them.
#
# Windows builds with MSYS2's MinGW-w64 gcc (run this script from an MSYS2 MINGW64 shell, or Git Bash with that gcc
# first on PATH); Linux links statically so the program runs on any distribution.
set -euo pipefail
FFMPEG_V=9.0.2
FFMPEG_SHA256=8c3850283eb25fa026482078a04051e0be17347b09ef81a0849bec15a96e002e
cd "$(dirname "$0")/../apps/desktop/src-tauri"
OUT=binaries
mkdir -p "$OUT/licenses"

# One scratch dir per run, removed on every exit path (failed download, hash mismatch, failed build).
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

sha256() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }
jobs() { getconf _NPROCESSORS_ONLN 2>/dev/null || echo 2; }

SRC=""
fetch_source() { # unpacks the pinned tarball once per run into $TMP/src
  [ -n "$SRC" ] && return 0
  local tarball=${FFMPEG_TARBALL:-$TMP/ffmpeg-$FFMPEG_V.tar.xz}
  if [ ! -f "$tarball" ]; then
    curl -fL -o "$tarball" "https://ffmpeg.org/releases/ffmpeg-$FFMPEG_V.tar.xz"
  fi
  local got; got=$(sha256 "$tarball")
  [ "$got" = "$FFMPEG_SHA256" ] || { echo "sha256 mismatch for ffmpeg-$FFMPEG_V.tar.xz: got $got" >&2; return 1; }
  mkdir -p "$TMP/src"
  tar -xJf "$tarball" -C "$TMP/src" --strip-components=1
  SRC="$TMP/src"
}

# Only what the M4B needs: lossless parts in (FLAC, WAV), the chapter file, a PNG or JPEG cover (copied, not decoded
# again), AAC out, the MP4 writer for audiobooks (`ipod`), and the few filters the format conversion inserts itself.
# The MP4 reader and AAC decoder are there only so `ffmpeg -i book.m4b` can describe a finished file (the tests do).
# x86 assembly is off: it needs nasm, and the speedup is nothing for narration-sized AAC encodes.
# zlib (permissive licence, the system copy) is what the PNG decoder needs to read a cover's size; autodetect is off, so
# it must be asked for. Linux and Windows builds need its static library (zlib1g-dev, mingw-w64-x86_64-zlib).
COMMON=(
  --disable-everything --disable-autodetect --disable-network --disable-doc --disable-debug
  --disable-ffplay --disable-ffprobe --disable-avdevice --disable-swscale
  --disable-gpl --disable-nonfree --disable-version3
  --enable-zlib
  --enable-protocol=file
  --enable-demuxer=concat,flac,wav,ffmetadata,image2,png_pipe,jpeg_pipe,mov
  --enable-muxer=ipod
  --enable-decoder=flac,pcm_s16le,png,mjpeg,aac
  --enable-parser=flac,aac,png,mjpeg
  --enable-encoder=aac
  --enable-filter=abuffer,abuffersink,aformat,aresample,anull
)

build_ffmpeg() { # build_ffmpeg <triple>
  local triple=$1 exe="" flags=("${COMMON[@]}")
  local dest="$OUT/ffmpeg-$triple"
  [[ $triple == *windows* ]] && { exe=".exe"; dest="$dest.exe"; }
  [ -f "$dest" ] && return 0
  local host; host=$(rustc -vV | sed -n 's/^host: //p')
  case "$triple" in
    aarch64-apple-darwin | x86_64-apple-darwin)
      local arch=arm64; [[ $triple == x86_64* ]] && arch=x86_64
      flags+=(--arch="$arch")
      [ "$arch" = x86_64 ] && flags+=(--disable-x86asm)
      if [ "$triple" != "$host" ]; then flags+=(--enable-cross-compile --target-os=darwin --cc="clang -arch $arch"); fi
      ;;
    x86_64-unknown-linux-gnu) flags+=(--arch=x86_64 --disable-x86asm --extra-ldflags=-static) ;;
    x86_64-pc-windows-msvc) flags+=(--arch=x86_64 --disable-x86asm --target-os=mingw32 --extra-ldflags=-static) ;;
    *) echo "No ffmpeg build recipe for target $triple" >&2; return 1 ;;
  esac
  fetch_source
  local build="$TMP/build-$triple"
  mkdir -p "$build"
  (cd "$build" && "$SRC/configure" "${flags[@]}" && make -j"$(jobs)" ffmpeg"$exe")
  # An LGPL-only build says so: a GPL or nonfree configure would print it here, and the build must not ship.
  local conf; conf=$("$build/ffmpeg$exe" -hide_banner -buildconf 2>/dev/null || true)
  if [ "$triple" = "$host" ] || [[ $triple == *apple* && $host == *apple* ]]; then
    case "$conf" in *--enable-gpl* | *--enable-nonfree* | *--enable-version3*) echo "refusing a non-LGPL build" >&2; return 1 ;; esac
  fi
  strip "$build/ffmpeg$exe" 2>/dev/null || true
  cp "$build/ffmpeg$exe" "$dest.partial" # publish atomically so an interrupted run never leaves a half file
  chmod +x "$dest.partial"
  mv "$dest.partial" "$dest"
}

fetch_licenses() {
  [ -f "$OUT/licenses/FFmpeg-LGPL-2.1.txt" ] && return 0
  fetch_source
  cp "$SRC/COPYING.LGPLv2.1" "$OUT/licenses/FFmpeg-LGPL-2.1.txt"
}

if [ "${1:-}" = "--all" ]; then
  for t in aarch64-apple-darwin x86_64-apple-darwin; do build_ffmpeg "$t"; done
  if command -v lipo >/dev/null 2>&1; then # tauri build --target universal-apple-darwin wants one fat sidecar
    lipo -create -output "$OUT/ffmpeg-universal-apple-darwin" "$OUT/ffmpeg-aarch64-apple-darwin" "$OUT/ffmpeg-x86_64-apple-darwin"
  fi
else
  build_ffmpeg "$(rustc -vV | sed -n 's/^host: //p')"
fi
fetch_licenses
