# Read-only profiling route: installed shell/AMS support, no profiling execution

This is a bounded source/capability route for the existing full-restart investigation. It is not an APK fix, a captured caller stack or authority to replace an existing profiler. The original full all-process-absence gate remains binding.

## Exact installed Java service-side route

The accompanying byte/hash/line-bound excerpts come from run116's actual installed services.jar (SHA256 `1d241dbf234d4773e80fc0d0fd137920bb4c5b1d1ce51b3ddf79d1afbc65a6c6`), whose bytes were independently reverified in run117/118. They are not an assumption that Google's image matches a public tag.

- Shell `runProfile`, code item0x2e7528, accepts explicit `--sampling`; output opens at+00f0 and profileControl is called at+011d.
- AMS `profileControl`,0x2c4464, checks SET_ACTIVITY_WATCHER and an existing process/ApplicationThread. It has no blanket system-PID exclusion.
- `setProfileApp`,0x2ddd90, checks existing Build.IS_DEBUGGABLE at+0005 before app profileability gates. Observed userdebug/ro.debuggable1 supplies that property observation without changing it.
- `setSystemProcess`,0x2de05c, installs the system ApplicationThread at+009c/+00a2.
- AppProfiler `profileControlLPf`,0x2fc77c, calls IApplicationThread.profilerControl at+0033 and specifically handles its own system PID at+004f to preserve the local FD.
- `dumpProfileDataLocked`,0x2fc41c, prints AMS-owned profile fields. In the unfiltered processes dump it is invoked at+03d4; the unconditional terminal mForceBackgroundCheck field is printed at+04ee..04fc. That terminal marker is used to reject header-only/newline-truncated native-zero observations.

Public Java corroboration includes [system Profiler initialization](https://github.com/aosp-mirror/platform_frameworks_base/blob/4e43ad12e1b211f15152e9c5b16b0fe88e6b93f3/core/java/android/app/ActivityThread.java#L3114), [sampling startup](https://github.com/aosp-mirror/platform_frameworks_base/blob/4e43ad12e1b211f15152e9c5b16b0fe88e6b93f3/core/java/android/app/ActivityThread.java#L1038), [asynchronous handler/failure logging](https://github.com/aosp-mirror/platform_frameworks_base/blob/4e43ad12e1b211f15152e9c5b16b0fe88e6b93f3/core/java/android/app/ActivityThread.java#L6860) and [AppProfiler prior-profile replacement](https://github.com/aosp-mirror/platform_frameworks_base/blob/4e43ad12e1b211f15152e9c5b16b0fe88e6b93f3/services/core/java/com/android/server/am/AppProfiler.java#L2038).

## Current executable preflight, not a start test

Head61c3c6b156136ebf0cb4bf7e2ff2609b2ad67d5d wires seven read-only queries into the existing before-preparation/after-terminal capability flow: unfiltered processes dump, shell package permissions, output-directory metadata, ART APEX identity, candidate native-library hash and existing library/trace-buffer properties. [Natural run119](https://github.com/c933103/PassengerCount/actions/runs/40278271990) executes these alongside the new paired no-trigger contrast. No new command is inserted into absence.

Complete output can show an AMS-owned profiler or that its fields were not listed. The latter does not exclude direct ART profiling. If an existing profile is observed, do not start another: startup unconditionally stops the previous AMS profile, and no transparent preserve/resume route was established. A candidate library hash/APEX identity is not a verified loaded native implementation or successful asynchronous runtime support.

No profile start/stop, output-file creation, debugger attachment, property/permission change or trace activation was performed. Query success is not permission to perform those stateful actions.

## Conditional next technical experiment

Only after inspecting actual current state, provenance and authorization for the specific stateful action: a bounded system-PID method-sampling trace, with a unique output path, explicit nonzero sampling, and validation of both asynchronous failures and a parseable completed trace. Never omit sampling or fall back to instrumented tracing. Starting/stopping profiling mutates transient global profiler state and perturbs execution; it is not a read-only capability query. It must not replace an existing profiler.

A sampled updateForegroundApps→stopAllForegroundServicesLocked→setServiceForegroundInnerLocked stack could discriminate the callback family. It does not itself identify a particular ServiceRecord, and missing samples cannot disprove a short transition. Validate actual system-server thread/method identity, overflow/lost data, file format and contemporaneous logs, not just shell exit0.

Exact installed framework.jar/ART execution implementations were not captured/matched in this source pass. [Current public ART trace implementation](https://android.googlesource.com/platform/art/+/master/runtime/trace.cc) distinguishes sampling from instrumented tracing; it is not proof of installed native behavior.

## Atrace is a different, paused action

Actual installed foreground demotion contains an AM-tag Trace.instant for stopForeground plus component (DEX0x2b238e; tag0x40). It could identify target demotion/TID, not the caller stack. [Atrace implementation](https://android.googlesource.com/platform/frameworks/native/+/70f32415e2085aa958285ce902ab10f9ccefcd42/cmds/atrace/atrace.cpp) writes debug.atrace.tags.enableflags/app-selection properties and cleanup changes them again. Perfetto atrace_categories invokes that machinery; neither is a read-only workaround. Category activation remains paused/unperformed.

Optional existing-mask/service/tracefs reads would be capability observations only. Discover a different tracefs mount only after ENOENT, never reroute after a permission denial. Do not use consuming trace_pipe or async_dump/stop/start under a read-only label.

## Focused later-source check

The inspected [Android15 r36](https://github.com/aosp-mirror/platform_frameworks_base/blob/396d32905ded85c082232bc510b525c9e372e585/services/core/java/com/android/server/am/ActiveServices.java#L2116) and [Android16 QPR1](https://github.com/aosp-mirror/platform_frameworks_base/blob/33b96ce8a122757002e5040ac59824bd7a262e00/services/core/java/com/android/server/am/ActiveServices.java#L2123) retain the missing-UID/package false allowance and background-demotion route. No matching transition test was found in the inspected ActiveServicesTest files; the media-specific systemRequestedFgToBg change does not establish a location-service exemption. This is a bounded negative result, not a claim that no later fix exists or that an AOSP build is an owner-imposed prerequisite.
