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
if PASSENGER_RESTART_RACE_ONLY=1 bash "$ROOT/scripts/test-android-installed.sh"; then
  diagnostic_code=0
else
  diagnostic_code=$?
fi
if [[ "$original_hashes" != "$(find "$ORIGINAL" -type f -print0 | sort -z | xargs -0 sha256sum)" ]]; then
  echo 'Original evidence unexpectedly changed during diagnostic; both results require investigation' >&2
  exit 3
fi
printf '%s\n' "$diagnostic_code" > "$OUT/diagnostic-step-exit-code.txt"
printf 'Original lifecycle remains FAILED (exit=%s); independent diagnostic exit=%s\n' "$original_code" "$diagnostic_code"
exit "$diagnostic_code"
