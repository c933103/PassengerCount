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
# Diagnostic-only mode runs on a second fresh owned emulator after a failed
# original job step. It has a separate evidence destination and cannot replace
# the original gate's exit code or artifacts.
case "${PASSENGER_RESTART_RACE_ONLY:-0}" in
  0) OUT="$ROOT/android/build/lifecycle-evidence" ;;
  1)
    [[ "${PASSENGER_RESTART_RACE:-0}" == 1 ]] || { echo 'Diagnostic-only mode requires explicit race opt-in'; exit 2; }
    OUT="$ROOT/android/build/restart-race-evidence"
    ;;
  *) echo 'Unknown diagnostic mode'; exit 2 ;;
esac
mkdir -p "$OUT"
TEMP="$(mktemp -d "$RUNNER_TEMP/passenger-api35.XXXXXX")"
export ANDROID_AVD_HOME="$TEMP/avds"
mkdir -p "$ANDROID_AVD_HOME"
NAME="passenger_lifecycle_${GITHUB_RUN_ID:-ci}_${GITHUB_RUN_ATTEMPT:-1}_${PASSENGER_RESTART_RACE_ONLY:-0}"
SERIAL=emulator-5556
PACKAGE=app.passengercount
TRACK_PROCESS=app.passengercount:tracking
UI_RUNNER=app.passengercount.tests/app.passengercount.UiLifecycleInstrumentation
RUNNER=app.passengercount.tests/app.passengercount.JournalLifecycleInstrumentation
EMU_PID= GPS_PID= LOG_PID= PLATFORM_PREFLIGHT_READY=0
adb() { "$ADB" -s "$SERIAL" "$@"; }
# Metadata only, before test preparation and after its terminal result. Never
# sample in the process-absence interval or substitute this status for a gate.
platform_preflight() {
  local stage=$1 directory code
  if ! directory="$(mktemp -d "$OUT/platform-capability-$stage.XXXXXX")"; then
    echo 'PLATFORM_CAPABILITY_CAPTURE_UNAVAILABLE: output directory' >&2
    return 2
  fi
  if timeout 35s python3 "$ROOT/scripts/capture-android-platform-preflight.py" \
    --serial "$SERIAL" --adb "$ADB" --output-root "$directory" \
    --sdk-image-dir "$ANDROID_HOME/system-images/android-35/google_apis/x86_64" \
    > "$directory/collector.stdout" 2> "$directory/collector.stderr"; then code=0; else code=$?; fi
  if ! printf '%s\n' "$code" > "$directory/collector-exit-code.txt"; then
    echo 'PLATFORM_CAPABILITY_CAPTURE_UNAVAILABLE: status receipt' >&2
    return 2
  fi
  return "$code"
}
cleanup() {
  local code=$?
  # Commit the original gate status before any diagnostic or teardown can fail.
  if ! printf '%s\n' "$code" > "$OUT/exit-code.txt"; then
    echo "ORIGINAL_EXIT_RECEIPT_UNAVAILABLE: exit=$code; retaining process exit and attempting owned-emulator teardown" >&2
  fi
  if [[ -n "$EMU_PID" ]]; then
    adb shell dumpsys activity services "$PACKAGE" > "$OUT/services-final.txt" 2>&1 || true
    adb logcat -d -v threadtime > "$OUT/logcat-final.txt" 2>&1 || true
    if [[ "$PLATFORM_PREFLIGHT_READY" == 1 ]]; then
      platform_preflight after-tests || echo "PLATFORM_CAPABILITY_INCOMPLETE after-tests exit=$? (original exit=$code retained)" >&2
    fi
  fi
  [[ -z "$GPS_PID" ]] || kill "$GPS_PID" 2>/dev/null || true
  [[ -z "$LOG_PID" ]] || kill "$LOG_PID" 2>/dev/null || true
  # Only the process/device started by this script is stopped. No shared SDK/device cleanup.
  [[ -z "$EMU_PID" ]] || { adb emu kill >/dev/null 2>&1 || true; wait "$EMU_PID" 2>/dev/null || true; }
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
if [[ "${PASSENGER_RESTART_RACE:-0}" == 1 ]]; then
  PLATFORM_PREFLIGHT_READY=1
  platform_preflight before-tests || echo "PLATFORM_CAPABILITY_INCOMPLETE before-tests exit=$? (not an acceptance result)" >&2
fi
adb logcat -v threadtime > "$OUT/logcat-live.txt" 2>&1 & LOG_PID=$!
(
  for ((i=0;i<420;i++)); do
    longitude="$(awk -v n="$i" 'BEGIN {printf "%.6f", 0.456+n*0.0003}')"
    adb emu geo fix "$longitude" 0.123 >/dev/null 2>&1 || exit
    sleep 1
  done
) & GPS_PID=$!
phase() {
  local name=$1 mode=${2:-cold} runner=$RUNNER
  [[ "$name" != bootstrap ]] || runner=$UI_RUNNER
  local opts=()
  [[ "$mode" != attached ]] || opts+=(--no-restart)
  local command_code
  printf '%q ' timeout 100s "$ADB" -s "$SERIAL" shell am instrument -w -r "${opts[@]}" -e phase "$name" "$runner" \
    > "$OUT/$name-command.txt"
  printf '\n' >> "$OUT/$name-command.txt"
  if timeout 100s "$ADB" -s "$SERIAL" shell am instrument -w -r "${opts[@]}" -e phase "$name" "$runner" \
    > "$OUT/$name.txt" 2>&1; then command_code=0; else command_code=$?; fi
  printf '%s\n' "$command_code" > "$OUT/$name-command-exit-code.txt"
  if [[ "$command_code" != 0 ]]; then
    echo "INSTALLED_PHASE_COMMAND_FAILED: $name exit=$command_code" >&2
    cat "$OUT/$name.txt" >&2
    exit 1
  fi
  cat "$OUT/$name.txt"
  if [[ "$name" == ipc-* ]]; then
    grep -q "PHASE_RELAY $name " "$OUT/$name.txt"
    local deadline=$((SECONDS+65)) complete=false
    while ((SECONDS<deadline)); do
      adb logcat -d -v threadtime > "$OUT/$name-ui-logcat.txt"
      if grep -q "PassengerJournalTest: PHASE_FAIL $name" "$OUT/$name-ui-logcat.txt"; then
        echo "UI_PHASE_FAILED: $name"; exit 1;
      fi
      IPC_UI_PID="$(sed -nE "s/.*IPC_UI_ENTER phase=$name pid=([0-9]+).*/\\1/p" "$OUT/$name-ui-logcat.txt" | tail -1)"
      if [[ "$IPC_UI_PID" =~ ^[0-9]+$ ]] && awk -v phase="$name" -v pid="$IPC_UI_PID" '
        index($0,"IPC_UI_ENTER phase=" phase " pid=" pid) { entered=NR }
        entered && $0 ~ ("PassengerJournalTest: PHASE_PASS " phase " assertions=[0-9]+ pid=" pid "$") { passed=NR }
        passed && $0 ~ ("PassengerJournalTest: PHASE_DETACHED " phase " pid=" pid "$") { detached=NR }
        END { exit !(entered && passed>entered && detached>passed) }
      ' "$OUT/$name-ui-logcat.txt"; then complete=true; break; fi
      sleep 0.2
    done
    $complete || { echo "UI_PHASE_UNVERIFIED: $name"; exit 1; }
    grep "PassengerJournalTest: PHASE_PASS $name " "$OUT/$name-ui-logcat.txt"
  else
    grep -q "PHASE_PASS $name " "$OUT/$name.txt"
  fi
  grep -q 'INSTRUMENTATION_CODE: -1' "$OUT/$name.txt"
  ! grep -q 'PHASE_FAIL\|INSTRUMENTATION_FAILED' "$OUT/$name.txt"
}
launch_home() {
  # bootstrap seeded a fresh local-only catalogue and empty Home state first.
  adb shell am start -W -n "$PACKAGE/.MainActivity" > "$OUT/home-launch-$(date +%s).txt"
  sleep 2
  local deadline=$((SECONDS+20))
  # Home's ordinary orphan-stop IPC initializes the owner. Never use shell to
  # enter the private provider or start the production service.
  while ((SECONDS<deadline)); do
    if adb shell pidof "$TRACK_PROCESS" > "$OUT/home-owner-pid.txt"; then return 0; fi
    sleep 0.2
  done
  echo 'HOME_OWNER_STARTUP_UNVERIFIED'; exit 1
}
background_home() {
  # Prevent Activity relaunch from masquerading as a service-triggered restart.
  # The service was started while the real Activity was foreground; now move
  # it behind Home before the scheduled detached SIGKILL, as in ordinary use.
  adb shell input keyevent KEYCODE_HOME
  sleep 1
}
ui_absent() {
  local code
  if adb shell pidof "$PACKAGE" > "$OUT/ui-death-pids.txt" 2> "$OUT/ui-death-pids.stderr"; then code=0; else code=$?; fi
  if [[ "$code" == 1 && ! -s "$OUT/ui-death-pids.txt" && ! -s "$OUT/ui-death-pids.stderr" ]]; then return 0; fi
  if [[ "$code" == 0 && ! -s "$OUT/ui-death-pids.stderr" ]] && grep -Eq '^[0-9]+([[:space:]]+[0-9]+)*[[:space:]]*$' "$OUT/ui-death-pids.txt"; then return 1; fi
  echo 'UI_PROCESS_OBSERVATION_UNVERIFIED' >&2; return 2
}
detached() {
  local kind=$1 oldpid=$2 process=${3:-$PACKAGE} proof="$OUT/instrumentation-detached-$1.txt"
  # API35 has no `activity instrumentation` dump command: its error text is not
  # evidence of detachment. The package-filtered processes dump includes active
  # instrumentation before PID mappings. Its final field is emitted only after
  # the whole dump. Require that complete response and empty stderr: dumpsys
  # can return zero after Binder/poll/read failures, so exit status isn't proof.
  if ! adb shell dumpsys activity processes "$PACKAGE" > "$proof" 2> "$proof.stderr"; then
    echo 'INSTRUMENTATION_DETACH_UNVERIFIED: process dump command failed'; exit 1
  fi
  if [[ -s "$proof.stderr" ]] || ! awk -v pid="$oldpid" -v package="$process" '
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
  local kind=$1 expected=$2 oldpid=$3 process=${4:-$PACKAGE} proof="$OUT/instrumentation-detached-activity-$1.txt"
  # On the bounded API35 image, TOP=2 and FOREGROUND_SERVICE=4. Use the
  # actual process record, not instrumentation's OOM importance or old logs.
  detached "activity-$kind" "$oldpid" "$process"
  if ! awk -v pid="$oldpid" -v package="$process" -v expected="$expected" '
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
  local process=${TRACK_PROCESS:-$PACKAGE}
  detached "$kind" "$oldpid" "$process"
  # Only service starts AFTER this phase's detached SIGKILL count. PID creation
  # precedes onStartCommand, so poll for the required service state as well.
  while ((SECONDS<deadline)); do
    adb logcat -d -v threadtime > "$OUT/logcat-$kind-restarted.txt"
    awk -v marker="SIGKILL_AFTER_DETACH prepare-$kind pid=$oldpid" '
      seen { print }
      index($0,marker) { seen=1 }
    ' "$OUT/logcat-$kind-restarted.txt" > "$OUT/after-death-$kind.txt"
    grep -E "Start proc [0-9]+:$process/.*for service.*TrackService" "$OUT/after-death-$kind.txt" \
      > "$OUT/service-starts-$kind.txt" || true
    newpid="$(sed -nE "s/.*Start proc ([0-9]+):$process\/.*/\\1/p" "$OUT/service-starts-$kind.txt" | tail -1)"
    adb shell dumpsys activity services "$PACKAGE" > "$OUT/services-$kind-restarted.txt"
    if [[ -n "$newpid" && "$newpid" != "$oldpid" ]]; then
      if [[ "$kind" == valid ]]; then
        if grep -q 'ServiceRecord.*app.passengercount/.TrackService' "$OUT/services-$kind-restarted.txt" \
          && grep -q "app=ProcessRecord{.* $newpid:$process/" "$OUT/services-$kind-restarted.txt" \
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
if [[ "${PASSENGER_RESTART_RACE_ONLY:-0}" == 1 ]]; then
  printf 'DIAGNOSTIC ONLY: original lifecycle failure remains binding; this run does not execute or replace its acceptance gates\n' > "$OUT/diagnostic-only.txt"
  source "$ROOT/scripts/android-restart-race.sh"
  restart_race
  exit 0
fi
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
oldpid="$(adb shell pidof "$TRACK_PROCESS" | tr -d '\r')"
background_home
activity_state background-valid 4 "$oldpid" "$TRACK_PROCESS"
crash_observe valid "$oldpid"
phase verify-valid attached
launch_home
oldpid="$(adb shell pidof "$PACKAGE" | tr -d '\r')"
activity_state before-deleted 2 "$oldpid"
phase prepare-deleted attached
oldpid="$(adb shell pidof "$TRACK_PROCESS" | tr -d '\r')"
background_home
activity_state background-deleted 4 "$oldpid" "$TRACK_PROCESS"
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
oldpid="$(adb shell pidof "$TRACK_PROCESS" | tr -d '\r')"
background_home
activity_state background-denied 4 "$oldpid" "$TRACK_PROCESS"
detached denied "$oldpid" "$TRACK_PROCESS"
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
[[ "$(adb shell pidof "$TRACK_PROCESS" | tr -d '\r')" == "$oldpid" ]]
phase verify-denied attached
launch_home
activity_state recovery-denied 2 "$(adb shell pidof "$PACKAGE" | tr -d '\r')"
phase recover-denied attached
launch_home
phase ipc-basics attached
phase prepare-ipc-barrier attached
phase ipc-drain attached
phase prepare-ipc-death attached
phase ipc-death attached
ui_pid=$IPC_UI_PID
[[ "$(adb shell pidof "$PACKAGE" | tr -d '\r')" == "$ui_pid" ]]
# A new, visible Home setup initializes the owner after deliberate provider death.
# The preceding unknown-acknowledgement assertion has already finished.
launch_home
phase prepare-ipc-pipe attached
phase ipc-prepare-ui-death attached
ui_pid=$IPC_UI_PID
background_home
detached ui-death "$ui_pid"
ui_gone=false
for ((i=0;i<25;i++)); do
  if ui_absent; then ui_gone=true; break; else code=$?; [[ "$code" == 1 ]] || exit 2; fi
  sleep 1
done
$ui_gone || { echo 'UI_PROCESS_DEATH_UNVERIFIED'; exit 1; }
sleep 6
adb logcat -d -v threadtime > "$OUT/ui-death-logcat.txt"
grep -q "UI_SIGKILL_AFTER_DETACH pid=$ui_pid" "$OUT/ui-death-logcat.txt"
grep -Fq "ActivityManager: Process $PACKAGE (pid $ui_pid) has died:" "$OUT/ui-death-logcat.txt"
phase verify-ui-death attached
printf 'PASS: API35 installed journal/coordinator/service scenarios; no power-loss, physical-device or API26 claim\n' | tee "$OUT/result.txt"


# Opt-in diagnostic only, after all original controls in their original order.
# Failure remains aggregate failure; an unhit interleaving is explicitly unverified.
if [[ "${PASSENGER_RESTART_RACE:-0}" == 1 ]]; then
  source "$ROOT/scripts/android-restart-race.sh"
  original_out=$OUT
  OUT="$original_out/service-only-race"; mkdir -p "$OUT"
  restart_race split
  OUT=$original_out
  restart_race
fi
