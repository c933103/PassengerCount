# Standalone PNG export identity (PC-003)

## Baseline reproduced

Fresh default branch: `0b3e10a4083bb471e2b393e9bbf90cfad5d7d4ae`.
This includes the merged PC-001 and PC-002 fixes. No code from the separate,
older feature PR #3 was incorporated.

`tests/png-export.test.js` executes the actual `saveChart`, `exportFilename` and
`chartPng` functions, with a controlled pending `Image.decode()` and synthetic
surveys. Before the production change, **6 of 8 tests failed**, with the two
existing error/retry tests passing:

| Pending export of chart A | Baseline result, both native and browser paths |
| --- | --- |
| Open record B before decode resolves | A's encoded chart payload saved under B's route/date/ID and the later timestamp |
| Return Home before decode resolves | Export reports failure and saves no file, because current survey is null |
| Mutate the selected survey's identifying fields | Already-captured chart A uses the new identifying values |

For example, the browser fixture captured payload `chart-A` but received filename
`bus-B2-2026-10-09-BBBBBBBB-2026-10-09T07-01-00-000Z.png`, rather than the expected
`bus-A1-2026-10-08-AAAAAAAA-2026-10-09T07-00-00-000Z.png`.
The unit fixture's payload is intentionally a synthetic canvas stand-in; it is
not presented as real raster/image-decoder validation.

This is a controlled reproduction of ordinary export mislabelling/failure.
It does not establish loss of the saved survey, destruction of prior exports or
an observed incident involving a user's data.

## Bounded correction

Compute the complete immutable filename synchronously before the PNG encoder
can yield at image decoding. The encoder already captures/serializes the chart
synchronously. Both values now refer to the same initiating record and time.

The existing PNG native-bridge/browser routing, disabled-button lifetime,
error reporting and `finally` re-enable behavior stay intact. Home navigation
continues the explicitly initiated export of A; it is not a cancellation action.
There is no new standalone export cancellation flow. CSV, GPX, upload/bundle,
Supabase, Android recording and storage protocols are unchanged.

Bump the existing service-worker cache version so browser installations can
receive the changed cached `app.js`.

## Candidate checks, 9 October 2026

- `npm ci --ignore-scripts`: passed against the existing lockfile.
- `npm test`: **89/89 passed**, including the eight actual-handler/encoder PNG
  tests. All six new identity regressions now pass; error/retry controls pass.
- `npm run test:native`: **97 TrackJournal** and **26 TrackSession** assertions
  passed, preserving the prior lifecycle/replay checks.
- `node --check app.js`, `node --check sw.js`,
  `node --check tests/png-export-browser.cjs`, and `git diff --check`: passed.
- Local Chromium: **blocked before browser startup**, including one approved
  escalated retry. Chromium reports `process_singleton_posix.cc` socket creation
  `Operation not permitted`; no local browser pass is claimed.
- Local Android APK compilation/signature check: **not run**, no configured
  Android SDK on this host. Existing PR CI remains required.

The existing browser CI suite now invokes `tests/png-export-browser.cjs`.
It retains actual SVG image decoding and canvas PNG generation, with only the
decode completion deferred. For native-bridge and real browser-download paths,
it checks A-to-B and A-to-Home navigation, exact A filename/time and byte equality
with the original chart's real PNG, disabled repeated clicks, unchanged screen,
decode rejection with no file, and successful retry of B. External network/native
storage are fixtures, not live service or physical Android validation.

## Acceptance

Draft PR publication is not acceptance. Exact-head Codex review and the full
existing Node/native/browser/APK CI must be checked before the coordinating
thread considers merging. Physical Android export-folder permissions and
provider/device I/O remain outside these fixture guarantees.
