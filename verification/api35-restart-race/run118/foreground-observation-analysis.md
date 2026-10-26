# Run118: actual foreground-bookkeeping observation

## Result and scope

The richer, framework-only dump worked. It shows **target foreground bookkeeping present before death, then absent while the same sticky TrackService record is retained and demoted**. The warmed helper package is not listed in the before map and is the only package listed in the later maps. This strengthens the concrete new-helper-entry/queued-update hypothesis; it does **not** identify the runtime `stopAllForegroundServicesLocked` caller or fix the restart failure.

The original full all-process-absence requirement remains binding. Both original and independent diagnostic outcomes remain failures; the observer's native exit 0 means complete evidence analysis/publication only. No source/test, device, permission, setting or GitHub mutation was performed for this analysis.

## Immutable run and byte provenance

- [Run118, attempt1](https://github.com/c933103/PassengerCount/actions/runs/40273911376), conclusion **failure**.
- PR head [`c80f6008cc3512e986ae2c40461da3286992d511`](https://github.com/c933103/PassengerCount/commit/c80f6008cc3512e986ae2c40461da3286992d511).
- Tested merge `da0a060fc343cfaca3cbad367edf7de30a465ce1`; tree `5a8f9531e0ea7c972873f4f60bb53ccd6e9b61d1`, verified against artifact `source.txt`.
- [Diagnostic artifact12630165446](https://github.com/c933103/PassengerCount/actions/runs/40273911376/artifacts/12630165446): ZIP 69,642,362 bytes, SHA256 `59ae1452028a588362ff179fd9d40806594b0617e2794184758b8b00be1bb8ad`.
- `/system/framework/services.jar`: 21,446,452 bytes, SHA256 `1d241dbf234d4773e80fc0d0fd137920bb4c5b1d1ce51b3ddf79d1afbc65a6c6`. Archived bytes were independently hashed; local/before-device/after-device hashes agree. This is the same exact JAR used for the recorded run116 installed-bytecode analysis, not an assumption that a public tag equals the Google image.

[Compact evidence JSON](foreground-observation-evidence.json) preserves exact fresh observer stdout/stderr/native-status/report bytes and hashes; all 16 service stdout/stderr/status/scope identities; compact target/helper-map and target-ServiceRecord line excerpts; Handler-search results; classifier-pair hashes; and exact event excerpts. Its SHA256 is `b351a21c09301e8de5ceaca06b51571f7384424f036d065cec824f9b34e6cb46`. Full multi-megabyte dumps and logs remain in the byte-verified artifact and are not duplicated here.

Fresh analysis `foreground-observation-analysis.8n5z2n9q` reported native 0, empty stderr, complete and published. Its report bytes equal the root summary: SHA256 `f9574b1a3e6c35053021420f11990bbc127e20d12bfb04d5955878d5a495cc62`. All 16 source files match both summary hashes and actual ZIP bytes; every service capture has native 0, empty stderr and the exact unfiltered/no-client diagnostic scope marker. All three paired classifier log/service inputs also rehash correctly with native 0/empty capture stderr.

## Actual sampled state

The order below is based on **exact strict-prefix comparisons of paired logcat bytes**, not random directory-name sorting: `kqpePd` log is a prefix of `De6EOw`, which is a prefix of `mo4kMN`. Each services command follows its paired logcat command. This does not assign an exact timestamp to the services snapshot.

| Snapshot | Exact target TrackService | Entire printed user0 foreground map |
|---|---|---|
| Before | Token `d5f580`; process3059; count1; foreground=true/type8/ID19; no-binding WIU and start reasons `PROC_STATE_TOP`; other four reasons `DENIED`; sticky result1 | Only `app.passengercount`: mNumActive1, mAppOnTop=false, shown-while-top/screen=true; start/visible `-5s445ms`; end time not printed |
| `kqpePd` | Same token in active and restarting listings; app=null; count1; foreground=false/type0/ID19; all six reasons DENIED; startRequested/callStart=true, stopIfKilled=false, sticky result1 | Only `app.passengercount.tests`: mNumActive1, mAppOnTop=false; start/visible `-327ms`; end time not printed |
| `De6EOw` | Same token in active and pending listings; same retained/demoted fields | Only tests package, same flags; start/visible `-933ms`; end time not printed |
| `mo4kMN` | Target service not listed in this complete dump | Only tests package, same flags; start/visible `-1s523ms`; end time not printed |

The JSON retains exact 1-based lines and hashes. Before-map lines4526–4529 contain only the target. Later helper-map ranges are kqpePd5232–5235, De6EOw5097–5100, mo4kMN4841–4844. Missing target entries are **not listed in these dumps**, not a replacement proof of process/UID absence. Optional end-time omission is not converted to zero or an absolute timestamp.

No Handler section or queued `what=2` line occurs anywhere in any of the four full-services outputs. The installed dumper prints a ServiceMap Handler section only when pending messages exist. A message may already have dispatched or been removed before a snapshot; this negative observation cannot exclude the queued-update path. Public source explains [Handler.dumpMine](https://github.com/aosp-mirror/platform_frameworks_base/blob/android-15.0.0_r1/core/java/android/os/Handler.java#L910-L917) and [the handler-filtered queue dump](https://github.com/aosp-mirror/platform_frameworks_base/blob/android-15.0.0_r1/core/java/android/os/MessageQueue.java#L1094-L1106); it supplies no runtime stack here.

## Paired log evidence and contrast confound

All following 1-based lines refer to `race-observation.mo4kMN/logcat.txt`: 6,889,164 bytes, SHA256 `302d85883651702541ebdc6ffd8fffb240d9948e95a01923de0f8dc6b1cbedb2`. The evidence JSON includes each selected exact line and its byte hash.

| Event | Time on 2026-10-26 | Line |
|---|---|---:|
| Warm helper ready, PID 2708/UID 10210 | 05:30:58.733 | 31426 |
| Detached kill marker, tracking PID 3059 | 05:31:19.759 | 48665 |
| Target UI PID 2780 death | 05:31:19.801 | 48691 |
| Tracking PID 3059 death | 05:31:19.856 | 48713 |
| Sticky restart scheduled in 30000ms | 05:31:19.858 | 48714 |
| DisplayManager UID 10209-gone notification | 05:31:19.858 | 48715 |
| Helper ENTER | 05:31:20.274 | 48964 |
| Helper FOREGROUND | 05:31:20.318 | 48978 |
| Target START_FOREGROUND AppOps finish warning | 05:31:20.321 | 48981 |
| Restart rescheduled to 8975ms, mem-pressure-event | 05:31:20.887 | 49227 |
| Restart rescheduled to 0ms, mem-pressure-event | 05:31:21.120 | 49281 |
| Automatic target service process 3964 start | 05:31:21.210 | 49399 |
| Target foreground promotion denied | 05:31:21.295 | 49481 |
| App saves denied-restart interruption | 05:31:21.298 | 49482 |

The warning is 3ms after the helper foreground log, but is not itself a RESET trace or proof of the caller. Classifier native statuses are 2, 2, 10; the final 10 is the explicitly classified denial mapped by the runner to product exit 1, never observer acceptance.

**Actual memory-pressure rescheduling is a material contrast confound:** the initially scheduled 30s absence window became 8975ms and then 0ms. Retain these events and the measured window in any trigger/no-trigger comparison. Do not attribute the shorter restart interval to the helper or compare arms as if a fixed restart delay was maintained.

## New discriminator, remaining uncertainty and bounded next step

The helper's warm foreground-map entry is not listed at the before sample. In the previously verified installed bytecode, `setServiceForegroundInnerLocked` +05cc skips directly to mNumActive increment when an entry already exists; a newly created entry takes the +060a enqueue. The observed absent-before/present-after helper map therefore supports that specific prerequisite instead of assuming every helper promotion creates an enqueue. [Public r1 lines2623–2644](https://github.com/aosp-mirror/platform_frameworks_base/blob/android-15.0.0_r1/services/core/java/com/android/server/am/ActiveServices.java#L2623-L2644) corroborate the branch shape. Neither sample is the exact creation/enqueue instant.

Retained target count 1/ID 19/sticky state with foreground/type/reasons cleared and map removal fits stop-foreground demotion. It does not discriminate `updateForegroundApps` from the background-restriction listener or an already queued OomAdjuster callback: those known routes converge on `stopAll` and the same writes. No missing log or missing queued message proves those alternatives absent.

The smallest further contrast is an **additional independent matched no-trigger observation** using the same installed APK/image/permissions, warm-up, full all-process-absence proof and bounded snapshot cadence, without target reattachment. Keep the original gate and existing triggered case intact. A no-trigger failure would establish that this extra stimulus is unnecessary, not rule out natural/UID-state queued updates. A trigger-only failure would support a stimulus/timing contribution, not identify a unique caller; command timing, AMS locks, background work and the observed restart-rescheduling changes remain confounds. This is real installed-framework observation, not a mocked predicate or an acceptance substitute.
