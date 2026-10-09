# Recording lifecycle and native journal reconciliation (PC-001)

## Controlled baseline reproduction

Freshly fetched `main` at `b3d148e4de7d22f9f6fafeb797a6fd0a61d1f337`
includes the completed PC-002 replay/cursor correction. It does not include open
PR #3's separate upload/export work (`b9fe113aed0a1c6786b7aa5aeb5e9ce1389ae0d5`).
This change starts from that main commit and does not incorporate PR #3.

Before editing production code, the actual baseline `importNativeTrack` was run
with a synthetic one-point native journal and each stopped lifecycle status:

| Status | Expected stored/exported points | Actual points | Native reads |
| --- | ---: | ---: | ---: |
| paused | 1 | 0 | 0 |
| aborted | 1 | 0 | 0 |
| completed | 1 | 0 | 0 |

The baseline's actual extracted `stopNativeTracking` was also executed with a
controlled bridge that appended a final accepted point when stop was requested.
Observed order was `read before stop`, `stop requested`; the saved track contained
only `A`, while the untouched journal contained `A, late-tail`. This establishes
omission from the saved/exported snapshot, not destruction of the native journal
or observed corruption of a user's recording.

## Bounded correction

- Journal import is independent of survey status. It only reads evidence and
  never starts recording. The UUID/legacy identities, anchored per-survey cursors,
  chronological/native-occurrence ordering, atomic cursor/track persistence and
  20,000 retained-point limit from PC-002 remain unchanged.
- The new synchronous `stopTrackingAndDrain` bridge acknowledges only after the
  durable recording intent has been cleared. Native journal appends hold the same
  gate through the file write and `fsync`, so acknowledgement waits for accepted
  writes and rejects subsequent callbacks. Service/location-listener cleanup can
  then run on the main thread without blocking the acknowledgement on WebView UI.
- Queued starts and sticky restarts require a matching durable survey ID and
  generation token. Repeated active-screen starts reuse the token; an explicit
  stop/resume gets a new token. A late stop for A cannot cancel B. Each registered
  location listener captures its immutable survey/session, so an old callback
  cannot be relabelled as a new survey's point.
- Legacy `active_id` is removed when intent is written. Native restart no longer
  treats that stale legacy value as authorization to record. The previous
  `stopService(intent)` call never delivered the intent's STOP action; the new
  protocol does not depend on it doing so.
- Pause, abort and completion stop before their final journal drain and Home
  transition. Failed acknowledgement or storage leaves a visible failure and a
  retryable cursor rather than claiming the drain succeeded. GPX export does not
  continue after a failed reconciliation.
- Startup/foreground recovery reconciles saved journals, including completed
  records. Home clears an orphan native intent. Viewing/exporting a completed
  record preserves its status; only explicit Continue recording reopens it.
- Older APK bridges remain compatible through best-effort stop followed by a
  read. They cannot provide the new native acknowledgement guarantee until the
  APK is upgraded; later View/export/startup/foreground reads can recover tails.
- Journal files are never deleted, truncated, rewritten or compacted. No upload
  fields, export format, signing material or unrelated PR #3 code is changed.

## Checks on the candidate, 9 October 2026

- `npm test`: **81 passed**, including actual extracted app pause/abort/complete,
  stop/retry, GPX, cold/foreground recovery and explicit-reopen handlers, plus all
  PC-002 replay/order/cursor tests.
- `npm run test:native`: **97 TrackJournal assertions** and **26 TrackSession
  assertions** passed. The latter includes a real two-thread append/stop barrier,
  late callback/start rejection, same-ID generation rollover, independent survey
  intent, persistent restart and failed persistence. These execute production
  Java helpers but are not Android framework/emulator/physical-device tests.
- `node --check` for changed JS and `git diff --check`: passed.
- Locked `npm ci --ignore-scripts` succeeded using a writable cache.
- Local Chromium: **blocked before browser startup**. Both normal and approved
  escalated attempts fail at Chromium's process-singleton socket with
  `Operation not permitted`. The extended real Playwright UI suite is included
  for CI; no local browser pass is claimed.
- Local Android build: **not run**, because this host has no configured Android
  SDK. The existing PR workflow must compile the APK and verify its ephemeral
  validation signature. There is no production signing or deployment claim.

## Acceptance and limits

Exact-final-head Codex review and the existing full PR CI (Node/native/browser/APK)
remain required. Physical Android background tracking, OS process/service
scheduling, permission UI, screen-off behavior and device-level storage failure
remain device-validation obligations; the controlled gate and browser fixtures do
not establish those outcomes. PR #3 remains a distinct open integration.

## Initial CI fixture correction

[Run 37890674110](https://github.com/c933103/PassengerCount/actions/runs/37890674110)
on `e3e4bc6` passed Node/native checks, then the new completion UI fixture tried
`saveCompleted`, the hidden control for editing an already-completed record,
while its seed was still `in_progress`. It timed out before APK build/signing.
The fixture now clicks the actual active-survey `complete` control. This corrects
the test route; it does not change production behavior or claim the skipped APK
steps passed. Fresh final-head CI/review are still required.
