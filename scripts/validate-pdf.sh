#!/usr/bin/env bash
# Validates PDFs with veraPDF. Needs the `verapdf` launcher (on the PATH, $VERAPDF_BIN, or tools/verapdf/verapdf from
# scripts/fetch-verapdf.sh) and Java 11+.
#
# Usage: scripts/validate-pdf.sh [--flavour <ua1|2b|1b|3b|...>]... <file.pdf>...
#   No --flavour: ua1 (PDF/UA-1), plus 2b (PDF/A-2b) when the file's XMP claims PDF/A.
#   --flavour may be repeated; every given flavour is checked for every file.
# Exit status: 0 when every check passes, 1 when a check fails, 2 on a usage error or when verapdf is missing.
set -euo pipefail
cd "$(dirname "$0")/.."

flavours=()
files=()
while [ $# -gt 0 ]; do
  case $1 in
    --flavour) [ $# -ge 2 ] || { echo "--flavour needs a value" >&2; exit 2; }; flavours+=("$2"); shift 2 ;;
    -h|--help) sed -n '2,9p' "$0"; exit 0 ;;
    -*) echo "unknown option $1" >&2; exit 2 ;;
    *) files+=("$1"); shift ;;
  esac
done
[ ${#files[@]} -gt 0 ] || { echo "usage: scripts/validate-pdf.sh [--flavour F]... <file.pdf>..." >&2; exit 2; }

vera=${VERAPDF_BIN:-}
if [ -z "$vera" ]; then
  if command -v verapdf >/dev/null 2>&1; then vera=verapdf
  elif [ -x tools/verapdf/verapdf ]; then vera=$PWD/tools/verapdf/verapdf
  else echo "verapdf not found: install veraPDF (https://verapdf.org/software/) or run scripts/fetch-verapdf.sh" >&2; exit 2
  fi
fi

fail=0
for f in "${files[@]}"; do
  [ -f "$f" ] || { echo "no such file: $f" >&2; exit 2; }
  run=("${flavours[@]+"${flavours[@]}"}")
  if [ ${#run[@]} -eq 0 ]; then
    run=(ua1)
    if grep -aq 'pdfaid:part' "$f"; then run+=(2b); fi
  fi
  for fl in "${run[@]}"; do
    if out=$("$vera" --flavour "$fl" --format text "$f" 2>&1); then
      echo "ok   $f ($fl)"
    else
      echo "FAIL $f ($fl)"
      echo "$out"
      fail=1
    fi
  done
done
exit $fail
