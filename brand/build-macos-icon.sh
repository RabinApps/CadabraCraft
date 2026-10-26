#!/bin/sh
# Builds the macOS app icon (icon.icns) and the 512 px icon.png from cadabracraft-icon-macos.svg.
# Needs rsvg-convert (librsvg) and iconutil (macOS). Run from anywhere; writes into apps/desktop/src-tauri/icons.
set -e
here=$(cd "$(dirname "$0")" && pwd)
out="$here/../apps/desktop/src-tauri/icons"
src="$here/cadabracraft-icon-macos.svg"
work=$(mktemp -d)
set_="$work/AppIcon.iconset"
mkdir "$set_"
for spec in 16:icon_16x16 32:icon_16x16@2x 32:icon_32x32 64:icon_32x32@2x 128:icon_128x128 256:icon_128x128@2x 256:icon_256x256 512:icon_256x256@2x 512:icon_512x512 1024:icon_512x512@2x; do
  px=${spec%%:*}
  name=${spec#*:}
  rsvg-convert -w "$px" -h "$px" "$src" -o "$set_/$name.png"
done
iconutil -c icns "$set_" -o "$out/icon.icns"
rsvg-convert -w 512 -h 512 "$src" -o "$out/icon.png"
rm -rf "$work"
echo "wrote $out/icon.icns and $out/icon.png"
