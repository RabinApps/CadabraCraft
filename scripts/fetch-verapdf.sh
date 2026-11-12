#!/usr/bin/env bash
# Installs veraPDF (the PDF/UA and PDF/A validator) into tools/verapdf (gitignored). Usage: ./scripts/fetch-verapdf.sh
# Needs curl, unzip and Java 11+. CI runs it on Linux; locally you can use it or install veraPDF yourself.
# Status: ran locally on 2026-11-02 (veraPDF 1.28.2 installed and validated PDFs); it has not run in CI. SHA256 below was
# pinned on 2026-11-12: the installer was downloaded from software.verapdf.org and from downloads.verapdf.org and both gave
# this hash. veraPDF publishes no checksum, so this is first-download trust over HTTPS, not a comparison with a published value.
set -euo pipefail
V=1.28.2
SHA256="d1693a5f0bf0997180f6d97e8a5568b0cf39e27eee338d439c8adb58435c1e89"
cd "$(dirname "$0")/.."
[ -x tools/verapdf/verapdf ] && exit 0

sha256() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT # never leave an unverified archive behind
curl -fL -o "$work/verapdf.zip" "https://software.verapdf.org/releases/${V%.*}/verapdf-greenfield-$V-installer.zip"
got=$(sha256 "$work/verapdf.zip")
if [ -z "$SHA256" ]; then
  echo "WARNING: verapdf-greenfield-$V-installer.zip is not pinned; sha256 is $got" >&2
elif [ "$got" != "$SHA256" ]; then
  echo "sha256 mismatch for verapdf-greenfield-$V-installer.zip: got $got" >&2
  exit 1
fi
unzip -q "$work/verapdf.zip" -d "$work/unpacked"
jar=$(ls "$work"/unpacked/*/verapdf-izpack-installer-*.jar | head -n 1)

mkdir -p tools
dest=$PWD/tools/verapdf
# IzPack automated install: the validation runtime and the command-line scripts only (no GUI, no sample policies).
cat > "$work/auto-install.xml" <<XML
<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<AutomatedInstallation langpack="eng">
  <com.izforge.izpack.panels.htmlhello.HTMLHelloPanel id="welcome"/>
  <com.izforge.izpack.panels.target.TargetPanel id="install_dir">
    <installpath>$dest</installpath>
  </com.izforge.izpack.panels.target.TargetPanel>
  <com.izforge.izpack.panels.packs.PacksPanel id="sdk_pack_select">
    <pack index="0" name="veraPDF Runtime" selected="true"/>
    <pack index="1" name="veraPDF Mac and *nix Scripts" selected="true"/>
    <pack index="2" name="veraPDF Validation model" selected="true"/>
    <pack index="3" name="veraPDF Documentation" selected="false"/>
    <pack index="4" name="veraPDF Test files" selected="false"/>
    <pack index="5" name="veraPDF GUI" selected="false"/>
  </com.izforge.izpack.panels.packs.PacksPanel>
  <com.izforge.izpack.panels.install.InstallPanel id="install"/>
  <com.izforge.izpack.panels.finish.FinishPanel id="finish"/>
</AutomatedInstallation>
XML
java -jar "$jar" "$work/auto-install.xml"
[ -x "$dest/verapdf" ] || { echo "veraPDF was not installed to $dest" >&2; exit 1; }
"$dest/verapdf" --version
