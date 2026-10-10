# Legacy export permission recovery (PC-004)

## Reproduced baseline

Reproduction base: `a4834b378f2edd1aaf343fc28fea5651de8383b8`, including PC-001,
PC-002 and PC-003. Before publication, the candidate was fast-forwarded onto
`9fb3548343cd90e8a55b1295a4fb3aee4d06789d`, preserving PC-005's merged
momentum validation, tests, report and service-worker v15. No code from the older
feature PR #3 is incorporated.

On Android 8–9, default-folder export without a storage grant stores its pending
`Runnable` only in the Activity. When that Activity is recreated while the
permission prompt is pending, the replacement has no task to run and no failure
result to show. The saved survey is separate and remains intact. This is an
ordinary export interruption, not evidence of lost survey data or a live-user
incident.

The host fixture extracts the actual production field declarations,
`queueExport`, permission callback, `onDestroy`, and `getExportResult` methods
and compiles/runs them with Java 8 source/target compatibility. Android framework
calls and persistence are explicit test doubles. The initial 22-scenario fixture
failed **12 scenarios** on the baseline: recreation/process loss, a stale reply
consuming a later request, persistence failure, permission-launch failure and
queued UI work after destruction, on both simulated API 26 and API 28.
Existing immediate-grant, repeated-tap, SAF and API 29/35 controls passed.
Later boundary/repeated-restoration assertions were added to the candidate;
those additions are not claimed as part of the initial baseline run.

## Bounded correction

Before requesting legacy storage permission, synchronously persist a recoverable
failure result using the existing export-result format. Do not emit that fallback
to the still-waiting page. A reloaded page already reads this result and displays
the existing English/Cantonese message that the trip remains saved and export
can be retried. Store no export bytes, filename or automatic replay instruction.

Within an uninterrupted Activity, grant still exports the accepted task once;
denial still reports failure. Destroyed Activities clear their pending task and
reject queued UI work. A thrown permission-launch error clears the pending task
for an explicit retry. A failed durable commit never launches the prompt.

Persist monotonically increasing request codes in Android's lower-16-bit range
1024–65535. Codes are not reused after denial or process recreation. Delayed or
duplicate replies cannot consume a newer request. After exhausting the range,
fail recoverably rather than wrapping; an already granted permission, SAF folder,
or API 29+ default folder does not use this counter.

CSV, PNG and GPX keep their existing shared queue and encoding/storage behavior.
Location permission behavior, SAF grants and public-storage writers are unchanged.
The initial candidate changed no web assets. The subsequent granted-write review
fix adds pending-state UI handling and service-worker v16; see the linked follow-up
below. No real device permission/settings were changed.

## Candidate checks, 9 October 2026

- `npm ci --ignore-scripts`: passed with the existing lockfile.
- `npm test`: **98/98 passed** on the combined current-main candidate, preserving
  PC-001/002/003 and PC-005 regressions. The initial pre-PC-005 run passed 89/89.
- `npm run test:native`: **97 TrackJournal** and **26 TrackSession** assertions
  passed, plus the new export-permission fixture.
- Latest `node scripts/test-export-permission.cjs`: **136 assertions across
  26 scenarios passed**, including simulated API 26/28 grant, denial, duplicate
  grant/denial, repeated taps, recreation, process-loss persistence, repeated
  restoration/readback, stale callbacks after a later request, failed commit,
  failed prompt launch, destroyed-Activity queued work, code exhaustion, SAF,
  already-granted permission and API 29/35 controls.
- `node --check tests/browser.cjs`,
  `node --check tests/export-permission-browser.cjs`, and `git diff --check`: passed.
- Local Chromium: blocked before tests start by
  `process_singleton_posix.cc` / `socket() failed: Operation not permitted`.
  No local browser pass is claimed.
- Local APK compile/signature: not run; no configured Android SDK.

`tests/export-permission-browser.cjs`, included in the existing browser CI suite,
seeds the exact fallback result and checks both languages: visible retry feedback,
retained survey observations, no automatic export and an explicit CSV retry.
It uses the existing simulated native bridge, not real Android storage.

## Acceptance and remaining limits

Publication is not acceptance. Check Codex review and the existing full CI on the
exact PR head, including browser tests and APK compile/signature validation.
Android framework lifecycle dispatch, an actual permission dialog, OEM behavior
and physical public-storage/provider I/O still need separately authorized device
validation; host/API-labelled fixtures do not establish those runtime outcomes.

## Granted-write review follow-up

Codex identified a valid additional Activity-lifecycle gap after permission grant
while the file write is still running. The initial head `ab63f23243` passed CI but
is not an accepted final head. [The follow-up report](pc004-granted-write-followup.md)
records the reproduction, correction and expanded final-candidate coverage.

The latest [result-persistence follow-up](pc004-result-persistence-followup.md)
also distinguishes retry-safe permission interruption from an uncertain output
once writing may have started, including failed final commits and process restart.

The [visible-observer transition matrix](pc004-observer-transition-matrix.md)
records the subsequent stacked-Activity review correction and the latest systematic
resume/destroy/completion, permission-owner and process-restart coverage.
