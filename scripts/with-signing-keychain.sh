#!/usr/bin/env bash
# Runs a command with the Developer ID certificate available to codesign, then removes it again.
# The certificate (base64 .p12) is imported into a temporary keychain that is put first in the search list and
# deleted when the command ends; the previous search list is restored. It must not stay behind: tauri-action imports
# the same identity itself, and a second copy in the search list would make codesign ambiguous.
# Usage: APPLE_CERTIFICATE=... APPLE_CERTIFICATE_PASSWORD=... ./scripts/with-signing-keychain.sh <command> [args...]   (macOS only)
set -euo pipefail
[ "$(uname)" = Darwin ] || { echo "with-signing-keychain.sh runs on macOS only" >&2; exit 1; }
: "${APPLE_CERTIFICATE:?APPLE_CERTIFICATE is not set}"
: "${APPLE_CERTIFICATE_PASSWORD:?APPLE_CERTIFICATE_PASSWORD is not set}"
[ "$#" -ge 1 ] || { echo "usage: with-signing-keychain.sh <command> [args...]" >&2; exit 1; }

tmp=${RUNNER_TEMP:-${TMPDIR:-/tmp}}
kc="$tmp/signing.keychain-db"
kc_pass=$(uuidgen)
p12="$tmp/signing.p12"
previous=$(security list-keychains -d user | tr -d '"' | xargs)
cleanup() {
  # shellcheck disable=SC2086
  security list-keychains -d user -s $previous || true
  security delete-keychain "$kc" 2>/dev/null || true
  rm -f "$p12"
}
trap cleanup EXIT
(umask 077 && printf '%s' "$APPLE_CERTIFICATE" | base64 --decode > "$p12")
security create-keychain -p "$kc_pass" "$kc"
security set-keychain-settings -lut 3600 "$kc"
security unlock-keychain -p "$kc_pass" "$kc"
security import "$p12" -k "$kc" -P "$APPLE_CERTIFICATE_PASSWORD" -T /usr/bin/codesign
security set-key-partition-list -S apple-tool:,apple: -s -k "$kc_pass" "$kc" >/dev/null
# shellcheck disable=SC2086
security list-keychains -d user -s "$kc" $previous
"$@"
