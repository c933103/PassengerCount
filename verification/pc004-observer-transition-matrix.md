# PC-004: visible Activity ownership and event-order matrix

## Review finding and adjacent reproduction

The ready-triggered [Codex P2](https://github.com/c933103/PassengerCount/pull/8#discussion_r4228321401)
found a valid observer gap in `1db16ac550fc61c495e538c3a73cd04903713509`.
A newer standard-launch Activity could replace the older Activity's observer;
closing the newer instance then left the still-alive older page unobserved. Its
controls could remain pending after a write completed. Resuming must both attach
that visible instance and read the latest state, including completion while no
observer was eligible.

Before the correction, six added simulated API 26/28 cases failed: returning to
the older Activity before or after completion, and resuming while its original
permission request was still pending (458 assertions, six failing cases).

The two-live-Activity inspection also exposed a permission-wait ownership gap:
a newer Activity could read the retry-safe disk marker while the older live
Activity still owned an accepted permission request. Four focused grant/destroy
cases failed before the process reservation was added (972 assertions, four
failures in that intermediate fixture). This is a distinct pre-grant state, not
proof of a device incident.

## Bounded state rules

| State | Durable result | Process owner | Visible page |
| --- | --- | --- | --- |
| Waiting for permission | Retry-safe failure; no file task has started | One live Activity owns the reservation | Pending in every Activity; no second prompt/export |
| File submitted/running | Outcome uncertain | Process write gate | Pending; export controls disabled |
| Completed result committed | Success or known failure | None | Latest result, including on a later resume |
| File outcome could not be committed | Outcome uncertain remains durable | None after settlement | Check the folder; never silently retry/replay |
| Waiting owner destroyed | Retry-safe failure | Reservation released | Current resumed page gets cancellation result |
| Process restart | Last durable result only | Fresh empty process session | Retry-safe before submission; uncertain if mutation could have started |

Observer eligibility follows resume/pause/destroy, not creation order. Only the
latest resumed instance is attached. Pausing or destroying a stale instance cannot
detach another owner; a destroyed instance cannot steal ownership by a late resume.
Every resume reads a fresh state snapshot. File completion and permission denial
notify the current eligible observer rather than the initiating, possibly paused
Activity. A permission reservation transfers atomically into its owner's write
gate, or is released on denial/launch failure/destruction. No payload, filename,
reservation or pending state is persisted for automatic replay.

## Systematic event ordering

The production-method fixture starts with two live Activities and one held write.
It checks all six permutations below for both possible returning Activity owners,
on both simulated API 26 and API 28: **24 matrix cases**.

| Event order | Required final behavior |
| --- | --- |
| Resume, stale destroy, finish | Returning owner receives completion |
| Resume, finish, stale destroy | Stale teardown cannot remove the returning owner |
| Stale destroy, resume, finish | Returning owner receives completion |
| Stale destroy, finish, resume | Resume catches the missed durable result |
| Finish, resume, stale destroy | Snapshot remains usable after stale teardown |
| Finish, stale destroy, resume | Returning owner catches completion without a live observer |

Each case repeats resume, result reads and old permission callbacks, then invokes
stale pause/destroy/resume and starts a later explicit export. The original file
is written once; the latest eligible owner still receives the later completion.
Separate two-live-Activity cases cover permission grant, denial and destruction,
no duplicate admission, cancellation delivery and explicit subsequent retry.
Earlier cases continue to cover process restart, failed pre-write/final commits,
uncertain result acknowledgement, executor rejection and queued old UI delivery.

The process-loss fixture preserves only its durable preference snapshot and resets
the actual `ExportSession` fields to fresh-instance defaults. That models loss of
static memory; it does not claim to kill a real Android process or exercise real
framework lifecycle scheduling.

## Candidate verification

- `npm test`: **102/102 passed**.
- `npm run test:native`: **97 TrackJournal**, **26 TrackSession**, and
  **1,028 export-lifecycle assertions across 76 scenarios passed**.
- The fixture compiles actual source-extracted queue/result/resume/pause/destroy
  methods and the real `ExportSession`, using explicit framework/persistence doubles.
- JavaScript test-runner syntax and `git diff --check`: passed.
- No web assets, translations, uncertainty marker semantics, storage writers or
  service-worker version are changed by this revision; prior PC-005 and SW v16
  are preserved.

The previous head's green CI/manual review is not final acceptance. Fresh exact-head
Code/Security review and full existing browser/APK CI are required. Installed-device
permission dialogs, framework lifecycle dispatch and physical provider/file I/O
remain separate validation; no such device pass is claimed.
