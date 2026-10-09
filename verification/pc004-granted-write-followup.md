# PC-004: granted write outliving its Activity

## Review finding and reproduction

[Codex P2 review](https://github.com/c933103/PassengerCount/pull/8#discussion_r4228037052)
identified a valid gap in initial head `ab63f2324305cdf1d4d81c6a37399af4a142f952`:
permission grant consumes the Activity's pending request, but a submitted write
can continue after `onDestroy()` because executor shutdown drains accepted work.
The replacement page could read the durable failure fallback and offer retry
before that original write finishes. Its final success event targeted the old,
destroyed WebView. A retry could therefore create a duplicate export.

A controlled fixture compiled the initial head's actual Activity methods, held
its export task after the grant callback, destroyed the Activity, and read the
result from a replacement sharing the same preferences. Both simulated API 26
and API 28 failed with:

```
expected pending but replacement read {"ok":false,"path":""}
```

The initial 136-assertion scenarios continued to pass; the added blocked-write
regression failed on both API values (146 executed assertions, two failures).
This is host-fixture evidence, not an emulator or physical-device reproduction.

## Correction

- A process-local `ExportSession` owns the busy state of submitted writes and
  points to the current Activity's result observer. Teardown only removes its own
  observer, so an old Activity cannot detach a replacement.
- A replacement page reads `{"pending":true}` while the original write runs. The
  CSV/GPX/PNG buttons stay disabled, and native admission independently rejects
  duplicate submissions until the write settles.
- The accepted task still finishes once. Its durable final result is delivered to
  the current Activity, even across repeated recreation. If no Activity exists at
  completion, the next page reads the final result normally.
- Notifications read the current state on UI delivery, so an old queued completion
  cannot unlock controls for a newer write. Repeated completion events are safe.
- Busy state is never persisted. A recoverable failure fallback is committed before
  submitting any export; process death therefore leaves retry feedback rather than
  a permanently pending state or the previous export's success.
- Failed fallback persistence or rejected executor submission cannot start a file
  or leave the process gate busy. PNG encoding also holds the controls until its
  native completion; late native events cannot unlock an unfinished encoder.
- Service-worker v15 (PC-005) advances to v16 for the changed cached `app.js`.
  PC-005 momentum validation, tests and report remain intact. No old feature PR #3
  code, storage writer changes or real permission grants are included.

## Revised candidate verification

- `npm test`: **101/101** passed, including three actual-handler pending-state
  tests and all existing PC-001/002/003/005 coverage.
- `npm run test:native`: **97 TrackJournal** and **26 TrackSession** assertions
  passed. The final `node scripts/test-export-permission.cjs` run passes
  **354 assertions across 38 scenarios** against source-extracted production
  Activity methods and the actual new `ExportSession` class.
- New lifecycle cases hold a write after grant through multiple Activity
  recreations, successful/failed completion, stale teardown, subscription after
  completion, duplicate old callbacks, rejected submission, failed pre-write
  persistence and delayed UI delivery after another export starts.
- Existing simulated API 26/28 prompt-denial/recreation/process-loss, request-code
  exhaustion and later-request tests remain; SAF, already-granted and API 29/35
  admission controls remain.
- Browser CI now also restores an in-flight state in English and Cantonese,
  checks disabled controls/no duplicate export, delivers success/failure twice,
  and verifies a later explicit export with unchanged saved observations.
- JavaScript syntax checks and `git diff --check`: passed.

Local Chromium remains blocked before startup by its socket permission failure;
no local browser or installed-Android pass is claimed. Initial-head CI was green
([37902968112](https://github.com/c933103/PassengerCount/actions/runs/37902968112)),
but the revised head requires fresh full browser/APK CI and Codex re-review.
The permission/lifecycle cases are simulations; real Android dialogs, framework
lifecycle behavior and physical provider/file I/O remain separate validation.
