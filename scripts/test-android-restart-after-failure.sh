#!/usr/bin/env bash
# A separate CI step. Success here never changes the already failed original step.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ORIGINAL="$ROOT/android/build/lifecycle-evidence"
OUT="$ROOT/android/build/restart-race-evidence"
step_started=$SECONDS
CONTROL_MAX_SECONDS=180
[[ "${CI:-}" == true && "${PASSENGER_RESTART_RACE:-0}" == 1 ]] || {
  echo 'Post-failure diagnostic requires owned CI and explicit opt-in' >&2; exit 2;
}
[[ -f "$ORIGINAL/exit-code.txt" && -f "$ORIGINAL/source.txt" ]] || {
  echo 'Original validation receipt is missing; refusing to substitute a diagnostic' >&2; exit 2;
}
original_code="$(cat "$ORIGINAL/exit-code.txt")"
[[ "$original_code" =~ ^[1-9][0-9]*$ ]] || {
  echo 'Original validation did not record failure; this path is not applicable' >&2; exit 2;
}
# Hash all retained original evidence, not just the status receipt.
original_hashes="$(find "$ORIGINAL" -type f -print0 | sort -z | xargs -0 sha256sum)"
mkdir -p "$OUT"
printf '%s\n' "$original_code" > "$OUT/original-validation-exit-code.txt"
cp "$ORIGINAL/source.txt" "$OUT/original-validation-source.txt"
printf 'Original lifecycle exit=%s remains FAILED; starting independent diagnostic\n' "$original_code"
# Device access can change after the first emulator exits. Reuse exactly the
# existing hosted-runner check/grant, preserving the original evidence directory.
if bash "$ROOT/scripts/ensure-android-kvm.sh" diagnostic; then
  if PASSENGER_RESTART_RACE_ONLY=1 PASSENGER_RESTART_NO_TRIGGER=0 bash "$ROOT/scripts/test-android-installed.sh"; then
    diagnostic_code=0
  else
    diagnostic_code=$?
  fi
else
  diagnostic_code=$?
fi
# Pure host interpretation of the independent diagnostic's richer existing
# snapshots. This never runs against a device, changes a classifier result, or
# substitutes its own completion for either original/diagnostic gate status.
observe_bookkeeping() {
  local directory=$1 observation_code
  if timeout --kill-after=2s 15s python3 "$ROOT/scripts/analyze-android-foreground-observation.py" "$directory" \
    > "$directory/foreground-observation.stdout" 2> "$directory/foreground-observation.stderr"; then
    observation_code=0
  else observation_code=$?; fi
  if ! printf '%s\n' "$observation_code" > "$directory/foreground-observation-exit-code.txt"; then
    echo "FOREGROUND_OBSERVATION_RECEIPT_UNAVAILABLE: exit=$observation_code; diagnostic exit=$diagnostic_code retained" >&2
  fi
  return 0
}
observe_bookkeeping "$OUT"
if [[ "$original_hashes" != "$(find "$ORIGINAL" -type f -print0 | sort -z | xargs -0 sha256sum)" ]]; then
  echo 'Original evidence unexpectedly changed during diagnostic; both results require investigation' >&2
  exit 3
fi
if ! printf '%s\n' "$diagnostic_code" > "$OUT/diagnostic-step-exit-code.txt"; then
  echo "DIAGNOSTIC_EXIT_RECEIPT_UNAVAILABLE: retaining diagnostic exit=$diagnostic_code and original exit=$original_code" >&2
