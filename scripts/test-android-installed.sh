#!/usr/bin/env bash
# One fresh, disposable API35 emulator only. No production signing keys/debug hooks.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
: "${ANDROID_HOME:?Android SDK is required}"
: "${RUNNER_TEMP:?Run in the existing ephemeral CI job}"
[[ "${CI:-}" == "true" ]] || { echo 'Refusing to operate a personal/unspecified device'; exit 2; }
SDKMANAGER="$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager"
AVDMANAGER="$ANDROID_HOME/cmdline-tools/latest/bin/avdmanager"
ADB="$ANDROID_HOME/platform-tools/adb"
EMULATOR="$ANDROID_HOME/emulator/emulator"
IMAGE='system-images;android-35;google_apis;x86_64'
OUT="$ROOT/android/build/lifecycle-evidence"
mkdir -p "$OUT"
TEMP="$(mktemp -d "$RUNNER_TEMP/passenger-api35.XXXXXX")"
export ANDROID_AVD_HOME="$TEMP/avds"
mkdir -p "$ANDROID_AVD_HOME"
NAME="passenger_lifecycle_${GITHUB_RUN_ID:-ci}_${GITHUB_RUN_ATTEMPT:-1}"
SERIAL=emulator-5556
PACKAGE=app.passengercount
RUNNER=app.passengercount.tests/app.passengercount.JournalLifecycleInstrumentation
EMU_PID= GPS_PID= LOG_PID=
adb() { "$ADB" -s "$SERIAL" "$@"; }
cleanup() {
  local code=$?
  if [[ -n "$EMU_PID" ]]; then
    adb shell dumpsys activity services "$PACKAGE" > "$OUT/services-final.txt" 2>&1 || true
    adb logcat -d -v threadtime > "$OUT/logcat-final.txt" 2>&1 || true
  fi
  [[ -z "$GPS_PID" ]] || kill "$GPS_PID" 2>/dev/null || true
  [[ -z "$LOG_PID" ]] || kill "$LOG_PID" 2>/dev/null || true
  # Only the process/device started by this script is stopped. No shared SDK/device cleanup.
  [[ -z "$EMU_PID" ]] || { adb emu kill >/dev/null 2>&1 || true; wait "$EMU_PID" 2>/dev/null || true; }
  printf '%s\n' "$code" > "$OUT/exit-code.txt"
}
trap cleanup EXIT
git -C "$ROOT" rev-parse HEAD HEAD^{tree} > "$OUT/source.txt"
git -C "$ROOT" ls-tree -r HEAD -- android/src android/AndroidManifest.xml app.js record-deletion.js storage.js > "$OUT/production-paths.txt"
sha256sum "$ROOT/android/build/PassengerCount.apk" \
  "$ROOT/android/build/lifecycle-tests/PassengerCount-lifecycle-tests.apk" > "$OUT/apk-sha256.txt"
"$SDKMANAGER" --list_installed > "$OUT/sdk-installed.txt"
# Do not chmod /dev/kvm, change udev rules, or silently fall back to costly emulation.
[[ -r /dev/kvm && -w /dev/kvm ]] || { echo 'KVM is unavailable to this runner; installed validation is blocked' | tee "$OUT/blocker.txt"; exit 2; }
"$SDKMANAGER" 'emulator' "$IMAGE" > "$OUT/sdk-image-install.txt" 2>&1
"$EMULATOR" -version > "$OUT/emulator-version.txt" 2>&1
"$EMULATOR" -accel-check > "$OUT/acceleration.txt" 2>&1
"$ADB" start-server
if "$ADB" devices | grep -q "^$SERIAL[[:space:]]"; then echo 'Selected emulator serial already exists; refusing'; exit 2; fi
printf 'no\n' | "$AVDMANAGER" create avd -n "$NAME" -k "$IMAGE" -p "$TEMP/device" > "$OUT/avd-create.txt" 2>&1
"$EMULATOR" -avd "$NAME" -port 5556 -no-window -no-audio -no-boot-anim -no-snapshot \
  -gpu swiftshader_indirect -accel on > "$OUT/emulator.txt" 2>&1 & EMU_PID=$!
