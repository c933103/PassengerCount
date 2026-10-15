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
# An SDK ZIP can be truncated on a transient CDN/proxy fetch. Retry only the
# fixed API35 image in this disposable hosted job; never accept a partial image,
# alter its API level, or fall back to software emulation.
: > "$OUT/sdk-image-install.txt"
image_ready=false
for attempt in 1 2 3; do
  printf 'SDK_IMAGE_ATTEMPT %s of 3\n' "$attempt" | tee -a "$OUT/sdk-image-install.txt"
  if "$SDKMANAGER" 'emulator' "$IMAGE" > "$OUT/sdk-image-install-$attempt.txt" 2>&1; then
    cat "$OUT/sdk-image-install-$attempt.txt" >> "$OUT/sdk-image-install.txt"
    if [[ -s "$ANDROID_HOME/system-images/android-35/google_apis/x86_64/system.img" ]]; then
      image_ready=true
      break
    fi
    echo 'SDK_IMAGE_INCOMPLETE: sdkmanager returned success without an API35 system.img' | tee -a "$OUT/sdk-image-install.txt"
  else
    code=$?
    cat "$OUT/sdk-image-install-$attempt.txt" >> "$OUT/sdk-image-install.txt"
    printf 'SDK_IMAGE_FAILED attempt=%s exit=%s\n' "$attempt" "$code" | tee -a "$OUT/sdk-image-install.txt"
  fi
  if (( attempt < 3 )); then sleep $((attempt * 5)); fi
done
if ! $image_ready; then
  echo 'SDK_IMAGE_UNAVAILABLE: required API35 image failed three bounded attempts' | tee "$OUT/blocker.txt"
  tail -c 1500 "$OUT/sdk-image-install.txt" >&2
  exit 2
fi
if ! "$EMULATOR" -version > "$OUT/emulator-version.txt" 2>&1; then
  echo 'EMULATOR_LOADER_FAILED: inspect emulator-version.txt for missing shared libraries or runtime issues' | tee "$OUT/blocker.txt"
  cat "$OUT/emulator-version.txt" >&2
  exit 2
fi
if ! "$EMULATOR" -accel-check > "$OUT/acceleration.txt" 2>&1; then
  echo 'EMULATOR_ACCEL_FAILED: required hardware acceleration unavailable' | tee "$OUT/blocker.txt"
  cat "$OUT/acceleration.txt" >&2
  exit 2