fi
# The triggered result is committed before the independent no-trigger leg.
# All control files live below this one child; nothing overwrites triggered raw
# evidence, its classifier pointer, host observer, or native exit receipts.
CONTROL="$OUT/no-trigger-control"
control_code=2
control_status=not-run
control_created=false
comparison_integrity=verified
if mkdir "$CONTROL"; then
  control_created=true
  # Reserve 40s of the existing 8-minute step for forced kill, host parsing,
  # integrity receipts and scheduling overhead. Never extend the workflow limit.
  control_budget=$((440 - (SECONDS-step_started)))
  ((control_budget <= CONTROL_MAX_SECONDS)) || control_budget=$CONTROL_MAX_SECONDS
  if triggered_hashes="$(find "$OUT" -path "$CONTROL" -prune -o -type f -print0 | sort -z | xargs -0 sha256sum)"; then
    printf '%s\n' "$triggered_hashes" > "$CONTROL/triggered-input-hashes.txt" || true
    printf '%s\n' "$diagnostic_code" > "$CONTROL/triggered-native-exit-code.txt" || true
    if [[ ! -f "$OUT/race-trigger-slot.json" ]]; then
      control_status=not-run-timing-input-unavailable
    elif ((control_budget <= 0)); then
      control_status=not-run-step-budget-exhausted
    else
      printf '%s\n' "$control_budget" > "$CONTROL/outer-timeout-seconds.txt" || true
      # Same runner, APK, image, setup and warmup; a new owned emulator and a
      # separate destination. SIGTERM/forced kill act only on this child group.
      if timeout --kill-after=5s "${control_budget}s" env PASSENGER_RESTART_RACE_ONLY=1 PASSENGER_RESTART_NO_TRIGGER=1 \
        bash -c 'bash "$1/scripts/ensure-android-kvm.sh" diagnostic && exec bash "$1/scripts/test-android-installed.sh"' _ "$ROOT" \
        > "$CONTROL/runner.stdout" 2> "$CONTROL/runner.stderr"; then control_code=0; else control_code=$?; fi
      case "$control_code" in
        124) control_status=incomplete-timeout ;;
        137) control_status=incomplete-forced-kill ;;
        *) control_status=process-exited-not-acceptance ;;
      esac
    fi
    if ! printf '%s\n' "$control_code" > "$CONTROL/control-exit-code.txt"; then
      echo "CONTROL_EXIT_RECEIPT_UNAVAILABLE: control=$control_code; triggered=$diagnostic_code retained" >&2
    fi
    printf '%s\n' "$control_status" > "$CONTROL/control-status.txt" || true
    observe_bookkeeping "$CONTROL"
    if after_triggered_hashes="$(find "$OUT" -path "$CONTROL" -prune -o -type f -print0 | sort -z | xargs -0 sha256sum)" \
      && [[ "$triggered_hashes" == "$after_triggered_hashes" ]]; then
      printf 'verified-unchanged\n' > "$CONTROL/triggered-evidence-status.txt" || true
    else
      comparison_integrity=unverified
      printf 'changed-or-unverified\n' > "$CONTROL/triggered-evidence-status.txt" || true
      echo 'CONTROL_COMPARISON_INVALID: triggered evidence changed; retained native failure is not erased' >&2
    fi
  else
    echo 'CONTROL_NOT_RUN: triggered evidence identity unavailable; triggered exit retained' >&2
  fi
else
  echo 'CONTROL_NOT_RUN: output directory unavailable or preexisting; triggered exit retained' >&2
fi
if after_original_hashes="$(find "$ORIGINAL" -type f -print0 | sort -z | xargs -0 sha256sum)" \
  && [[ "$original_hashes" == "$after_original_hashes" ]]; then :; else
  comparison_integrity=unverified
  echo 'CONTROL_COMPARISON_INVALID: original evidence changed; original/triggered native failures remain binding' >&2
  [[ "$control_created" != true ]] || printf 'changed-or-unverified\n' > "$CONTROL/original-evidence-status.txt" || true
fi
paired_code=$diagnostic_code
[[ "$paired_code" != 0 ]] || paired_code=$control_code
[[ "$paired_code" != 0 || "$comparison_integrity" == verified ]] || paired_code=2
if [[ "$control_created" == true ]]; then
  printf '%s\n' "$paired_code" > "$CONTROL/paired-wrapper-exit-code.txt" || true
fi
printf 'Paired diagnostic wrapper exit=%s (triggered native=%s, control native=%s); not original acceptance\n' "$paired_code" "$diagnostic_code" "$control_code"
printf 'Original lifecycle remains FAILED (exit=%s); independent diagnostic exit=%s\n' "$original_code" "$diagnostic_code"
exit "$paired_code"
