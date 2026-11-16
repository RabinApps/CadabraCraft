#!/usr/bin/env bash
# Builds the trimmed Java runtime that runs EPUBCheck inside the app (jlink), into
# apps/desktop/src-tauri/binaries/jre/<arch>/ (gitignored), one folder per CPU: aarch64 and x86_64.
# Usage: ./scripts/build-jre.sh [--all]
#   default: the host CPU, from the JDK in $JDK_HOME, else the Temurin 17 JDK that java_home or JAVA_HOME point at.
#   --all:   every CPU the release builds (macOS universal needs both; Linux x86_64), from pinned Temurin 17 downloads.
# A downloaded JDK is checked against the sha256 pinned below; a mismatch aborts. The JDK's own legal/ texts are copied to
# binaries/licenses/ (OpenJDK is GPLv2 with the Classpath Exception; the runtime is linked from its modules).
# After building, the runtime is proven by running EPUBCheck with it on the sample EPUB when out/sample.epub exists.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=apps/desktop/src-tauri/binaries
# Modules found with jdeps over epubcheck.jar and lib/*.jar, plus the ones its XML, image and locale code loads at run time.
MODULES=java.base,java.xml,java.desktop,java.sql,java.logging,java.naming,java.security.jgss,java.compiler,jdk.unsupported,jdk.charsets,jdk.localedata

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

sha256() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }

# cpu | Temurin 17 archive URL | pinned sha256 (the release's published checksum)
pin_for() {
  case "$1" in
    # Temurin 17.0.21+9 for macOS (the only place --all runs; Linux builds with the JDK that setup-java installs). The sha256 values
    # were computed from the downloaded files on 2026-11-12 and match the digests GitHub publishes for the release assets.
    aarch64) echo "https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.21%2B9/OpenJDK17U-jdk_aarch64_mac_hotspot_17.0.21_9.tar.gz 78b08c7f5a0598242d5719c022e19479cb4a3aa45c37c19726a757a469ed1c15" ;;
    x86_64) echo "https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.21%2B9/OpenJDK17U-jdk_x64_mac_hotspot_17.0.21_9.tar.gz 868f5c672b3389fdbe48e44f94ae170f01668b1401360944fc7159d7cc9772cc" ;;
    *) echo "No pinned Temurin JDK for $1 yet (see scripts/build-jre.sh)" >&2; return 1 ;;
  esac
}

jlink_runtime() { # jlink_runtime <jdk home> <cpu>
  local jdk=$1 cpu=$2 dest="$OUT/jre/$2"
  [ -x "$jdk/bin/jlink" ] && [ -d "$jdk/jmods" ] || { echo "$jdk is not a JDK with jmods (needed by jlink)" >&2; return 1; }
  rm -rf "$dest.partial"
  mkdir -p "$OUT/jre" "$OUT/licenses"
  "$jdk/bin/jlink" --module-path "$jdk/jmods" --add-modules "$MODULES" \
    --strip-debug --no-header-files --no-man-pages --compress=2 --output "$dest.partial"
  # jlink writes read-only and some unreadable files (lib/modules, legal/); the Tauri build copies this folder into target/ on every build and could not overwrite them.
  chmod -R u+rw "$dest.partial"
  rm -rf "$dest"
  mv "$dest.partial" "$dest"
  [ -f "$jdk/legal/java.base/LICENSE" ] && cp "$jdk/legal/java.base/LICENSE" "$OUT/licenses/OpenJDK-LICENSE.txt"
  [ -f "$jdk/legal/java.base/ASSEMBLY_EXCEPTION" ] && cp "$jdk/legal/java.base/ASSEMBLY_EXCEPTION" "$OUT/licenses/OpenJDK-ASSEMBLY_EXCEPTION.txt"
  # The JDK's license files are read-only; the Tauri build copies licenses/ into target/ on every build and could not overwrite them.
  chmod u+rw "$OUT"/licenses/OpenJDK-*.txt 2>/dev/null || true
  echo "Built $dest ($(du -sh "$dest" | cut -f1))"
}

host_cpu() { case "$(uname -m)" in arm64|aarch64) echo aarch64 ;; x86_64|amd64) echo x86_64 ;; *) echo "unsupported CPU $(uname -m)" >&2; return 1 ;; esac; }

local_jdk() {
  if [ -n "${JDK_HOME:-}" ]; then echo "$JDK_HOME"
  elif command -v /usr/libexec/java_home >/dev/null 2>&1 && /usr/libexec/java_home -v 17 >/dev/null 2>&1; then /usr/libexec/java_home -v 17
  elif [ -n "${JAVA_HOME:-}" ]; then echo "$JAVA_HOME"
  else echo "Set JDK_HOME to a Temurin 17 JDK (with jmods), or use --all" >&2; return 1; fi
}

fetch_jdk() { # fetch_jdk <cpu> -> prints the extracted JDK home
  local cpu=$1 line url want got
  line=$(pin_for "$cpu") || return 1
  url=${line%% *}; want=${line##* }
  curl -fL --retry 5 --retry-delay 5 --retry-all-errors -o "$TMP/jdk-$cpu.tar.gz" "$url"
  got=$(sha256 "$TMP/jdk-$cpu.tar.gz")
  [ "$got" = "$want" ] || { echo "sha256 mismatch for the $cpu JDK: got $got" >&2; return 1; }
  mkdir -p "$TMP/jdk-$cpu"
  tar -xzf "$TMP/jdk-$cpu.tar.gz" -C "$TMP/jdk-$cpu"
  local home
  home=$(find "$TMP/jdk-$cpu" -maxdepth 4 -type d -name jmods -print -quit)
  [ -n "$home" ] || { echo "no jmods folder in the $cpu JDK archive" >&2; return 1; }
  dirname "$home"
}

if [ "${1:-}" = "--all" ]; then
  for cpu in aarch64 x86_64; do
    jlink_runtime "$(fetch_jdk "$cpu")" "$cpu"
  done
else
  jlink_runtime "$(local_jdk)" "$(host_cpu)"
fi

# Proof: the runtime for this CPU runs EPUBCheck on the sample EPUB.
CPU=$(host_cpu)
if [ -x "$OUT/jre/$CPU/bin/java" ] && [ -f "$OUT/epubcheck/epubcheck.jar" ] && [ -f out/sample.epub ]; then
  "$OUT/jre/$CPU/bin/java" -jar "$OUT/epubcheck/epubcheck.jar" out/sample.epub | tail -3
fi
