# PR19 engineering decision: preserve full restart, stop generic collector expansion

## Decision and evidence boundary

No demonstrated application-only correction currently guarantees the owner's **full all-package-process-absence automatic restart** on the verified API35 image with existing permissions. This is a bounded engineering conclusion, not proof that Android universally forbids sticky restarts or that a permission expansion is required. PR19 remains unmerged; original acceptance is still failed.

The [app manifest](https://github.com/c933103/PassengerCount/blob/c7f31ec1f4482170efd8934e9f83603516d5f9a6/android/AndroidManifest.xml) declares fine/coarse location and location-FGS, not background location. Verified runtime receipts retain those grants and foreground-only location UID AppOps. [TrackService](https://github.com/c933103/PassengerCount/blob/c7f31ec1f4482170efd8934e9f83603516d5f9a6/android/src/app/passengercount/TrackService.java#L115-L179) already restores the durable request on null-intent restart, attempts startForeground, returns START_STICKY on success and retains interruption evidence on the specific denial. Its latter fallback is not automatic-restart acceptance.

While every package process is absent, no app callback, thread, retry or preference change executes. The observed ServiceRecord/foreground-eligibility bookkeeping is owned by system_server. Moving promotion earlier in the recreated service cannot reverse a completed pre-recreation framework transition; replacing the service or scheduling new work does not manufacture an exemption. This inference concerns the demonstrated transition, not every possible public API or platform implementation.

[Android's START_STICKY contract](https://developer.android.com/reference/android/app/Service#START_STICKY) distinguishes system restart of an existing sticky foreground service from a new background start. Runs119/120 actually observed foreground in no-trigger controls without adding background location. Therefore “background location is absent, so sticky restart is inherently impossible” is incorrect.

[Existing installed-byte analysis](https://github.com/c933103/PassengerCount/blob/f689fbcac329c01b980ea6abe9bf22156c75e639/verification/api35-restart-race/installed-binary-analysis/active/report.md) narrows a framework demotion/reset route; [run120](https://github.com/c933103/PassengerCount/blob/e44d42de22775d778e8e5a66f4ba2787f670d2cf/verification/api35-restart-race/run120/README.md) also records cleanup before helper ENTER/FOREGROUND. The race/denial and sampled retained record are demonstrated; the executed caller remains unproved. Helper promotion is not an established immediate cause. A pre-log command/launch effect is only a hypothesis.

## What would change the app-fix decision

A further experiment is useful only if it can establish one of these discriminators:

1. An app-controlled pre-death action or configuration causes the eligibility loss, and changing that action legitimately preserves all process absence, original permission matrix and original gates.
2. A documented public API under those existing grants restores this system-restarted location service, demonstrated on the real framework—not a mock policy model, catch-and-ignore, substituted service type, user reattachment or surviving watchdog.
3. An actual platform remedy preserves sticky restart eligibility through this absent-process transition while still denying genuinely restricted/user-stopped services; it passes the original full gate and security-negative cases.

Another copy of the same sixDENIED fields, static write site or no-trigger foreground snapshot does not establish any of these. Caller tracing could select a **platform** regression/patch, but does not create an app capability during absence.

## Alternatives are not silent fixes

- Background-location permission addresses a distinct while-in-use access boundary. Android also separately restricts background foreground-service starts; adding the permission alone is **not proved sufficient** for this mAllowStartForeground denial. It changes the permission/privacy contract and is not being implemented. [Official background-start restrictions](https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start).
- Notification/widget/user-visible recovery is a legitimate separate product path, but changes automatic acceptance. Keeping a package process alive changes full absence. Fake media/data-sync types, artificial bindings, external watchdogs or security toggles are not substitutes.
- The requirement-preserving direction is a verified platform fix/backport or otherwise demonstrated legitimate API mechanism, not a requirement reduction. No such remedy has yet been established.

## Bounded existing-remedy search

This pass checked official Android documentation, focused AOSP search results,100 ActiveServices history entries on the accessible official mirror main snapshot1cdfff555f4a21f71ccc978290e2e212e2f8b168 (path history2023-09-20 through2024-12-02),13 later entries on android16-release99b01a65cc4c104933788b3143285ab6bae65827 (2024-12-31 through2025-03-18), corresponding ActiveServicesTest source, and actual diffs of plausible matches. It supplements—not repeats—the prior Android15-r36/Android16-QPR1 source comparison.

- [ac689e23: sticky restart/unbind race fix and real ServiceTest](https://github.com/aosp-mirror/platform_frameworks_base/commit/ac689e23cbe17695d516c4cc8c8f16a4389b16cd) keeps a started service in pending lists when its last connection disappears. It does not change foreground-eligibility reset/demotion; our failures already start a new process, so this is not the demonstrated failure's remedy.
- [87106648: missing-process NPE fix](https://github.com/aosp-mirror/platform_frameworks_base/commit/871066489a0901c7f10463de9cb2f8d323f13cec) guards caller lookup in foreground-service delegation, not the target's retained sticky ServiceRecord.
- [dd3a96a3: systemRequestedFgToBg](https://github.com/aosp-mirror/platform_frameworks_base/commit/dd3a96a364cf153b8db462e8c7ff992b92fb61b6) and [4ae6fcbc: system-transition exception handling](https://github.com/aosp-mirror/platform_frameworks_base/commit/4ae6fcbc93eda23d6203a43250c433f1be07d1ec) concern system-managed media service transitions. Neither establishes location-service restart recovery.
- [CTS testFgsSticky addition](https://android.googlesource.com/platform/cts/+/0f029d6e674b92f83b3a7f1e17ebf5f99a82dbab%5E%21/) verifies sticky/null-intent, nonsticky and redelivered-intent restart behavior after am crash. It does not establish the specific absent-process demotion interleaving. The inspected ActiveServicesTest has restart-scheduling tests, not that regression.

**Result: no verified existing fix or specific regression for this transition was established in this bounded pass.** The mirror main path history is not current2026 coverage; android16-qpr2-release was absent from that mirror, and direct Googlesource log/ref requests were unavailable through the browser tool. These are retrieval/coverage limits, not evidence no later fix exists. No alternative image replaced the API35 gate.

## Execution boundary and stopping condition

Finish the already-active c7f31ec/run122 source/test review, actual paired outcomes and immutable evidence. It includes the narrow rejected-absence native-status fix and the already-reviewed deadline alignment. If the control fails strict absence, record that—not a synthetic matched run. After this, stop generic collector/source-run expansion, including another run solely to get a more convenient contrast. A material reviewer/source defect can still be corrected as bounded repair; changed policy/architecture or new stateful tracing is a separate decision.

For an actionable platform route, the missing technical input is either (a) an identifiable candidate fix/affected-build mapping plus a compatible test image, or (b) a real framework harness/prebuilt test module allowing the absent-process retained-FGS transition and genuine-restriction negatives to execute. A full AOSP build is not an owner-imposed prerequisite; existing real-device fixtures can validate a supplied remedy. The current hosted image lacks FrameworksMockingServicesTests, and the hosted resource envelope does not support the previously assessed full platform build.

The alternative method-sampling route is explicitly **stateful**: it can stop/replace existing AMS profiling, create output, asynchronously affect system_server and perturb scheduling. Current read-only “fields not printed” does not exclude direct ART profiling. Exact loaded framework/ART behavior, safe preservation of existing profiler state and specific authorization for those effects remain prerequisites. No sampling, debugger attachment, atrace/Perfetto activation or security setting mutation is being performed merely to continue logging.
