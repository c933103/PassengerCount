# PR13 instrumentation-detach proof repair

## Scope and source
Parent source: `93fbfd3ea947cec4f129c19502bbfcc7863a84a1`. This change repairs only the installed-test proof of instrumentation detachment and adds behavioral regressions. It changes no production classes, Android permissions, KVM setup, emulator image, restart deadline, required lifecycle phases or release configuration.

## Preserved failing run
[Run 38320552654](https://github.com/c933103/PassengerCount/actions/runs/38320552654), tested synthetic merge `626e8589c83ba7346401ed8cef3c4248a761e920` over live main `70050e8b59c215443e33fe851767e4156ca0ebae`.
[Artifact 11779086592](https://github.com/c933103/PassengerCount/actions/runs/38320552654/artifacts/11779086592): 3,934,641-byte ZIP, SHA-256 `9d2137b1736922d40e77f588949becce162f1a95c72315b632f4d772eb7d431c`, independently downloaded and matched to GitHub metadata. Bulk logs remain in the run artifact rather than this source branch.

Passed: 295 Node tests, native host and browser suites, APK/instrumentation builds, KVM access and acceleration, API35 boot; installed bootstrap (6), basics (48), recover (15), receipts-prepare (10), receipts-recover (15), receipts-final (11), prepare-valid (10). Receipt phases used distinct PIDs 3744, 3904 and 4038.

Failed: required foreground service restart after the prepare-valid kill marker. The system started replacement PIDs 4520 and 4544 for TrackService, but both crashed with `ForegroundServiceStartNotAllowedException` at TrackService.java:132. No verify-valid, prepare-deleted or verify-deleted phase ran. This is not a KVM failure or an owner-denial claim.

## Reproduced evidence defect and repair
The original artifact's `instrumentation-detached-valid.txt` contains:
```text
Unknown command: instrumentation
Bad activity command, or no activities match: instrumentation
Use -h for help.
```
The former negative grep accepted this as detached. API35's supported package-filtered `dumpsys activity processes app.passengercount` includes active instrumentation before PID mappings; see [AOSP dispatch](https://github.com/aosp-mirror/platform_frameworks_base/blob/android15-release/services/core/java/com/android/server/am/ActivityManagerService.java#L10919-L10930), [process dump](https://github.com/aosp-mirror/platform_frameworks_base/blob/android15-release/services/core/java/com/android/server/am/ProcessList.java#L4435-L4523), and [instrumentation filtering](https://github.com/aosp-mirror/platform_frameworks_base/blob/android15-release/services/core/java/com/android/server/am/ActivityManagerService.java#L11242-L11266).

The repaired check requires command success, **empty stderr**, the exact process-dump header, the original process's later PID mapping, the terminal `mForceBackgroundCheck` field as the final nonempty line, and no active-instrumentation records. Unsupported, empty, partial, wrong-process, timed-out and denied output fails closed. The existing service-triggered new-PID and foreground/tombstone-state requirements remain intact.

## Validation and remaining acceptance
Local `bash -n scripts/test-android-installed.sh` and `node --test tests/android-harness.test.js` pass: 27/27 tests, including the five existing service-observer tests and 22 detachment cases. Running the captured-error regression with the original detachment function fails (exit 1, actual accepted status 0), preserving the negative control.

This source fix does **not** claim to repair the Android foreground-service restart. The failed runtime started its service after Home had already been backgrounded; a supported, representative foreground-start/restart context must be established without privilege or permission workarounds. Android's [Service contract](https://developer.android.com/reference/android/app/Service#START_STICKY) says sticky foreground-service restarts are exempt from the general background-start restriction; that alone does not prove this test setup or device passed.

Fresh exact-head hosted CI and Code review remain required. Full installed lifecycle, physical-device, API26, power-loss, original-signer and release acceptance remain open.

## Review correction and fresh execution boundary

[Codex P2](https://github.com/c933103/PassengerCount/pull/13#discussion_r4253655611) identified additional dumpsys stderr diagnostics that the initial deny-list missed. The current repair uses a positive complete-response contract and rejects **any** stderr instead. Tests include each reported poll/read/Binder error, write/pipe/service lookup errors, unknown stderr, truncated-after-PID and unexpected trailing output. The complete real API35 dump from the next run satisfies the positive contract in local replay; a zero-exit full stdout plus transport-error negative control fails on the former implementation.

[Run 38328946150](https://github.com/c933103/PassengerCount/actions/runs/38328946150), head `d5dc77d913`, tested merge `8482b98b8259feb34546b7bd0777f37d77313973`, again passed all phases through prepare-valid and produced `DETACHED_STATE_PASS valid pid=4132` with the actual supported process dump. It then exited 255 during restart observation; saved diagnostics report `adb: device offline`. This is a separate execution failure and does not resolve the prior foreground-service exception. [Artifact 11782367692](https://github.com/c933103/PassengerCount/actions/runs/38328946150/artifacts/11782367692): independently verified 2,252,177-byte ZIP, SHA-256 `52bbb92473621b5449f194a192993f553498ce61158d8b2301921930f5c40a9e`.
