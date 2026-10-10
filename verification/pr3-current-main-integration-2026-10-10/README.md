# PR #3 current-main integration review, 10 October 2026

## Scope and exact inputs

- Repository: c933103/PassengerCount, existing PR #3 (`fix/reference-upload-export-bundle`).
- First parent: prior PR head `b9fe113aed0a1c6786b7aa5aeb5e9ce1389ae0d5`.
- Second parent: current main `2ac807eeef3a282f7570e495cfd21a5f50e814fe`.
- Both remote refs were freshly checked before preparing this review. The older PR payload's base is not used as the integration target.
- The integration preserves both histories, composing the four conflicts in app.js, README.md, android/build.sh and .github/workflows/v19-validate.yml.
- The original audit and actual-handler reproducer are durable at https://github.com/c933103/PassengerCount/blob/2b75cd6a7c217bd087873a77f6a72232116db6ca/verification/pr3-integration-audit-2026-10-10/README.md .

This is an integration review candidate. Source publication, CI, merge, production signing and release are separate gates. No signing credential was introduced or accessed.

## Corrected integration hazards

1. A failed native journal read or durable acknowledgement stops the bundle export before encoding or native enqueue. The track and cursor remain retryable under the existing `importNativeTrack` transaction.
2. CSV, JSON, GPX, identity, folder, basename, metrics and export time are serialized synchronously before the PNG decoder yields. The PNG encoder already captures its SVG synchronously. Navigation, later survey edits and catalogue mutation cannot combine different record snapshots.
3. Bundle encoding uses the shared chart gate; native enqueue sets the native gate before calling the bridge. The finally block clears only the encoding gate. All three export handlers also reject repeated invocation while either gate is active. Late native results cannot unlock an unfinished encoder.
4. Native `saveBundle` remains additive to current MainActivity and routes through the existing `queueExport` / `ExportSession` lifecycle. Current permission ownership, observer transitions and uncertain-result behavior are unchanged.
5. Current CSV-only permission fixtures now expect the bundle folder path and include bundles when checking for forbidden automatic exports. Main browser bundle checks wait for settled controls rather than assuming image encoding finishes within the existing short persistence flush. The momentum GPX oracle checks typed accuracy/source/true-north extensions.
6. The original feature removed government attribution from CSV. Its scalar source and reuse-terms rows are retained; rich structured evidence still resides in JSON.
7. Android packages both `native-track.js` and `export.js`; the service worker retains both assets and advances exactly once from cache v16 to v17. Native CI tests and current main/PR triggers are preserved, while retaining the original v1.10/code 11 and aligned APK artifact intent.

## Independent-review corrections

The first frozen candidate, `cda454248aab7f6ddd617a97ec696725794e1cf3`, was rejected for a reproduced standalone MediaStore result regression. Its optional display-path lookup ran after successful publication but could throw a retry-safe failure while leaving the completed file in shared storage.

The corrected writer keeps publication and rollback logic unchanged. `saveMedia()` catches optional query/cursor failures after publication and returns the already-known content URI. Null or missing cursor/path data also returns the URI. Failures before publication still propagate and clean up as before. No lifecycle outcome or uncertainty marker was weakened.

The optional-chart observation was also addressed. JSON now declares `files.chart: null` when PNG rendering is absent. `withBundleChart()` finalizes only that field and PNG payload from the already-serialized bundle. It never rereads the mutable survey, catalogue, identity or clock, and does not mutate the snapshot.

Permanent production-writer controls are included in `npm run test:native`: 486 assertions cover real host legacy files, simulated SAF/MediaStore bundles, optional PNG omission, collisions, open/publication failure cleanup, CSV/GPX/PNG on API 29/35, and post-publication query, cursor movement, both field reads, cursor closure, missing cursor/row and null field fallback. A frozen-source negative control runs the same oracle against `cda4542` and fails at the controlled post-write query, demonstrating that the new suite detects the reviewed regression. See `storage-negative-control.log`. Host simulations remain distinct from installed-provider evidence.

