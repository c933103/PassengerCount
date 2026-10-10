# API35 installed journal lifecycle validation

Test-only instrumentation targets the unchanged `app.passengercount` APK. The test APK is compiled against target classes but packages only instrumentation/test-access classes. It reuses the current CI job's ephemeral validation signer, not a production key. No production manifest change, debug flag, extra exported component or runtime hook is introduced. All nonpublic target methods, fields and session/request types are accessed through test-side reflection: identical Java package names do not grant package access across the separate defining classloaders used by `--no-restart`.

Run after the normal `android/build.sh` within the existing ephemeral validation job:

```sh
bash scripts/build-android-tests.sh
bash scripts/test-android-installed.sh
```

The runner must already permit hardware acceleration through `/dev/kvm`. The script fails with a saved blocker rather than changing device permissions/udev rules or silently using expensive software emulation. It creates one fresh API35 Google APIs x86_64 AVD and refuses an existing device serial or existing target package. Only that owned emulator is stopped on exit. The workflow adds steps to its existing validation job, not a matrix. API26 is explicitly untested by this harness.

## Boundaries exercised

- Exact packaged `record-deletion.js` and `storage.js` execute in a test-only WebView with network loads blocked before document load. They call the unchanged real DeviceStorage bridge with real SharedPreferences and app-private files. This is not a replacement UI test; the production UI has separate browser coverage.
- The bridge host has the real target context attached without invoking MainActivity.onCreate, so it cannot trigger catalogue refresh. A fresh synthetic local catalogue is saved to the app's existing IndexedDB before the shell launches the normal empty Home Activity for process/foreground setup; this suppresses its automatic weekly download by the normal freshness contract. No Upload operation is called.
- Stopped deletion, actual LocationManager GPS callbacks, append-drain synchronization, late callback rejection, unrelated active-session continuation, malformed/symlink paths, real cleanup obstruction and durable pending selection/retry. The deterministic native drain test requires its deletion worker to be BLOCKED with production `TrackDeletion.delete` on the stack while an accepted writer holds the real session monitor. It does not infer native entry from WebView scheduling or worker liveness. Exact-JS coordinator completion is checked separately after that native drain.
- Cold-process recovery from the obstruction; constructed post-unlink/pre-final-save recovery. No injected power-loss/fsync failure is claimed.
- Real detached process death and sticky-service restart: valid-session positive control, then tombstone-before-stop state. The shell requires a changed PID and an ActivityManager process-start record for TrackService, plus correct foreground/stop state and durable data verification.

## Process-death semantics matter

Normal Android instrumentation finish force-stops the target. That cannot validate sticky restart. Crash phases therefore use Android 15's supported `am instrument --no-restart`, finish instrumentation, and leave a test-only main-thread callback scheduled eight seconds later to SIGKILL its own process. The shell verifies instrumentation detached before death and requires the matching `SIGKILL_AFTER_DETACH` log, a different service-triggered PID after that marker, and the required service state. A PID alone is insufficient: the valid control polls until that restarted process's TrackService is foreground, and the tombstone case polls until the observed service has stopped. It does not call force-stop or treat an instrumentation crash as proof. MainActivity is backgrounded before the crash fixture is prepared so Activity relaunch cannot masquerade as service restart. The unchanged production service runs without the test APK after process restart.

Android 15 framework reference: https://github.com/aosp-mirror/platform_frameworks_base/blob/android-15.0.0_r1/services/core/java/com/android/server/am/ActivityManagerService.java (`finishInstrumentationLocked`, `instr.mNoRestart`). General references: https://developer.android.com/reference/android/app/Instrumentation and https://developer.android.com/tools/adb .

## Evidence and limits

The evidence artifact retains source/tree and production-path hashes, target/test APK SHA-256, installed target APK SHA-256 from each phase, API/build fingerprint, instrumentation assertion results, synthetic journal hashes/workspace/preferences, detached instrumentation state, PID transitions, service/foreground dumps and logcat. A skipped emulator, missing positive control or missing restart observation fails; it is not a pass. The expected SIGKILL marker must be distinguished from unrelated crash/ANR evidence during review.

These tests validate this emulator's actual Android filesystem/service behavior. They do not establish physical-device flash/power-loss durability, every OEM lifecycle, API26 compatibility or original-production-signer release provenance. The existing ephemeral CI validation signing and quota-blocked automated review remain separate from release approval.

Host regressions separately check harness reliability: `scripts/test-android-target-access.cjs` loads unchanged production TrackSession and the test access helper in different defining classloaders, demonstrates that direct package access fails, and exercises reflected request/accept/append/stop/field access. `tests/android-harness.test.js` executes the actual shell observation function with bounded synthetic logs and service snapshots, including delayed initialization, stale PID/log and missing-marker negatives. Neither host check is substituted for installed Android execution.
