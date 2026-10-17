#!/usr/bin/env bash
# Sourced only by the owned, disposable-emulator runner, after its original gates.
race_capture() {
  local output=$1; shift
  if adb "$@" > "$output" 2> "$output.stderr"; then
    if [[ ! -s "$output.stderr" ]]; then return 0; fi
  fi
  echo "RACE_OBSERVATION_UNVERIFIED: $*" >&2
  cat "$output.stderr" >&2
  return 2
}
restart_race() {
  [[ "${CI:-}" == true && -n "${EMU_PID:-}" && "${SERIAL:-}" == emulator-5556 ]] || {
    echo 'RACE_ENVIRONMENT_UNVERIFIED: use test-android-installed.sh'; return 2;
  }
  local component=app.passengercount.tests/app.passengercount.RestartRaceTriggerService
  # Warm a different UID before starting PassengerCount's foreground session.
  # It has no location permission, binding, shared UID or production component.
  race_capture "$OUT/race-warm.txt" shell am startservice -n "$component" -a app.passengercount.tests.WARM
  if grep -Eq 'Error|Exception|Permission Denial' "$OUT/race-warm.txt"; then return 2; fi
  launch_home
  local oldpid
  oldpid="$(adb shell pidof "$PACKAGE" | tr -d '\r')"
  [[ "$oldpid" =~ ^[0-9]+$ ]] || { echo 'RACE_OLD_PID_UNVERIFIED'; return 2; }
  activity_state before-race 2 "$oldpid"
  phase prepare-race attached
  background_home
  activity_state background-race 4 "$oldpid"
  race_capture "$OUT/race-before-services.txt" shell dumpsys activity services "$PACKAGE"
  detached race "$oldpid"
  printf '%s\n' "$oldpid" > "$OUT/race-old-pid.txt"
  local deadline=$((SECONDS+20)) scheduled=false
  # Trigger on actual restart scheduling after this death, not a timer guessed
  # from instrumentation duration. No stopForeground/policy toggle on the target.
  while ((SECONDS<deadline)); do
    race_capture "$OUT/race-logcat.txt" logcat -d -v threadtime
    if awk -v pid="$oldpid" '
      index($0,"PassengerJournalTest: SIGKILL_AFTER_DETACH prepare-race pid=" pid) { marker=1 }
      marker && index($0,"ActivityManager: Process app.passengercount (pid " pid ") has died:") { death=1 }
      death && /ActivityManager: Scheduling restart of crashed service app.passengercount\/\.TrackService / { found=1 }
      END { exit !found }
    ' "$OUT/race-logcat.txt"; then scheduled=true; break; fi
    sleep 0.05
  done
  $scheduled || { echo 'RACE_RESTART_SCHEDULING_UNVERIFIED'; return 2; }
  # Shell gets its own foreground-start exemption; it is used only for the other
  # package. The tested target is restarted solely by ActivityManager.
  race_capture "$OUT/race-trigger.txt" shell am start-foreground-service -n "$component" -a app.passengercount.tests.TRIGGER
  if grep -Eq 'Error|Exception|Permission Denial' "$OUT/race-trigger.txt"; then return 2; fi
  deadline=$((SECONDS+75))
  local code=2
  while ((SECONDS<deadline)); do
    race_capture "$OUT/race-logcat.txt" logcat -d -v threadtime
    race_capture "$OUT/race-services.txt" shell dumpsys activity services "$PACKAGE"
    if node "$ROOT/scripts/analyze-android-restart-race.mjs" \
      "$OUT/race-logcat.txt" "$OUT/race-services.txt" "$oldpid" > "$OUT/race-result.json"; then
      code=0
      break
    else code=$?; fi
    # A measured automatic-restart policy denial is a failure, never a pass.
    if [[ "$code" == 1 ]]; then
      echo 'RACE_AUTOMATIC_RESTART_FAILED: independent FGS transition preceded denied target restart'
      cat "$OUT/race-result.json"
      return 1
    fi
    sleep 0.2
  done
  if [[ "$code" != 0 ]]; then
    echo 'RACE_INTERLEAVING_OR_RECOVERY_UNVERIFIED: inspect retained timing; this is not a pass'
    cat "$OUT/race-result.json"
    return 2
  fi
  # No reattachment until shell proved the new target service was foreground
  # after the independent trigger. This next phase checks real GPS, journal and
  # session continuity; it does not prove pre-reattachment GPS delivery.
  phase verify-race attached
  echo 'PASS: one measured independent-FGS / automatic-restart sample; known intermittent failure remains open' \
    > "$OUT/race-result.txt"
}