booted=false
for ((i=0;i<180;i++)); do
  if [[ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" == 1 ]]; then booted=true; break; fi
  kill -0 "$EMU_PID" 2>/dev/null || break
  sleep 1
done
$booted || { echo 'Emulator boot did not complete' | tee "$OUT/blocker.txt"; exit 2; }
adb shell getprop ro.build.fingerprint > "$OUT/device-fingerprint.txt"
[[ "$(adb shell getprop ro.build.version.sdk | tr -d '\r')" == 35 ]]
if adb shell pm path "$PACKAGE" | grep -q '^package:'; then echo 'Target already installed; refusing to touch existing data'; exit 2; fi
adb install "$ROOT/android/build/PassengerCount.apk" > "$OUT/install-target.txt"
adb install "$ROOT/android/build/lifecycle-tests/PassengerCount-lifecycle-tests.apk" > "$OUT/install-tests.txt"
adb shell pm grant "$PACKAGE" android.permission.ACCESS_FINE_LOCATION
adb shell pm grant "$PACKAGE" android.permission.ACCESS_COARSE_LOCATION
adb shell dumpsys package "$PACKAGE" > "$OUT/package.txt"
adb logcat -v threadtime > "$OUT/logcat-live.txt" 2>&1 & LOG_PID=$!
(
  for ((i=0;i<420;i++)); do
    longitude="$(awk -v n="$i" 'BEGIN {printf "%.6f", 0.456+n*0.0003}')"
    adb emu geo fix "$longitude" 0.123 >/dev/null 2>&1 || exit
    sleep 1
  done
) & GPS_PID=$!
phase() {
  local name=$1 mode=${2:-cold}
  local opts=()
  [[ "$mode" != attached ]] || opts+=(--no-restart)
  timeout 100s "$ADB" -s "$SERIAL" shell am instrument -w -r "${opts[@]}" -e phase "$name" "$RUNNER" \
    > "$OUT/$name.txt" 2>&1
  cat "$OUT/$name.txt"
  grep -q "PHASE_PASS $name " "$OUT/$name.txt"
  grep -q 'INSTRUMENTATION_CODE: -1' "$OUT/$name.txt"
  ! grep -q 'PHASE_FAIL\|INSTRUMENTATION_FAILED' "$OUT/$name.txt"
}
launch_home() {
  # bootstrap seeded a fresh local-only catalogue and empty Home state first.
  adb shell am start -W -n "$PACKAGE/.MainActivity" > "$OUT/home-launch-$(date +%s).txt"
  sleep 2
}
background_home() {
  # Prevent Activity relaunch from masquerading as a service-triggered restart.
  # Let the unchanged Home page finish its visibility persistence BEFORE fixtures change.
  adb shell input keyevent KEYCODE_HOME
  sleep 1
}
detached() {
  adb shell dumpsys activity instrumentation > "$OUT/instrumentation-detached-$1.txt"
  if grep -q 'ActiveInstrumentation.*app.passengercount' "$OUT/instrumentation-detached-$1.txt"; then
    echo 'Instrumentation still active; cannot claim an ordinary sticky restart'; exit 1
  fi
}
crash_observe() {
  local kind=$1 oldpid=$2 deadline=$((SECONDS+75)) newpid= completed=false
  detached "$kind"
  # Only service starts AFTER this phase's detached SIGKILL count. PID creation
  # precedes onStartCommand, so poll for the required service state as well.
  while ((SECONDS<deadline)); do
    adb logcat -d -v threadtime > "$OUT/logcat-$kind-restarted.txt"
    awk -v marker="SIGKILL_AFTER_DETACH prepare-$kind pid=$oldpid" '
      seen { print }
      index($0,marker) { seen=1 }
    ' "$OUT/logcat-$kind-restarted.txt" > "$OUT/after-death-$kind.txt"
    grep -E "Start proc [0-9]+:$PACKAGE/.*for service.*TrackService" "$OUT/after-death-$kind.txt" \
      > "$OUT/service-starts-$kind.txt" || true
    newpid="$(sed -nE "s/.*Start proc ([0-9]+):$PACKAGE\/.*/\\1/p" "$OUT/service-starts-$kind.txt" | tail -1)"
    adb shell dumpsys activity services "$PACKAGE" > "$OUT/services-$kind-restarted.txt"
    if [[ -n "$newpid" && "$newpid" != "$oldpid" ]]; then
      if [[ "$kind" == valid ]]; then
        if grep -q 'ServiceRecord.*app.passengercount/.TrackService' "$OUT/services-$kind-restarted.txt" \
          && grep -q "app=ProcessRecord{.* $newpid:$PACKAGE/" "$OUT/services-$kind-restarted.txt" \
          && grep -q 'isForeground=true' "$OUT/services-$kind-restarted.txt"; then completed=true; break; fi
      elif ! grep -q 'ServiceRecord.*app.passengercount/.TrackService' "$OUT/services-$kind-restarted.txt"; then
        completed=true; break
      fi
    fi
    sleep 1
  done
  $completed || { echo 'Required service restart/state not observed after detached SIGKILL'; exit 1; }
  printf '%s -> %s\n' "$oldpid" "$newpid" > "$OUT/pid-$kind.txt"
}

phase bootstrap
launch_home
phase basics attached
phase recover
launch_home
background_home
oldpid="$(adb shell pidof "$PACKAGE" | tr -d '\r')"
phase prepare-valid attached
crash_observe valid "$oldpid"
phase verify-valid attached
oldpid="$(adb shell pidof "$PACKAGE" | tr -d '\r')"
phase prepare-deleted attached
crash_observe deleted "$oldpid"
# The tombstoned service must already be gone; this cold invocation checks durable
# bytes and retries cleanup, not the automatic restart itself.
phase verify-deleted
printf 'PASS: API35 installed journal/coordinator/service scenarios; no power-loss, physical-device or API26 claim\n' | tee "$OUT/result.txt"
