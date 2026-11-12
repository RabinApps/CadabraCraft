#!/usr/bin/env bash
# Signs every Mach-O file in the bundled Java runtime (apps/desktop/src-tauri/binaries/jre/<cpu>/) with the hardened
# runtime and a secure timestamp, as notarization requires. Executables get the JIT entitlements from
# apps/desktop/src-tauri/entitlements/java.entitlements.plist; libraries are signed without entitlements.
# Usage: ./scripts/sign-jre.sh "<Developer ID Application identity>"   (macOS only; run after build-jre.sh, before tauri build)
# The identity must already be in a keychain codesign can use.
set -euo pipefail
cd "$(dirname "$0")/.."
IDENTITY=${1:?usage: sign-jre.sh <signing identity>}
JRE=apps/desktop/src-tauri/binaries/jre
ENT=apps/desktop/src-tauri/entitlements/java.entitlements.plist
[ "$(uname)" = Darwin ] || { echo "sign-jre.sh runs on macOS only" >&2; exit 1; }
[ -d "$JRE" ] || { echo "no $JRE; run scripts/build-jre.sh first" >&2; exit 1; }

is_macho() { file -b "$1" | grep -q 'Mach-O'; }
count=0
# Libraries first, then executables, so a launcher is signed after what it loads.
while IFS= read -r f; do
  is_macho "$f" || continue
  case "$(file -b "$f")" in
    *executable*) continue ;;
  esac
  codesign --force --options runtime --timestamp --sign "$IDENTITY" "$f"
  count=$((count + 1))
done < <(find "$JRE" -type f)
while IFS= read -r f; do
  is_macho "$f" || continue
  case "$(file -b "$f")" in
    *executable*) ;;
    *) continue ;;
  esac
  codesign --force --options runtime --timestamp --entitlements "$ENT" --sign "$IDENTITY" "$f"
  count=$((count + 1))
done < <(find "$JRE" -type f)
echo "signed $count files in $JRE"
