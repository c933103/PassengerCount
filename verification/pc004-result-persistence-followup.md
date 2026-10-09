# PC-004: distinguish uncertain output from retry-safe failure

## Review finding reproduced

[Codex P2](https://github.com/c933103/PassengerCount/pull/8#discussion_r4228171910)
correctly identified the final-result persistence boundary in
`a5b9961a68c10a77cd8ce274351a9524315ec947`. A public file could be saved while
committing its success to app-private preferences failed. The in-memory preference
could show success, while a new process read the old failure marker and offered
retry. A crash between successful file creation and result persistence has the same
ambiguity; checking only the final `commit()` cannot make two destinations atomic.

A fixture against that head forced the final commit to fail after a successful
write. On both simulated API 26 and API 28 the regression failed with:

```
file count 1 but restart read {"ok":false,"path":""}
```

The 38 existing scenarios still passed. With the two added regression cases,
the baseline executed 370 assertions and had two failures. No real Android
permission, storage setting, public file or physical device was used.

## Correction

- The permission-wait marker remains retry-safe failure because no file write has
  started. Activity/process loss at that stage still shows the existing retry text.
- Before any file submission, synchronously commit `{"uncertain":true}`. If that
  commit fails, do not submit the file task. Tests separately fail this commit
  after the permission-wait marker was successfully stored.
- An interrupted write may or may not have created output. A new process therefore
  sees a check-folder warning, never a promise that no file was saved or an
  indefinitely pending state. It does not automatically export anything.
- Check the final result commit. On failure, replace the in-memory unconfirmed
  success with uncertainty as well. An asynchronous best-effort update may retain
  that conservative state; correctness does not depend on it succeeding because
  the pre-write uncertain marker was already committed.
- A known failed write can still report failure in the live process. If that result
  cannot be persisted, a restart remains conservatively uncertain. This separates
  what the process knows from what a future process can safely conclude.
- English and Cantonese explain that a file may already have been saved and ask the
  user to inspect the export folder before exporting again. Saved surveys remain
  intact, and no filename/payload is persisted for replay.

This does not claim an atomic transaction between public storage and preferences,
exactly-once writes across process death, or proof that every uncertain export
created a file. The visible uncertainty is intentional.

## Revised candidate checks

- `npm test`: **102/102 passed**.
- `npm run test:native`: **97 TrackJournal**, **26 TrackSession**, and
  **432 export-lifecycle assertions across 44 scenarios passed**.
- New controlled-commit cases cover failed pre-write uncertainty persistence,
  success/failure followed by failed final result persistence, recreation with
  durable-only preferences, duplicate old callbacks, no automatic replay, and
  a later explicit export after checking the destination.
- The UI unit fixture distinguishes `exportUncertain` from `exportFailed`.
  Browser CI additionally checks both languages' check-folder text, warning state,
  no automatic export and unchanged saved observations for restored uncertainty.
- Syntax checks and `git diff --check` passed.

These are source-extracted Java methods, the real `ExportSession` implementation,
and simulated native/permission/lifecycle calls. Local Chromium remains blocked
before startup and no Android SDK is configured locally. Fresh exact-head full
browser/APK CI and Codex review are still required; earlier a5b9961 CI success
([37904728872](https://github.com/c933103/PassengerCount/actions/runs/37904728872))
is not acceptance of this new revision.