fi
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
  if ! timeout 100s "$ADB" -s "$SERIAL" shell am instrument -w -r "${opts[@]}" -e phase "$name" "$RUNNER" \
    > "$OUT/$name.txt" 2>&1; then
    echo "INSTALLED_PHASE_COMMAND_FAILED: $name" >&2
    cat "$OUT/$name.txt" >&2
    exit 1
  fi
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
  # The service was started while the real Activity was foreground; now move
  # it behind Home before the scheduled detached SIGKILL, as in ordinary use.
  adb shell input keyevent KEYCODE_HOME
  sleep 1
}
detached() {
  local kind=$1 oldpid=$2 proof="$OUT/instrumentation-detached-$1.txt"
  # API35 has no `activity instrumentation` dump command: its error text is not
  # evidence of detachment. The package-filtered processes dump includes active
  # instrumentation before PID mappings. Its final field is emitted only after
  # the whole dump. Require that complete response and empty stderr: dumpsys
  # can return zero after Binder/poll/read failures, so exit status isn't proof.
  if ! adb shell dumpsys activity processes "$PACKAGE" > "$proof" 2> "$proof.stderr"; then
    echo 'INSTRUMENTATION_DETACH_UNVERIFIED: process dump command failed'; exit 1
  fi
  if [[ -s "$proof.stderr" ]] || ! awk -v pid="$oldpid" -v package="$PACKAGE" '
    NR == 1 { header=($0 == "ACTIVITY MANAGER RUNNING PROCESSES (dumpsys activity processes)") }
    index($0,"PID #" pid ":") && index($0," " pid ":" package "/") { mapped=1 }
    NF { last=$0 }
    END { exit !(header && mapped && last ~ /^  mForceBackgroundCheck=(true|false)$/) }
  ' "$proof"; then
    echo 'INSTRUMENTATION_DETACH_UNVERIFIED: missing complete supported process dump'; exit 1
  fi
  if grep -Eq 'Active instrumentation:|ActiveInstrumentation|mInstr=' "$proof"; then
    echo 'Instrumentation still active; cannot claim an ordinary sticky restart'; exit 1
  fi
  printf 'DETACHED_STATE_PASS %s pid=%s\n' "$kind" "$oldpid"
}
activity_state() {
  local kind=$1 expected=$2 oldpid=$3 proof="$OUT/instrumentation-detached-activity-$1.txt"
  # On the bounded API35 image, TOP=2 and FOREGROUND_SERVICE=4. Use the
  # actual process record, not instrumentation's OOM importance or old logs.
  detached "activity-$kind" "$oldpid"
  if ! awk -v pid="$oldpid" -v package="$PACKAGE" -v expected="$expected" '
    /^  \*APP\* UID / { own=index($0," " pid ":" package "/")>0 }
    own && /^[[:space:]]+curProcState=/ {
      for(i=1;i<=NF;i++) if($i ~ /^curProcState=[0-9]+$/) {
        split($i,state,"="); count++; valid=(state[2] == expected)
      }
    }
    END { exit !(count == 1 && valid) }
  ' "$proof"; then
    echo "ACTIVITY_STATE_UNVERIFIED: $kind requires API35 process state $expected"; exit 1
  fi
  printf 'ACTIVITY_STATE_PASS %s state=%s pid=%s\n' "$kind" "$expected" "$oldpid"
}
crash_observe() {
  local kind=$1 oldpid=$2 deadline=$((SECONDS+75)) newpid= completed=false
  detached "$kind" "$oldpid"
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
phase receipts-prepare
phase receipts-recover
phase receipts-final
launch_home
oldpid="$(adb shell pidof "$PACKAGE" | tr -d '\r')"
activity_state before-valid 2 "$oldpid"
phase prepare-valid attached
background_home
activity_state background-valid 4 "$oldpid"
crash_observe valid "$oldpid"
phase verify-valid attached
launch_home
oldpid="$(adb shell pidof "$PACKAGE" | tr -d '\r')"
activity_state before-deleted 2 "$oldpid"
phase prepare-deleted attached
background_home
activity_state background-deleted 4 "$oldpid"
crash_observe deleted "$oldpid"
# The tombstoned service must already be gone; this cold invocation checks durable
# bytes and retries cleanup, not the automatic restart itself.
phase verify-deleted
# Keep the original sticky controls ahead of intentional policy demotion and
# its extra delay, so the recovery fixture cannot shelter their boot-time race.
launch_home
oldpid="$(adb shell pidof "$PACKAGE" | tr -d '\r')"
activity_state before-denied 2 "$oldpid"
phase prepare-denied attached
background_home
activity_state background-denied 4 "$oldpid"
detached denied "$oldpid"
denial_done=false
for ((i=0;i<45;i++)); do
  if adb logcat -d -v threadtime > "$OUT/logcat-controlled-denial.txt" 2> "$OUT/logcat-controlled-denial.stderr"; then
    :
  else
    code=$?
    echo "CONTROLLED_DENIAL_OBSERVATION_FAILED: adb logcat exit=$code; installed outcome is unverified" | tee "$OUT/blocker.txt" >&2
    cat "$OUT/logcat-controlled-denial.stderr" >&2
    exit "$code"
  fi
  if grep -q "PHASE_FAIL controlled-" "$OUT/logcat-controlled-denial.txt"; then
    echo 'Controlled policy-denial phase failed'; exit 1
  fi
  if grep -q "DENIAL_HANDLED pid=$oldpid" "$OUT/logcat-controlled-denial.txt"; then
    adb shell dumpsys activity services "$PACKAGE" > "$OUT/services-controlled-denial.txt"
    if ! grep -q 'ServiceRecord.*app.passengercount/.TrackService' "$OUT/services-controlled-denial.txt"; then denial_done=true; break; fi
  fi
  sleep 1
done
$denial_done || { echo 'Controlled policy denial was not observed'; exit 1; }
grep -q "DENIAL_AFTER_DETACH pid=$oldpid" "$OUT/logcat-controlled-denial.txt"
grep -q 'ForegroundServiceStartNotAllowedException' "$OUT/logcat-controlled-denial.txt"
[[ "$(adb shell pidof "$PACKAGE" | tr -d '\r')" == "$oldpid" ]]
phase verify-denied attached
launch_home
activity_state recovery-denied 2 "$oldpid"
phase recover-denied attached
printf 'PASS: API35 installed journal/coordinator/service scenarios; no power-loss, physical-device or API26 claim\n' | tee "$OUT/result.txt"

