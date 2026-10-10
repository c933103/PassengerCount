# PR #3: preserve uncertainty when export rollback is incomplete

## Reviewed finding and reproduced outcome

The current-head review of published `c71de6bbf28f1cba676fee9c332917625b64e8a5` found [P2: incomplete bundle rollback must be uncertain](https://github.com/c933103/PassengerCount/pull/3#discussion_r4235905298).

A production-writer reproduction fails the third companion open and makes every MediaStore delete return zero. The published writer reports an ordinary IOException while three rows and two written companions remain. With the correction, the same provider state and three attempted deletions produce `UncertainExportException`. The correction does not pretend to remove files when the provider refuses cleanup; it preserves the user's check-folder guidance.

The old source passed both full CI runs, [push 38014506063](https://github.com/c933103/PassengerCount/actions/runs/38014506063) and [PR 38014509644](https://github.com/c933103/PassengerCount/actions/runs/38014509644). Those results remain evidence for that exact old head, not acceptance of this correction. Its validation APK was inspected separately: version 1.10/code 11, reviewed assets exact, v2/v3 signatures valid under the ephemeral validation certificate. No production signing or installed-device claim follows.

## Bounded correction

- Production ExportStorage emits a typed `UncertainExportException` when cleanup of newly created output is unconfirmed. MediaStore requires a successful single-row deletion; SAF requires confirmed document deletion. Both false/zero returns and thrown cleanup errors are handled.
- Bundle rollback continues attempting the other known companions after any one deletion fails. If the failed current-file cleanup was already uncertain, successful deletion of earlier companions cannot erase that uncertainty.
- Legacy write cleanup checks File.delete(), including exceptions. Recursive cleanup checks every child and directory and treats an unreadable directory as unconfirmed. If removing the whole fresh legacy bundle directory succeeds, that confirmed final rollback can restore retry-safe failure.
- All four native export bridge methods use the same outcome mapper. Typed uncertainty is stored as the existing `{"uncertain":true}` result. Ordinary failures with confirmed rollback keep the existing retry-safe failure. The durable uncertainty-before-write marker, result commit fallback, queue, observer ownership, pending gate and session settlement are unchanged.
- This correction does not alter export snapshot data, upload payloads, PNG identity, journal handling, service worker, workflow, packaging, version or signing configuration.

## Executed verification

- `npm test`: 126 passed; none failed/skipped/cancelled.
- `npm run test:native`: TrackJournal 97 and TrackSession 26 assertions passed; actual source-extracted export lifecycle/outcome methods passed 1,148 assertions across 84 scenarios; actual production ExportStorage passed 928 assertions.
- Writer controls include zero-return and thrown deletions at every rollback position after each of the four open/publication failure positions, on API 29/35. They assert retained rows/bytes, continued cleanup attempts, uncertainty and no automatic replay. Standalone MediaStore/SAF, SAF directory rollback and legacy cleanup outcomes are covered as host/provider simulations.
- Actual lifecycle outcome-mapper controls cover ordinary versus uncertain writer errors, successful versus failed final result commit, live result, session settlement, durable restart result, no automatic replay and later explicit retry. The storage writer and Activity lifecycle are separate host harnesses; this is not a full installed Android execution.
- The same permanent writer oracle run against the published c71de6b writer fails behaviorally as expected on incomplete cleanup; see `negative-control.log`.
- The original concrete reproduction is recorded in `rollback-reproduction.log` before and after correction.
- JavaScript syntax, shell syntax and diff-whitespace checks passed. Source preservation is recorded in `preservation-proof.json`.

## Remaining gates

Review this bounded correction before publication. After publication, require fresh exact-head code review, browser/APK/signature CI and artifact inspection. Keep the review thread open until the corrected source and evidence have been reviewed. Actual Android provider/legacy-filesystem behavior and production signing remain separate from host and ephemeral-validation evidence.
