#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
: "${ANDROID_HOME:?Android SDK is required}"
: "${SIGNING_KEYSTORE:?Reuse the existing validation keystore from this job}"
: "${SIGNING_STORE_PASSWORD:?Validation signer password is required}"
: "${SIGNING_KEY_PASSWORD:=$SIGNING_STORE_PASSWORD}"
export SIGNING_STORE_PASSWORD SIGNING_KEY_PASSWORD
TOOLS="$ANDROID_HOME/build-tools/35.0.0"
PLATFORM="$ANDROID_HOME/platforms/android-35/android.jar"
BUILD="$ROOT/android/build/lifecycle-tests"
test -f "$ROOT/android/build/PassengerCount.apk"
test -d "$ROOT/android/build/classes"
mkdir -p "$BUILD/classes" "$BUILD/dex"
"$TOOLS/aapt2" link -o "$BUILD/base.apk" -I "$PLATFORM" --manifest "$ROOT/tests/android/AndroidManifest.xml"
javac -encoding UTF-8 -source 8 -target 8 -bootclasspath "$PLATFORM:$TOOLS/core-lambda-stubs.jar" \
  -classpath "$ROOT/android/build/classes" -d "$BUILD/classes" "$ROOT/tests/android/"*.java
# Target classes are compile-only references, never bundled into the test dex.
(cd "$ROOT/android/build/classes" && zip -qr "$BUILD/target-classpath.jar" .)
find "$BUILD/classes" -name '*.class' -print0 | xargs -0 "$TOOLS/d8" --lib "$PLATFORM" \
  --classpath "$BUILD/target-classpath.jar" --min-api 35 --output "$BUILD/dex"
cp "$BUILD/base.apk" "$BUILD/unsigned.apk"
(cd "$BUILD/dex" && zip -q "$BUILD/unsigned.apk" classes.dex)
"$TOOLS/zipalign" -f 4 "$BUILD/unsigned.apk" "$BUILD/aligned.apk"
"$TOOLS/apksigner" sign --ks "$SIGNING_KEYSTORE" --ks-key-alias "${SIGNING_KEY_ALIAS:-passengercount}" \
  --ks-pass env:SIGNING_STORE_PASSWORD --key-pass env:SIGNING_KEY_PASSWORD \
  --out "$BUILD/PassengerCount-lifecycle-tests.apk" "$BUILD/aligned.apk"
"$TOOLS/apksigner" verify --verbose "$BUILD/PassengerCount-lifecycle-tests.apk"
