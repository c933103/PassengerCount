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