## Requirements and current evidence

| Requirement | Evidence | Result |
| --- | --- | --- |
| Original reference-only database payload and configured mid-route start | `tests/upload.test.js`; production upload.js byte-identical to original PR head | Passed with mocked fetch; no live database write |
| Tabular CSV plus rich structured JSON and route attribution | `tests/export.test.js`, `tests/survey.test.js` | Passed |
| Typed GPX source/accuracy/speed/heading; absent measurements stay absent | `tests/fieldkit.test.js`, `tests/momentum.test.js` | Passed, including preserved PC005 true-north and missing-heading behavior |
| Frozen bundle across record B, Home, mutable identity/rows/weather/catalogue and clock changes | `tests/bundle-export.test.js`, native and browser paths with actual app handlers/encoder | Passed |
| Failed durable journal acknowledgement and explicit retry | `tests/bundle-export.test.js`, actual importNativeTrack, cursor and journal assertions | Passed |
| Optional PNG failure retains CSV/JSON/GPX and declares no chart; synchronous bridge failure is retryable | `tests/bundle-export.test.js` | Passed |
| Repeated activation, native pending settlement, late success/failure/uncertain results and explicit retry | `tests/bundle-export.test.js`, `tests/export-pending.test.js` | Passed; no automatic replay |
| PC001–005 preservation | Existing Node/native suites plus `preservation-proof.json` | Passed at host-test/source level |
| Native journal/session and permission/observer/recreation state machine | `npm run test:native` | 97 TrackJournal assertions/12 scenarios, 26 TrackSession assertions, 1,028 export lifecycle assertions/76 scenarios and 486 production ExportStorage assertions passed |
| Real browser PNG/bundle identity, edits, navigation, folder recovery and explicit retries | Existing browser suite plus `tests/bundle-export-browser.cjs` | Written and syntax-checked; runtime blocked before test execution |
| Post-publication friendly-path failures preserve success with the known URI; pre-publication failures retain rollback | `tests/native/ExportStorageTest.java`, actual production writer | 486 assertions passed; frozen-source negative control failed as expected |
| Full Android compilation, APK signature and packaged assets | Existing v1.10 CI validation workflow | Pending exact integration-head CI |
| Installed legacy filesystem, SAF and MediaStore bundle behavior | Android device/provider validation | Not executed here; simulated bridge/lifecycle tests do not substitute |
| Production signing and release | Existing authorized release path with retained key | Not performed by this review candidate |

## Executed checks

- `npm test`: 126 passed, zero failed/skipped/cancelled. The original current-main baseline was 102 tests; the composition retains the PR's four feature tests and adds twenty bundle/attribution/chart-metadata tests.
- `npm run test:native`: all four suites passed as detailed above.
- `node --check` for top-level JavaScript and all JavaScript/CommonJS test files: passed.
- `bash -n android/build.sh scripts/test-native-track.sh`: passed.
- `git diff --check`: passed.
- Current-main preservation checks: passed; see machine-readable proof.

Local Playwright was attempted with the installed Chromium and isolated configuration. The browser aborted at startup with `FATAL:chrome/browser/process_singleton_posix.cc:297 socket() failed: Operation not permitted (1)`. A permitted escalated launch produced the same runtime limitation. No browser assertions ran in those attempts. The workspace contains a JDK but no Android SDK, so no local Android build or signature result is asserted. The existing workflow's validation signing steps are unchanged; a validation-signed APK is not evidence of a production release.

## Remaining gates

1. Review the frozen tree and the current-main preservation proof before source publication.
2. Publish the reviewed two-parent integration to the existing PR branch without force-dropping either history, then verify the exact remote tree/parents.
3. Run the full Playwright and Android validation workflow on that exact head, fix any failures within this scope, and inspect APK/signature/artifact evidence before declaring the integration ready.
4. Keep production signing and installed filesystem/provider verification explicit. Do not substitute an ephemeral validation key for the existing release identity.
