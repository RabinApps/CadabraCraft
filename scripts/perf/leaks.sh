#!/usr/bin/env bash
# Runs the perfprobe tool under macOS /usr/bin/leaks (--atExit: a leak report when the process ends) and fails if it
# finds any leak. Skips with exit 0 on other systems (Linux: use `valgrind --leak-check=full` or the fuzz targets' ASan).
#   scripts/perf/leaks.sh [book dir]       default: a freshly generated small book in a temporary folder
# Rust frees what it owns at exit only when asked to, so `leaks` reports real unreachable allocations, not "still
# reachable" ones; a report here means memory lost while the project layer was running.
set -euo pipefail

if [ "$(uname -s)" != "Darwin" ] || [ ! -x /usr/bin/leaks ]; then
  echo "leaks: /usr/bin/leaks is macOS only; skipping."
  exit 0
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MANIFEST="$ROOT/apps/desktop/src-tauri/tools/perf/Cargo.toml"
BIN="$ROOT/apps/desktop/src-tauri/tools/perf/target/release"
cargo build --release --manifest-path "$MANIFEST" >/dev/null

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
BOOK="${1:-}"
if [ -z "$BOOK" ]; then
  BOOK="$TMP/book"
  "$BIN/bookgen" --out "$BOOK" --preset small >/dev/null
fi
"$BIN/bookgen" --docx "$TMP/probe.docx" --paragraphs 2000 >/dev/null

LOG="$TMP/leaks.log"
set +e
/usr/bin/leaks --atExit --quiet -- "$BIN/perfprobe" --root "$BOOK" --copy --docx "$TMP/probe.docx" --iters 2 >"$LOG" 2>&1
STATUS=$?
set -e
grep -E "leaks for|Process [0-9]+:|^Leak:" "$LOG" | head -20 || true
if grep -qE "[1-9][0-9]* leaks? for" "$LOG" || [ "$STATUS" -eq 1 ]; then
  echo "leaks: LEAKS FOUND (full report below)"
  cat "$LOG"
  exit 1
fi
if ! grep -qE "0 leaks for" "$LOG"; then
  echo "leaks: no report produced (is the tool allowed to attach? exit $STATUS)"
  cat "$LOG"
  exit 2
fi
echo "leaks: none"
