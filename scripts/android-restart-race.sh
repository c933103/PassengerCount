#!/usr/bin/env bash
# Sourced only by the owned, disposable-emulator runner, after its original gates.
race_capture() {
  local output=$1 capture_code; shift
  if adb "$@" > "$output" 2> "$output.stderr"; then
    capture_code=0
  else capture_code=$?; fi
  printf '%s\n' "$capture_code" > "$output.exit-code.txt" || return 2
  if [[ "$capture_code" == 0 && ! -s "$output.stderr" ]]; then return 0; fi
  echo "RACE_OBSERVATION_UNVERIFIED: $*" >&2
  cat "$output.stderr" >&2
  return 2
}
restart_race() {
  [[ "${CI:-}" == true && -n "${EMU_PID:-}" && "${SERIAL:-}" == emulator-5556 ]] || {
    echo 'RACE_ENVIRONMENT_UNVERIFIED: use test-android-installed.sh'; return 2;
  }
  local kind=${1:-race} process=${TRACK_PROCESS:-$PACKAGE}
  [[ "$kind" == race || "$kind" == split ]] || return 2
  local component=app.passengercount.tests/app.passengercount.RestartRaceTriggerService
  # Warm a different UID before starting PassengerCount's foreground session.
  # It has no location permission, binding, shared UID or production component.
  race_capture "$OUT/race-warm.txt" shell am start-foreground-service -n "$component" -a app.passengercount.tests.WARM
  if grep -Eq 'Error|Exception|Permission Denial' "$OUT/race-warm.txt"; then return 2; fi
  local warm_deadline=$((SECONDS+10)) warmed=false
  while ((SECONDS<warm_deadline)); do
    race_capture "$OUT/race-warm-logcat.txt" logcat -d -v threadtime
    if grep -q 'PassengerRaceTrigger: RACE_WARM_READY pid=' "$OUT/race-warm-logcat.txt"; then warmed=true; break; fi
    sleep 0.05
  done
  $warmed || { echo 'RACE_WARM_UNVERIFIED'; return 2; }
  launch_home
  local oldpid
  oldpid="$(adb shell pidof "$PACKAGE" | tr -d '\r')"
  [[ "$oldpid" =~ ^[0-9]+$ ]] || { echo 'RACE_OLD_PID_UNVERIFIED'; return 2; }
  activity_state before-race 2 "$oldpid"
  local ui_pid=$oldpid
  phase "prepare-$kind" attached
  oldpid="$(adb shell pidof "$process" | tr -d '\r')"
  [[ "$oldpid" =~ ^[0-9]+$ ]] || return 2
  background_home
  activity_state background-race 4 "$oldpid" "$process"
  race_capture "$OUT/race-before-services.txt" shell dumpsys activity services "$PACKAGE"
  detached race "$oldpid" "$process"
  printf '%s\n' "$oldpid" > "$OUT/race-old-pid.txt"
  local deadline=$((SECONDS+20)) scheduled=false
  # Trigger on actual restart scheduling after this death, not a timer guessed
  # from instrumentation duration. No stopForeground/policy toggle on the target.
  while ((SECONDS<deadline)); do
    race_capture "$OUT/race-scheduling-logcat.txt" logcat -d -v threadtime
    if awk -v pid="$oldpid" -v process="$process" -v kind="$kind" '
      index($0,"PassengerJournalTest: SIGKILL_AFTER_DETACH prepare-" kind " pid=" pid) { marker=1 }
      marker && index($0,"ActivityManager: Process " process " (pid " pid ") has died:") { death=1 }
      death && /ActivityManager: Scheduling restart of crashed service app.passengercount\/\.TrackService / { found=1 }
      END { exit !found }
    ' "$OUT/race-scheduling-logcat.txt"; then scheduled=true; break; fi
    sleep 0.05
  done
  $scheduled || { echo 'RACE_RESTART_SCHEDULING_UNVERIFIED'; return 2; }
  if [[ "$process" != "$PACKAGE" ]]; then
    if [[ "$kind" == split ]]; then
      [[ "$(adb shell pidof "$PACKAGE" | tr -d '\r')" == "$ui_pid" ]] || {
        echo 'RACE_UI_SURVIVAL_UNVERIFIED'; return 2;
      }
      printf 'UI_SURVIVED_SERVICE_DEATH pid=%s\n' "$ui_pid" > "$OUT/race-process-scope.txt"
    else
      # pidof exits 1 for no matches. Any returned PID invalidates this scope.
      local absence_code
      if adb shell pidof "$PACKAGE" "$process" > "$OUT/race-absent-pids.txt" 2> "$OUT/race-absent-pids.stderr"; then
        absence_code=0
      else absence_code=$?; fi
      if [[ "$absence_code" != 1 || -s "$OUT/race-absent-pids.txt" || -s "$OUT/race-absent-pids.stderr" ]] \
        || ! grep -Fq "ActivityManager: Process $PACKAGE (pid $ui_pid) has died:" "$OUT/race-scheduling-logcat.txt"; then
        echo 'RACE_ALL_PROCESS_ABSENCE_UNVERIFIED'; return 2;
      fi
      printf 'ALL_PACKAGE_PROCESSES_ABSENT before_helper=true\n' > "$OUT/race-process-scope.txt"
    fi
  fi
  # Shell gets its own foreground-start exemption; it is used only for the other
  # package. The tested target is restarted solely by ActivityManager.
  race_capture "$OUT/race-trigger.txt" shell am start-foreground-service -n "$component" -a app.passengercount.tests.TRIGGER
  if grep -Eq 'Error|Exception|Permission Denial' "$OUT/race-trigger.txt"; then return 2; fi
  deadline=$((SECONDS+75))
  local code=2 observation
  while ((SECONDS<deadline)); do
    # A later partial capture must never overwrite the inputs of the last
    # complete classification. Keep every attempt, including failed raw output.
    observation="$(mktemp -d "$OUT/race-observation.XXXXXX")" || return 2
    race_capture "$observation/logcat.txt" logcat -d -v threadtime || return 2
    race_capture "$observation/services.txt" shell dumpsys activity services "$PACKAGE" || return 2
    if node "$ROOT/scripts/analyze-android-restart-race.mjs" \
      "$observation/logcat.txt" "$observation/services.txt" "$oldpid" "$kind" "$process" \
      --publish "$OUT/race-result.json" > "$observation/classifier.stdout" 2> "$observation/classifier.stderr"; then
      code=0
    else code=$?; fi
    if ! printf '%s\n' "$code" > "$observation/classifier-exit-code.txt"; then
      [[ "$code" != 1 ]] || return 1
      return 2
    fi
    if [[ "$code" != 0 && "$code" != 1 && "$code" != 2 ]]; then
      cat "$observation/classifier.stderr" >&2
      return 2
    fi
    [[ "$code" != 0 ]] || break
    # A measured automatic-restart policy denial is a failure, never a pass.
    if [[ "$code" == 1 ]]; then
      echo 'RACE_AUTOMATIC_RESTART_FAILED: target restart denied; use interleaved flag for trigger attribution'
      # A publication error may leave the root pointer on a prior observation.
      # Report only this attempt, never quote that older result as this denial.
      [[ ! -f "$observation/result.json" ]] || cat "$observation/result.json"
      cat "$observation/classifier.stderr" >&2
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
  if [[ "$kind" == split ]]; then
    [[ "$(adb shell pidof "$PACKAGE" | tr -d '\r')" == "$ui_pid" ]] || return 2
  fi
  phase "verify-$kind" attached
  echo 'PASS: one measured independent-FGS / automatic-restart sample; known intermittent failure remains open' \
    > "$OUT/race-result.txt"
}
