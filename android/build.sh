#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
: "${ANDROID_HOME:?Set ANDROID_HOME to the Android SDK directory}"
: "${SIGNING_KEYSTORE:?Set SIGNING_KEYSTORE to a private keystore outside the repository}"
: "${SIGNING_STORE_PASSWORD:?Set SIGNING_STORE_PASSWORD}"
: "${SIGNING_KEY_PASSWORD:=$SIGNING_STORE_PASSWORD}"
export SIGNING_STORE_PASSWORD SIGNING_KEY_PASSWORD
TOOLS="$ANDROID_HOME/build-tools/35.0.0"
PLATFORM="$ANDROID_HOME/platforms/android-35/android.jar"
BUILD="$ROOT/android/build"
rm -rf "$BUILD"
mkdir -p "$BUILD/assets/www" "$BUILD/classes" "$BUILD/dex"
for file in index.html app.js core.js survey.js i18n.js charts.js data.js government.js route-worker.js storage.js upload.js supabase-config.js style.css manifest.json icon-192.png icon-512.png; do
    cp "$ROOT/$file" "$BUILD/assets/www/"
done
cp -R "$ROOT/vendor" "$ROOT/data" "$BUILD/assets/www/"
"$TOOLS/aapt2" compile --dir "$ROOT/android/res" -o "$BUILD/resources.zip"
"$TOOLS/aapt2" link -o "$BUILD/base.apk" -I "$PLATFORM" --manifest "$ROOT/android/AndroidManifest.xml" -A "$BUILD/assets" "$BUILD/resources.zip"
javac -encoding UTF-8 -source 8 -target 8 -bootclasspath "$PLATFORM:$TOOLS/core-lambda-stubs.jar" -d "$BUILD/classes" "$ROOT/android/src/io/github/c933103/passengercount/MainActivity.java"
find "$BUILD/classes" -name '*.class' -print0 | xargs -0 "$TOOLS/d8" --lib "$PLATFORM" --min-api 26 --output "$BUILD/dex"
cp "$BUILD/base.apk" "$BUILD/unsigned.apk"
(cd "$BUILD/dex" && zip -q "$BUILD/unsigned.apk" classes.dex)
"$TOOLS/zipalign" -f 4 "$BUILD/unsigned.apk" "$BUILD/aligned.apk"
"$TOOLS/apksigner" sign --ks "$SIGNING_KEYSTORE" --ks-key-alias "${SIGNING_KEY_ALIAS:-passengercount}" --ks-pass env:SIGNING_STORE_PASSWORD --key-pass env:SIGNING_KEY_PASSWORD --out "$BUILD/PassengerCount.apk" "$BUILD/aligned.apk"
"$TOOLS/apksigner" verify --verbose "$BUILD/PassengerCount.apk"
printf 'Built %s\n' "$BUILD/PassengerCount.apk"
