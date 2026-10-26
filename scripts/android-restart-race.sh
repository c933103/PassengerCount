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
race_capture_services() {
  local output=$1
  if [[ "${PASSENGER_RESTART_RACE_ONLY:-0}" == 1 ]]; then
    # The independent post-failure observation reuses this same command slot.
    # A positional package suppresses ActiveForegroundApps; no -p/-c option is
    # used because those can enable application dump callbacks. Original gates
    # retain their existing package-filtered command and timing sequence.
    printf 'ALL_SERVICES_NO_CLIENTS_DIAGNOSTIC_ONLY\n' > "$output.scope.txt" || return 2
    race_capture "$output" shell dumpsys activity services
  else
    race_capture "$output" shell dumpsys activity services "$PACKAGE"
  fi
}
# Host-only timing for the independent pair. No ADB call, wall-clock arithmetic,
# inferred timing equality, or timing dependency is added to the original gate.
race_host_timing() {
  python3 - "$@" <<'PY'
import hashlib, json, pathlib, sys, time

def read_receipt(name):
    path = pathlib.Path(name)
    with path.open('rb') as source:
        raw = source.read(65537)
    if len(raw) > 65536: raise ValueError('Timing receipt exceeds limit')
    value = json.loads(raw)
    if not isinstance(value, dict): raise ValueError('Timing receipt must be an object')
    return value, {'path': str(path), 'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()}

def write(name, value):
    with pathlib.Path(name).open('x') as output:
        json.dump(value, output, indent=2); output.write('\n')

def number(value):
    if not str(value).isdigit(): raise ValueError('Missing/non-numeric monotonic timestamp')
    return int(value)

try:
    mode, *args = sys.argv[1:]
    if mode == 'now':
        print(time.monotonic_ns()); sys.exit(0)
    receipt = {'kind': 'host-timing-observation-not-acceptance', 'clock': 'time.monotonic_ns',
        'clockImplementation': time.get_clock_info('monotonic').implementation,
        'clockResolutionSeconds': time.get_clock_info('monotonic').resolution,
        'limitations': ['Host timestamps bracket command slots, not device events.',
            'Separate emulator boot/warmup, scheduling and memory pressure are uncontrolled confounds.',
            'Idle replay is not timing equality or a causal/acceptance result.']}
    if mode == 'record':
        output, absence, start, end, native = args
        absence, start, end, native = map(number, (absence, start, end, native))
        if not 0 < absence <= start <= end: raise ValueError('Invalid trigger timing order')
        receipt.update(mode='triggered', status='measured' if native == 0 else 'capture-incomplete',
            verifiedAbsenceNs=absence, slotStartNs=start, slotEndNs=end, elapsedNs=end-start,
            captureExitCode=native)
        write(output, receipt)
    elif mode == 'idle':
        source, output, absence = args
        reference, identity = read_receipt(source)
        duration = reference.get('elapsedNs')
        if (reference.get('mode') != 'triggered' or reference.get('status') != 'measured'
            or reference.get('clock') != 'time.monotonic_ns' or reference.get('captureExitCode') != 0
            or type(duration) is not int or not 0 <= duration <= 10_000_000_000
            or any(type(reference.get(key)) is not int for key in ('verifiedAbsenceNs', 'slotStartNs', 'slotEndNs'))
            or not 0 < reference['verifiedAbsenceNs'] <= reference['slotStartNs'] <= reference['slotEndNs']
            or duration != reference['slotEndNs'] - reference['slotStartNs']):
            raise ValueError('No verified bounded triggered slot to replay')
        absence = number(absence)
        start = time.monotonic_ns()
        if not 0 < absence <= start: raise ValueError('Invalid control absence boundary')
        deadline = start + duration
        while time.monotonic_ns() < deadline:
            time.sleep(max(0, deadline-time.monotonic_ns())/1_000_000_000)
        end = time.monotonic_ns()
        receipt.update(mode='no-trigger-control', status='measured', verifiedAbsenceNs=absence,
            slotStartNs=start, slotEndNs=end, elapsedNs=end-start, requestedReplayNs=duration,
            replayDifferenceNs=end-start-duration, reference=identity)
        write(output, receipt)
    elif mode == 'align-first-services':
        trigger_file, first_file, own_file, output = args
        trigger, trigger_id = read_receipt(trigger_file)
        first, first_id = read_receipt(first_file)
        own, own_id = read_receipt(own_file)
        def valid_slot(value, mode):
            return (value.get('kind') == receipt['kind'] and value.get('clock') == receipt['clock']
                and value.get('mode') == mode and value.get('status') == 'measured'
                and all(type(value.get(key)) is int for key in ('verifiedAbsenceNs', 'slotStartNs', 'slotEndNs', 'elapsedNs'))
                and 0 < value['verifiedAbsenceNs'] <= value['slotStartNs'] <= value['slotEndNs']
                and value['elapsedNs'] == value['slotEndNs'] - value['slotStartNs'])
        def matches(value, identity):
            return isinstance(value, dict) and all(value.get(key) == identity[key] for key in ('bytes', 'sha256'))
        if (not valid_slot(trigger, 'triggered') or type(trigger.get('captureExitCode')) is not int or trigger['captureExitCode'] != 0
            or not 0 <= trigger['elapsedNs'] <= 10_000_000_000
            or not valid_slot(own, 'no-trigger-control') or not matches(own.get('reference'), trigger_id)
            or type(own.get('requestedReplayNs')) is not int or own['requestedReplayNs'] != trigger['elapsedNs']
            or type(own.get('replayDifferenceNs')) is not int or own['elapsedNs'] < trigger['elapsedNs']
            or own['replayDifferenceNs'] != own['elapsedNs'] - trigger['elapsedNs']
            or first.get('kind') != receipt['kind'] or first.get('mode') != 'triggered'
            or first.get('status') != 'measured' or first.get('clock') != receipt['clock']
            or not matches(first.get('slotEvidence'), trigger_id)
            or any(type(first.get(key)) is not int for key in ('verifiedAbsenceNs', 'firstServicesStartNs',
                'firstServicesEndNs', 'servicesElapsedNs', 'gapAfterSlotNs', 'elapsedFromAbsenceNs'))
            or first['verifiedAbsenceNs'] != trigger['verifiedAbsenceNs']
            or not trigger['slotEndNs'] <= first['firstServicesStartNs'] <= first['firstServicesEndNs']
            or first['servicesElapsedNs'] != first['firstServicesEndNs'] - first['firstServicesStartNs']
            or first['gapAfterSlotNs'] != first['firstServicesStartNs'] - trigger['slotEndNs']
            or first['elapsedFromAbsenceNs'] != first['firstServicesStartNs'] - trigger['verifiedAbsenceNs']
            or not 0 <= first['elapsedFromAbsenceNs'] <= 10_000_000_000):
            raise ValueError('No verified bounded first-services deadline to align')
        start = time.monotonic_ns()
        if start < own['slotEndNs']: raise ValueError('Control slot is after the host clock')
        deadline = own['verifiedAbsenceNs'] + first['elapsedFromAbsenceNs']
        while time.monotonic_ns() < deadline:
            time.sleep(max(0, deadline-time.monotonic_ns())/1_000_000_000)
        end = time.monotonic_ns()
        receipt.update(mode='no-trigger-control', status='deadline-already-passed' if start > deadline else 'deadline-reached',
            verifiedAbsenceNs=own['verifiedAbsenceNs'], targetFromAbsenceNs=first['elapsedFromAbsenceNs'],
            deadlineNs=deadline, waitStartedNs=start, waitCompletedNs=end, waitedNs=end-start,
            requestedWaitNs=max(0, deadline-start), initialLatenessNs=max(0, start-deadline),
            overshootNs=end-deadline, triggeredSlotEvidence=trigger_id,
            triggeredFirstServicesEvidence=first_id, controlSlotEvidence=own_id)
        write(output, receipt)
        # This is a host bracket, not a device event. Receipt/stdout publication,
        # process exit and shell dispatch still intervene before the ADB command.
        print(end)
    elif mode == 'first-services':
        slot_file, output, start, end = args
        slot, identity = read_receipt(slot_file)
        start, end = map(number, (start, end))
        absence, slot_end = slot.get('verifiedAbsenceNs'), slot.get('slotEndNs')
        if (slot.get('status') != 'measured' or slot.get('clock') != 'time.monotonic_ns'
            or slot.get('mode') not in ('triggered', 'no-trigger-control')
            or type(absence) is not int or type(slot_end) is not int
            or not 0 < absence <= slot_end <= start <= end):
            raise ValueError('First-services timing cannot be paired with the verified absence/slot')
        receipt.update(mode=slot['mode'], status='measured', verifiedAbsenceNs=absence,
            firstServicesStartNs=start, firstServicesEndNs=end, servicesElapsedNs=end-start,
            gapAfterSlotNs=start-slot_end, elapsedFromAbsenceNs=start-absence, slotEvidence=identity)
        write(output, receipt)
    else: raise ValueError('Unknown host timing operation')
except (OSError, ValueError, TypeError) as error:
    print('RACE_HOST_TIMING_UNVERIFIED: ' + str(error), file=sys.stderr); sys.exit(2)
PY
}
restart_race() {
  [[ "${CI:-}" == true && -n "${EMU_PID:-}" && "${SERIAL:-}" == emulator-5556 ]] || {
    echo 'RACE_ENVIRONMENT_UNVERIFIED: use test-android-installed.sh'; return 2;
  }
  local kind=${1:-race} process=${TRACK_PROCESS:-$PACKAGE}
  [[ "$kind" == race || "$kind" == split ]] || return 2
  local control=${PASSENGER_RESTART_NO_TRIGGER:-0} independent=${PASSENGER_RESTART_RACE_ONLY:-0}
  [[ "$control" == 0 || "$control" == 1 ]] || return 2
  [[ "$control" == 0 || ( "$independent" == 1 && "$kind" == race && "$process" == app.passengercount:tracking ) ]] || {
    echo 'NO_TRIGGER_CONTROL_REQUIRES_INDEPENDENT_FULL_ABSENCE_FIXTURE'; return 2;
  }
  local absence_ns= slot_start= slot_end= first_services_start= first_services_end=
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
  race_capture_services "$OUT/race-before-services.txt"
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
      # Retain the actual native status even when this observation is rejected.
      # Diagnostic metadata only: the original gate's command/timing path stays unchanged.
      if [[ "$independent" == 1 ]]; then
        printf '%s\n' "$absence_code" > "$OUT/race-absent-pids.exit-code.txt" || true
      fi
      if [[ "$absence_code" != 1 || -s "$OUT/race-absent-pids.txt" || -s "$OUT/race-absent-pids.stderr" ]] \
        || ! grep -Fq "ActivityManager: Process $PACKAGE (pid $ui_pid) has died:" "$OUT/race-scheduling-logcat.txt"; then
        echo 'RACE_ALL_PROCESS_ABSENCE_UNVERIFIED'; return 2;
      fi
      if [[ "$independent" == 1 ]]; then
        absence_ns="$(race_host_timing now)" || true
      fi
      if [[ "$control" == 1 ]]; then
        printf 'ALL_PACKAGE_PROCESSES_ABSENT before_control_idle=true\n' > "$OUT/race-process-scope.txt" || return 2
      else
        printf 'ALL_PACKAGE_PROCESSES_ABSENT before_helper=true\n' > "$OUT/race-process-scope.txt"
      fi
    fi
  fi
  # Shell gets its own foreground-start exemption; it is used only for the other
  # package. The tested target is restarted solely by ActivityManager.
  if [[ "$control" == 1 ]]; then
    printf 'INDEPENDENT NO-TRIGGER CONTROL: same full absence; host idle only; not acceptance\n' > "$OUT/no-trigger-control.txt" || return 2
    # Failure to replay timing is explicit uncertainty, but must not prevent
    # collecting a later known denial from the already killed target.
    race_host_timing idle "$OUT/../race-trigger-slot.json" "$OUT/race-trigger-slot.json" "$absence_ns" \
      > "$OUT/host-idle.stdout" 2> "$OUT/host-idle.stderr" || true
  elif [[ "$independent" == 1 ]]; then
    slot_start="$(race_host_timing now)" || true
    local trigger_code
    if race_capture "$OUT/race-trigger.txt" shell am start-foreground-service -n "$component" -a app.passengercount.tests.TRIGGER; then
      trigger_code=0
    else trigger_code=$?; fi
    slot_end="$(race_host_timing now)" || true
    race_host_timing record "$OUT/race-trigger-slot.json" "$absence_ns" "$slot_start" "$slot_end" "$trigger_code" \
      > "$OUT/host-trigger-timing.stdout" 2> "$OUT/host-trigger-timing.stderr" || true
    [[ "$trigger_code" == 0 ]] || return "$trigger_code"
    if grep -Eq 'Error|Exception|Permission Denial' "$OUT/race-trigger.txt"; then return 2; fi
  else
    race_capture "$OUT/race-trigger.txt" shell am start-foreground-service -n "$component" -a app.passengercount.tests.TRIGGER
    if grep -Eq 'Error|Exception|Permission Denial' "$OUT/race-trigger.txt"; then return 2; fi
  fi
  deadline=$((SECONDS+75))
  local code=2 observation first_observation=true
  local classifier_control=()
  [[ "$control" != 1 ]] || classifier_control=(--no-trigger-control)
  while ((SECONDS<deadline)); do
    # A later partial capture must never overwrite the inputs of the last
    # complete classification. Keep every attempt, including failed raw output.
    observation="$(mktemp -d "$OUT/race-observation.XXXXXX")" || return 2
    race_capture "$observation/logcat.txt" logcat -d -v threadtime || return 2
    if [[ "$independent" == 1 && "$first_observation" == true ]]; then
      if [[ "$control" == 1 ]]; then
        local alignment_code
        if first_services_start="$(race_host_timing align-first-services "$OUT/../race-trigger-slot.json" \
          "$OUT/../race-first-services-timing.json" "$OUT/race-trigger-slot.json" \
          "$OUT/race-first-services-alignment.json" 2> "$OUT/host-first-services-alignment.stderr")"; then
          alignment_code=0
        else alignment_code=$?; fi
        printf '%s\n' "$first_services_start" > "$OUT/host-first-services-alignment.stdout" || true
        printf '%s\n' "$alignment_code" > "$OUT/host-first-services-alignment.exit-code.txt" || true
        # Alignment failure never skips the real snapshot or hides a denial.
        if [[ "$alignment_code" != 0 ]]; then first_services_start="$(race_host_timing now)" || true; fi
      else
        first_services_start="$(race_host_timing now)" || true
      fi
    fi
    race_capture_services "$observation/services.txt" || return 2
    if [[ "$independent" == 1 && "$first_observation" == true ]]; then
      first_services_end="$(race_host_timing now)" || true
      race_host_timing first-services "$OUT/race-trigger-slot.json" "$OUT/race-first-services-timing.json" \
        "$first_services_start" "$first_services_end" > "$OUT/host-first-services-timing.stdout" \
        2> "$OUT/host-first-services-timing.stderr" || true
    fi
    first_observation=false
    if node "$ROOT/scripts/analyze-android-restart-race.mjs" \
      "$observation/logcat.txt" "$observation/services.txt" "$oldpid" "$kind" "$process" \
      --publish "$OUT/race-result.json" "${classifier_control[@]}" > "$observation/classifier.stdout" 2> "$observation/classifier.stderr"; then
      code=0
    else code=$?; fi
    if ! printf '%s\n' "$code" > "$observation/classifier-exit-code.txt"; then
      [[ "$code" != 10 ]] || return 1
      return 2
    fi
    if [[ "$code" == 10 ]]; then
      code=1
    elif [[ "$code" != 0 && "$code" != 2 ]]; then
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
  if [[ "$control" == 1 ]]; then
    printf 'OBSERVATION ONLY: target foreground was observed without a trigger; no reattachment, GPS/session proof or acceptance claim\n' > "$OUT/race-result.txt" || return 2
    return 0
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
