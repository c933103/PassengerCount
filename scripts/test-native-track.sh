#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD="$(mktemp -d)"
trap 'rm -rf "$BUILD"' EXIT
# Some JDK images expose javac through the compiler module only.
java com.sun.tools.javac.Main -encoding UTF-8 -source 8 -target 8 -d "$BUILD" \
  "$ROOT/android/src/app/passengercount/TrackJournal.java" \
  "$ROOT/tests/native/TrackJournalTest.java"
java -cp "$BUILD" app.passengercount.TrackJournalTest
java com.sun.tools.javac.Main -encoding UTF-8 -source 8 -target 8 -d "$BUILD" \
  "$ROOT/android/src/app/passengercount/TrackSession.java" \
  "$ROOT/tests/native/TrackSessionTest.java"
java -cp "$BUILD" app.passengercount.TrackSessionTest

node "$ROOT/scripts/test-export-permission.cjs"
