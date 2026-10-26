#!/usr/bin/env bash
# A separate CI step. Success here never changes the already failed original step.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ORIGINAL="$ROOT/android/build/lifecycle-evidence"
OUT="$ROOT/android/build/restart-race-evidence"
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
  if PASSENGER_RESTART_RACE_ONLY=1 bash "$ROOT/scripts/test-android-installed.sh"; then
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
if timeout --kill-after=2s 15s python3 "$ROOT/scripts/analyze-android-foreground-observation.py" "$OUT" \
  > "$OUT/foreground-observation.stdout" 2> "$OUT/foreground-observation.stderr"; then
  observation_code=0
else observation_code=$?; fi
if ! printf '%s\n' "$observation_code" > "$OUT/foreground-observation-exit-code.txt"; then
  echo "FOREGROUND_OBSERVATION_RECEIPT_UNAVAILABLE: exit=$observation_code; diagnostic exit=$diagnostic_code retained" >&2
fi
if [[ "$original_hashes" != "$(find "$ORIGINAL" -type f -print0 | sort -z | xargs -0 sha256sum)" ]]; then
  echo 'Original evidence unexpectedly changed during diagnostic; both results require investigation' >&2
  exit 3
fi
if ! printf '%s\n' "$diagnostic_code" > "$OUT/diagnostic-step-exit-code.txt"; then
  echo "DIAGNOSTIC_EXIT_RECEIPT_UNAVAILABLE: retaining diagnostic exit=$diagnostic_code and original exit=$original_code" >&2
fi
printf 'Original lifecycle remains FAILED (exit=%s); independent diagnostic exit=%s\n' "$original_code" "$diagnostic_code"
exit "$diagnostic_code"
