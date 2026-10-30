#!/usr/bin/env bash
# Seeds the corpus and runs the cargo-fuzz targets (apps/desktop/src-tauri/fuzz).
#   scripts/perf/fuzz.sh [target|all] [seconds]     default: all, 20 seconds each
# Needs cargo-fuzz and a nightly toolchain (`cargo install cargo-fuzz`, `rustup toolchain install nightly`).
# Crashes land in apps/desktop/src-tauri/fuzz/artifacts/<target>/; a crash makes this script exit non-zero.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FUZZ="$ROOT/apps/desktop/src-tauri/fuzz"
TARGETS=(docx_archive docx_xml docx_import wav font_family image_size typst_frame project_resolve)
WHICH="${1:-all}"
SECONDS_PER="${2:-20}"
# AddressSanitizer is the default (it finds out-of-bounds reads and use-after-free in unsafe code and dependencies). On the
# macOS 27 beta its runtime hangs at start-up (stuck in AsanInitInternal), so macOS defaults to no sanitizer: panics,
# failed assertions in the targets, stack overflows, OOM and timeouts are still found. Override with
# FUZZ_SANITIZER=address|none|memory|thread.
if [ -z "${FUZZ_SANITIZER:-}" ]; then
  if [ "$(uname -s)" = "Darwin" ]; then FUZZ_SANITIZER=none; else FUZZ_SANITIZER=address; fi
fi

seed() {
  local t="$1" dir="$FUZZ/corpus/$1"
  mkdir -p "$dir"
  case "$t" in
    docx_archive | docx_import)
      cp "$ROOT"/fixtures/docx/*.docx "$dir"/ 2>/dev/null || true
      ;;
    docx_xml)
      for f in "$ROOT"/fixtures/docx/*.docx; do
        unzip -p "$f" word/document.xml >"$dir/$(basename "$f" .docx).xml" 2>/dev/null || rm -f "$dir/$(basename "$f" .docx).xml"
      done
      ;;
    wav)
      # RIFF/WAVE, a 16-bit mono 22.05 kHz fmt chunk, 8 bytes of data.
      printf 'RIFF\x2c\x00\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00\x22\x56\x00\x00\x44\xac\x00\x00\x02\x00\x10\x00data\x08\x00\x00\x00\x01\x00\x02\x00\x03\x00\x04\x00' >"$dir/seed.wav"
      ;;
    typst_frame)
      # 4-byte little-endian header length, then the JSON header, no files.
      h='{"source":"= Hi","pdfA":false,"files":[]}'
      printf "\\x$(printf %02x ${#h})\\x00\\x00\\x00%s" "$h" >"$dir/seed-compile.bin"
      ;;
    font_family)
      # Smallest thing that passes the magic check: the importer's table directory parser does the rest.
      printf '\x00\x01\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00' >"$dir/seed.ttf"
      ;;
    image_size)
      printf '\x00\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x10\x00\x00\x00\x10\x08\x00\x00\x00\x00' >"$dir/seed-png.bin"
      printf '\x01GIF89a\x10\x00\x10\x00' >"$dir/seed-gif.bin"
      ;;
    project_resolve)
      printf 'manuscript/001-chapter-1.json' >"$dir/seed-ok.txt"
      printf 'manuscript/../../etc/passwd' >"$dir/seed-dotdot.txt"
      printf 'manuscript/escape/x' >"$dir/seed-link.txt"
      ;;
  esac
}

if [ "$WHICH" = "all" ]; then run=("${TARGETS[@]}"); else run=("$WHICH"); fi
cd "$FUZZ"
failed=0
for t in "${run[@]}"; do
  seed "$t"
  echo "== fuzz $t for ${SECONDS_PER}s"
  if ! cargo +nightly fuzz run --sanitizer "$FUZZ_SANITIZER" "$t" -- "-max_total_time=$SECONDS_PER" -timeout=30 -rss_limit_mb=4096; then
    echo "!! $t failed (see $FUZZ/artifacts/$t)"
    failed=1
  fi
done
exit $failed
