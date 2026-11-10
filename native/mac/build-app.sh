#!/bin/sh
# Construit « Agenda DCG.app » (+ .zip pour la mise à jour auto, + .dmg pour l'installation).
# Usage : VERSION=2.0.0 ./build-app.sh [--universal]
set -e
cd "$(dirname "$0")"
VERSION="${VERSION:-0.0.0}"
OUT=dist
APP="$OUT/Agenda DCG.app"
ICON_SRC=../assets/icon.png

if [ "$1" = "--universal" ]; then
  swift build -c release --arch arm64 --arch x86_64
  BIN=.build/apple/Products/Release/AgendaDCG
else
  swift build -c release
  BIN=.build/release/AgendaDCG
fi

rm -rf "$OUT" && mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN" "$APP/Contents/MacOS/AgendaDCG"

ICONSET="$OUT/AppIcon.iconset" && mkdir -p "$ICONSET"
for s in 16 32 128 256 512; do
  sips -z $s $s "$ICON_SRC" --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
  sips -z $((s*2)) $((s*2)) "$ICON_SRC" --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns" && rm -rf "$ICONSET"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Agenda DCG</string>
  <key>CFBundleDisplayName</key><string>Agenda DCG</string>
  <key>CFBundleIdentifier</key><string>com.tauwni.agendadcg</string>
  <key>CFBundleExecutable</key><string>AgendaDCG</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundleVersion</key><string>$VERSION</string>
  <key>CFBundleDevelopmentRegion</key><string>fr</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.education</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSPrincipalClass</key><string>NSApplication</string>
</dict></plist>
PLIST

codesign --force --deep --sign - "$APP"
ditto -c -k --keepParent "$APP" "$OUT/Agenda-DCG-Mac.zip"

STAGE="$OUT/dmg" && mkdir -p "$STAGE"
cp -R "$APP" "$STAGE/" && ln -s /Applications "$STAGE/Applications"
hdiutil create -volname "Agenda DCG" -srcfolder "$STAGE" -ov -format UDZO "$OUT/Agenda-DCG-Mac.dmg" >/dev/null
rm -rf "$STAGE"
echo "OK : $OUT"
