# Survey edit-history integrity

Base: `fb48d501b2d2bb260808c622cccbe57699184afb` (main).

## Scope

- Make Undo/Redo snapshots an explicit set of editable survey fields. Keep the live survey object and independently recorded track, native cursor, calendar/weather/ETA evidence, upload state, lifecycle state, and view/cache metadata.
- Rebase history at start, pause, abort, completion, resume and continuation boundaries. An ordinary count correction must not undo those boundaries. Joining another section on an already active survey remains undoable.
- Use the same final-count preservation and conflict validation for completed-record section joins and explicit continuation. Rejected joins retain all fields, keep the dialog open, and display the existing correction message.
- Keep manual weather-event application in editable history while retaining fetched snapshots. Preserve stable stop-occurrence references through insertion/join/Undo/Redo and asynchronous replies; synchronize the keypad target and replacement buffer to the stop restored by history.
- Refresh the service-worker cache name so web installations receive the updated handlers.

This change is independent of PR #10. It does not include that PR's upload contract, receipt invalidation, deletion or Android-harness work. `edit()` on this main-based branch retains main's existing upload invalidation behavior; Undo/Redo itself no longer snapshots or replaces the live upload object. The shared history hunks must be reconciled deliberately when integrating both changes.

## Reproducible checks

- `npm test`: 155 tests pass, including 26 production-handler history tests and three additional section-join tests.
- Negative control: run the same history/survey tests with only `app.js` and `survey.js` replaced by the exact base versions. All 29 new regressions fail; the 21 existing survey tests pass. The fixture tolerates the absence of the new snapshot helper so failures are behavioral assertions rather than a missing-helper setup error.
- `npm run test:native`: 97 journal assertions across 12 scenarios, 26 session assertions, 1,148 export lifecycle assertions and 928 production-writer assertions pass. Native code is unchanged.
- Browser regressions were added to the normal `npm run test:browser` workflow for GPS received after a count edit, completed-record continuation followed by edit/Undo/Redo, weather event application and next-digit targeting after history restoration. The local Chromium process failed at Unix socket creation (`EPERM`) before tests began. No local browser-pass claim is made; hosted CI must validate these tests and the normal Android build.

The handler tests execute the actual app functions, actual native-import module, actual local save/load module and actual GPX serializer with synthetic points, storage and bridge commands. They cover fixes arriving on either side of history operations, same-time native occurrences, cursor idempotency, asynchronous evidence/object identity, no-op edits, initial start, first edit after cold restoration, stopped-state resume, repeated completion/continuation, failed stop/save retries, section-join boundaries, editable active joins and insertions, and conflict no-ops. Additional regressions cover late weather/ETA completion, repeated provider stop IDs, removed/restored occurrences, cold-load persistence of occurrence identities, unverified legacy indices, manual weather event application and the next keypad digit after Undo. They do not constitute installed Android or physical-device validation.

## Evidence representation

Each survey stop has a stable, survey-local `occurrenceId`; `nextStopOccurrence` is monotonic and excluded from edit history. Repeated visits to the same provider stop have different occurrence IDs. A weather event or ETA result carries `stopRef`, and an ETA capture carries `currentStopRef`: these retain the original capture index and a copy of the original stop. Current `stopIndex`/`currentStop` values follow that occurrence through route edits or become `null` when it is absent. Undo/Redo does not discard the captured evidence. New IDs are not reused after Undo or reload.

Legacy index-only evidence cannot establish an original occurrence, because older versions could change the route without updating evidence indices. Its original index/provider ID is retained with `association: "unverified-legacy-index"`, no inferred stop snapshot or occurrence ID, and a null current index. This deliberately avoids guessing from repeated provider IDs.

Manual weather-change events remain in the exported ledger. `undone: true` means that manual change is currently unapplied; its fetched snapshot remains available if the edit is redone. The record summary counts only applied events. Automatic start events are never part of this manual-edit projection, and their initial emoji and stop reference are captured before asynchronous requests.

The keypad/history mismatch fixed here also exists on the baseline: history could restore active stop A while the next digit still targeted B. Restoring history now rebinds the keypad target and resets the replace/append buffer to the visible stop.

## Source verification

All 105 baseline files were materialized and checked against the exact main tree. The route catalogue was downloaded from the exact official raw commit URL and verified as 1,246,628 bytes with Git blob `75a7bf6e1614adb91907d233af691bbf8ad8c7a1`. No live transport/weather/database service was used for tests.

## Acceptance still required

- Hosted CI on the final candidate.
- Independent code review of current source and event ordering.
- Deliberate integration with PR #10's overlapping history changes and repeat checks on the combined result.
- Existing installed-device validation remains separate; host tests do not replace it.
