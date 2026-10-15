# API35 sticky restart denial: diagnostic evidence (2026-10-15)

This ref preserves compact, selected evidence for the failed automatic-restart gate and the separately scoped recovery patch. It is not a release or automatic-restart success receipt.

## Original failure and comparison

- Natural postmerge run: https://github.com/c933103/PassengerCount/actions/runs/38710322909
- Original failed artifact: 11960825909. Its ZIP SHA-256 is `2ff519c26f8ddf6b0247ad6e1d0ff8abd12e51aba71cca7a02c905bd694896c6`.
- Passing premerge ZIP SHA-256: `3de1346610677d53d3e80d6fbbeab68844e5ed90ce45adde596bf8832ed8dd43`.
- Source commits and production-path hashes are retained separately for both runs; their source trees are identical.
- Selected exact logcat lines and service eligibility fields are preserved here. These are filtered excerpts, not the full artifact ZIPs; the full original run remains subject to Actions artifact retention.
- The failed run records detached SIGKILL at 09:09:41.843, restart scheduling, an input-method foreground-service start during process absence, START_FOREGROUND app-op cleanup at 09:09:42.845, new service PID 4495, and null-intent foreground denial at 09:09:43.160. The next restart fails too. The passing sample retains PROC_STATE_TOP eligibility.

## Source-backed race hypothesis and limits

AOSP `android-15.0.0_r1` resolves to frameworks/base commit `4e43ad12e1b211f15152e9c5b16b0fe88e6b93f3`. In ActiveServices, a shared per-user `updateForegroundApps` pass can find a still-active foreground-service entry while its process/UID is absent during sticky restart. `isForegroundServiceAllowedInBackgroundRestricted(uid,pkg)` returns false in that state, and the pass calls `stopAllForegroundServicesLocked`. That path demotes the service and resets retained eligibility. Starting another foreground service schedules this shared pass.

Reference: https://github.com/aosp-mirror/platform_frameworks_base/blob/4e43ad12e1b211f15152e9c5b16b0fe88e6b93f3/services/core/java/com/android/server/am/ActiveServices.java
Official sticky contract: https://developer.android.com/reference/android/app/Service#START_STICKY

`AospForegroundGap.java` copies only two AOSP methods unchanged and supplies explicit minimal doubles around them. Seven controls reproduce the selection of the absent process for demotion, versus live, top, ended and no-pass controls. Run with `java AospForegroundGap.java`; output is retained. The demotion method is a call recorder, not an emulated Android policy implementation. This is a one-time source-path experiment, not permanent application CI.

The Google emulator image is not demonstrated to match this exact AOSP commit. No system_server stack was captured at demotion. Therefore the observed interleaving matches this source path, but causation on that image remains a hypothesis. The platform-valid automatic-restart remedy remains open.

## Recovery patch local validation

`patch-inputs.sha256` binds the changed implementation/test files used for the local checks. Environment and unabridged local results are retained.
- Focused JS: 80/80 (native journal import/export, actual edit handlers/Undo/Redo, installed-harness observer).
- Native host: 97 journal, 26 session, 1,155 export/lifecycle, 928 writer, 271 deletion/service, 14 classloader-access, and 22 interruption assertions passed.
- Aggregate npm test at the earlier local snapshot: 328/329; missing local binary government catalogue caused the remaining ENOENT. This is not an aggregate pass; no source fixture was fabricated.
- Local browser launch blocked by Chromium socket creation (Operation not permitted); no browser assertions executed.
- No local SDK/emulator execution. Hosted current-head CI, installed controlled policy denial, ordinary sticky gates and exact-head review remain required.

The recovery appends an explicit denial observation, retains session/journal data, stops the denied restart and waits for a resumed Activity to request recovery. It cannot restore missing GPS or satisfy the strict automatic-restart requirement. No platform permission, exemption, policy setting or acceptance assertion is weakened.

