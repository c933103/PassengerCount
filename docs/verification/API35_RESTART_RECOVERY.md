# API35 denied-restart recovery: bounded receipt

## Outcome and open gate

Preserve the active survey and every existing journal byte when Android denies a null-intent foreground-service restart; append an explicit interruption observation; stop the denied service; permit a later visible-Activity request under normal platform policy. Display and export the interruption without inventing GPS fixes or precise gap bounds.

This is an observable fail-safe, **not a repair of automatic sticky restart**. The strict automatic-restart gate remains failed on [natural postmerge CI 38710322909](https://github.com/c933103/PassengerCount/actions/runs/38710322909). The platform-valid remedy remains open. A green sample of the existing gate does not disprove the recorded race. Release remains blocked.

## Provenance and implementation

Base: `c61f6c2bb9c45eb1665814b3ac2d08525534ec75`. The exact implementation and test revision is the commit containing this receipt; current-head CI and review must be recorded on its PR.

[Immutable diagnostic and local-test archive](https://github.com/c933103/PassengerCount/tree/d7a54aa509a0929c86ff9a28252377153086d355/verification/api35-sticky-denial) contains selected exact failure/passing traces, APK and source hashes, the local patch input hashes, environment/results, and a seven-control AOSP source-path experiment. Full original artifact ZIPs are not archived there; the original Actions artifact is subject to retention. [PR17 diagnosis](https://github.com/c933103/PassengerCount/pull/17#issuecomment-6189425602) records the observed interleaving and source-backed race hypothesis.

- Handle only API31+ `ForegroundServiceStartNotAllowedException` on null-intent restarts. Explicit-delivery and unrelated failures still propagate. Failed receipt storage is an explicit failure.
- Under the existing session/deletion monitor, append and sync a coordinate-free denial receipt, preserving the survey ID, generation, prior bytes and deletion semantics. No background retry or permission expansion.
- Require a currently resumed Activity before the bridge launches tracking. Returning to the visible active survey requests normal recovery; Home/View does not start tracking.
- Import the receipt with the journal cursor in one recoverable workspace write; preserve it across replay, edit history, JSON/GPX export, and later GPS fixes. GPX splits points across the observation, not a claimed measured interruption interval.
- Add a separate installed controlled-denial/recovery test. It directly invokes the real null-intent callback after test-only ordinary demotion while backgrounded, with instrumentation detached. It does not masquerade as natural sticky restart. Existing detached SIGKILL valid/tombstone assertions remain required and unchanged.

## Validation at publication

- Focused Node: 80/80 passed (`tests/native-track.test.js`, `tests/history-integrity.test.js`, `tests/android-harness.test.js`).
- Native host suite: 97 journal, 26 session, 1,155 export/lifecycle, 928 writer, 271 deletion/service, 14 classloader-access, and 22 interruption assertions passed.
- Earlier aggregate Node snapshot: 328/329, with missing local binary government catalogue ENOENT. **Not an aggregate pass.**
- Local Chromium launch: blocked by socket creation `Operation not permitted`; no browser assertions executed.
- Shell syntax passed. No local Android SDK/emulator execution.
- Pending: current-head hosted Node/native/browser/build, installed controlled-denial/recovery and original sticky controls; risk-focused exact-head review.
- Untested: physical/OEM/API26 service behavior, power-loss durability, original-signer upgrade and release provenance. Ephemeral validation signatures cannot satisfy release signing.

Packaged web/native inputs changed, so old APK/source-bundle hashes do not describe this patch. No release build or signing claim is made.


## Review hardening after the initial publication

The initial hosted run [38720075745](https://github.com/c933103/PassengerCount/actions/runs/38720075745), on head `cc11734bcf8e4a6391a9c89847f440a461052e9f`, passed Node and native checks but failed the new browser negative: the pre-existing `showScreen` path started an in-progress survey even in View. Android build/installed phases were skipped. The assertion was retained; View now only reconciles an in-progress survey without starting or stopping its native session. Paired actual-handler regressions cover running and previously denied/stopped sessions. Setup/count and explicit Resume continue to request tracking; Home retains its previous stop behavior.

Malformed stored interruption objects/null entries are retained for structured backup, while UI/GPX select only valid observations and preserve valid GPS points. Invalid newly read journal events still prevent cursor consumption. This addresses source-review findings without silently dropping old metadata. Latest local focused suite: 82/82, plus 8/8 recording-lifecycle controls; native code is unchanged from the passing initial check. Current-head hosted CI and review must be recorded separately below/on the PR. The immutable archive above describes the initial patch/local snapshot, not these later changes.

## Permission-resume and timestamp review correction

On head `f0d60502bfaae0c54fb4c7303a38c48aef5fde04`, [CI38720711045](https://github.com/c933103/PassengerCount/actions/runs/38720711045) passed Node, native, browser and both APK builds. Installed phases reached `prepare-denied` and verified detached/background state, then observation ended with ADB exit 255; `services-final.txt` says `adb: device offline`. No controlled-denial marker was retained, so denial/recovery and subsequent automatic-restart controls are **unverified**, not passed. Artifact11964752409 ZIP SHA-256: `49a7192884df96822ed450f08938aaa4202ff2218ca6a896d935fe410dc6222f`.

Codex review found a location-permission result before `onResume` could defer tracking without retry, and a malformed point timestamp could reset GPX segmentation state to NaN. The correction retries only a launch actually deferred by this Activity, after resume, rechecking durable session/permission ownership; ordinary resume without such a deferred launch does not start anything. Stop/cancel and destroyed-Activity controls remain required. The native lifecycle fixture now executes the actual permission callback, `startPendingTrack` and resume methods with the production TrackSession. GPX retains malformed source timestamps but uses only finite timestamps for interruption-boundary state, preserving all existing coordinate evidence.

The installed observer now labels/saves ADB read failure explicitly and still fails rather than accepting incomplete evidence or silently retrying it. These code corrections warrant a new natural CI run; the failed run is not relabeled or blindly rerun.

## Installed recovery result and strict timestamp follow-up

On `7e2d468d1bb9c5681e3ce5666a09673c093f743d`, [CI38721936383](https://github.com/c933103/PassengerCount/actions/runs/38721936383) passed Node333/333, native, browser, both APK builds and all 13 installed phases. Checked artifact11965703232 ZIP SHA256: `eba481ddc43a0b79b37e312ad1e5cd0b5f891f230bed93ac7939accd4e811cc7`. Its tested merge revision `934357001c95b0d9f202876da74f57498ba110a7` has the same source tree `39eacad1e0d27e82c3a4941095d7eabd437abe46` as that PR head. Target APK SHA256: `15d3c2ed11fd40c2cd0be64f5f290f8dfb803bf5b247ef8847c6791cbd4a5dcc`.

The controlled callback logged the real API35 foreground-start denial at 10:45:07.025 in PID4085, saved its interruption, and stopped without crashing. Verification/recovery phases passed in that same PID, including retained byte prefix, unchanged generation, one denial receipt, no background retry and new GPS after visible recovery. The ordinary valid/tombstone samples also passed (4085→4780; 4780→4983). This does not close the original process-absence race or release gate.

The latest review alleged that parseable malformed point times `2027`/`2026-02-30` reconnect valid pre/post-denial fixes. Exact reproduction on that head yielded two segments in both cases, so that specific allegation was **not reproduced**. Independently, using Date.parse's inferred/normalized dates for boundary placement is undesirable. Boundary/display validation now requires a full ISO timestamp and real calendar date; malformed source points/metadata remain unchanged in the structured evidence. Tests cover partial dates, impossible full dates, hour overflow, valid leap day, positive/negative/non-hour offsets and 1/6/9-digit fractions, without requiring one serializer spelling. Local focused/lifecycle checks93/93 pass. New-head CI and exact-head review remain required; the installed result above belongs to its stated earlier source tree.

## Preserve original gate ordering

The new controlled-denial phases initially preceded the ordinary sticky controls. Although assertions stayed unchanged, this introduced about 30 seconds of extra boot time before SIGKILL and could alter the original keyboard-service interleaving. The controlled phases now run **after** both original valid/tombstone controls, preserving their baseline phase sequence before deliberate demotion. A focused ordering regression prevents reintroducing that contamination. This removes a possible timing shelter; it does not reproduce or fix the platform race, and the original failed acceptance remains open.


## Fractional timestamp compatibility and new-head verification

[CI38723227214](https://github.com/c933103/PassengerCount/actions/runs/38723227214) passed on `f9508faf202f7a13dbe235d415c8b669c43f8491`, including installed phases, but still used the earlier ordering described above. Its successful sample cannot establish unchanged timing exposure of the original controls. Codex then found the strict parser unnecessarily rejected valid ISO fractions longer than nine digits. The parser now accepts a nonempty fractional digit sequence while retaining full-date, calendar and timezone validation. Regressions cover 10–20-digit point/observation fractions, valid offsets, visible/exported observations, unchanged source spelling and retained points. Comparison against the baseline confirms the original executable phase sequence through `verify-deleted` is unchanged; controlled denial/recovery follows it. Current-head CI and review are still required.


## Sub-millisecond comparison and latest inconclusive installed run

On `996102f6d6004baed6d3e7af644b19274fbe01e5`, [CI38724427235](https://github.com/c933103/PassengerCount/actions/runs/38724427235) passed hosted Node/native/browser and both APK builds. Installed execution passed seven phases through `prepare-valid` and verified detached/background state, then ADB exited 255 before the scheduled SIGKILL. The retained final service dump says `adb: device offline`; no SIGKILL marker was retained. Restart and subsequent controlled recovery outcomes are unverified, not pass/fail evidence about platform restart. Checked artifact11968475452 ZIP SHA256: `cb39e730a7af0d234702ff3f852b5a19ce832a5271723813981f68eebb9b20a5`. No rerun or gate relaxation was used.

The latest Codex precision finding was reproduced: accepted point fractions `.5001234566` and `.5001234568` around observation `.5001234567` produced one segment because Date.parse truncates to milliseconds. The correction normalizes only the whole second/timezone and compares the fractional decimal text exactly after removing insignificant trailing zeros. It needs no BigInt/new WebView facility and never rewrites source evidence. Regressions cover sub-millisecond straddles, timezone-equivalent instants, equal endpoints, fractions through 1,001 digits, pre-epoch/calendar rollover and unchanged points/metadata. Local focused/lifecycle96/96 pass; normal current-head hosted CI and exact-head review remain required.


## Reordered installed pass and mixed-source precision correction

On `76dcaf4b0a8bf8b2d54f36150f065b8d91e3e768`, [CI38725286496](https://github.com/c933103/PassengerCount/actions/runs/38725286496) passed Node338/338, native/browser/build and all 13 installed phases. Original valid/tombstone controls preceded controlled denial/recovery. Checked artifact11967298151 ZIP SHA256: `b9e7c0a33d1d75f60cd6cd15063f1442eab0a27acd45f0823fef3e9c1c2ff40e`. Tested merge `5a36c14251ac5392f97d14f89202c97bd90e05fb` has head tree `df323b9869f10e28007574bd7e1bc48653fd6163`. Target APK SHA256: `ac835864c2eaee5cbfe00c418c2944ca72da4ac37f78df8e3ab1e4de63ef93e2`. The controlled real policy denial was saved and stopped without a crash, with later foreground recovery in the same process. This reordered passing sample still cannot close the recorded automatic-restart race.

Codex then found a mixed-source reconciliation edge, reproduced as later fractional native fix sorting ahead of an earlier retained fix because mergeNativeTrack still used millisecond-rounded Date.parse and a journal-order tie break. Reconciliation now shares the exact validated-instant parser/comparator with GPX; parsed values are cached per point during sorting. Existing malformed-time fallback and exact-equal journal tie semantics are retained. Regressions exercise retained/native fractional pre/post evidence, offset-equivalent spellings, journal replay, equal-instant native-order ties and unchanged source metadata. Latest current-head CI and review must be recorded separately on the PR.


## Mixed-validity ordering follow-up

The retained malformed-time fallback was found to make comparisons non-transitive when mixed with exact valid times. The simplest recipe without retained nativeOrder values still produced two segments; adding retained journal orders 2/1 and incoming order0 reproduced the later/malformed/earlier order and one-segment failure. Reconciliation now sorts only validated fixes into their existing valid slots. Malformed observations remain in their original merged-input slots, unchanged, and cannot contribute inferred dates or influence the chronological ordering of valid fixes. This intentionally replaces the old malformed-time sorting fallback; no point is discarded by validation, and the existing point cap remains unchanged. Tests cover six input permutations, four malformed timestamp spellings, adversarial retained journal order, GPX segmentation and replay stability. Local focused/lifecycle99/99 pass; current-head hosted checks and review remain required.

[CI38726549406](https://github.com/c933103/PassengerCount/actions/runs/38726549406) passed hosted and installed checks on prior `69ecbc5b4d95e128b90dcd99ebebad3cec06f2d0`. That result predates this mixed-validity correction and does not replace its current-head verification.
