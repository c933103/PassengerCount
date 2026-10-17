# API35 installed journal lifecycle validation

Test-only instrumentation targets the current `app.passengercount` APK. The test APK is compiled against target classes but packages only instrumentation/test-access classes and the separate-package race trigger described below. It reuses the current CI job's ephemeral validation signer, not a production key. No production manifest change, debug flag, extra exported component or runtime hook is introduced. All nonpublic target methods, fields and session/request types are accessed through test-side reflection: identical Java package names do not grant package access across the separate defining classloaders used by `--no-restart`.

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

## Separate denied-restart recovery check

The controlled denial phases exercise the production null-intent path under real API35 policy. The test starts a synthetic session from a resumed Home Activity, detaches instrumentation, backgrounds Home, waits 15 seconds, and uses ordinary `stopForeground`. A later test-only callback invokes the real `onStartCommand(null, 0, -1)` without granting an exemption or changing platform policy. The shell requires the matching detached marker, the real `ForegroundServiceStartNotAllowedException`, a non-crashed process and the stopped service. Reattached tests verify the retained journal prefix, exactly one coordinate-free interruption receipt, unchanged survey/generation and no background bridge retry. Returning Home to TOP permits an explicit recovery and a new real GPS callback without erasing old evidence.

This is a controlled callback on an existing service, **not** a system sticky restart or reproduction of the process-absence race. It tests the fail-safe only. The original detached SIGKILL valid-session and tombstone controls run first, before this new fixture can add delay or policy demotion to their process sequence, with their existing assertions; this new check cannot satisfy or replace those gates. A passing ordinary sticky-restart sample also cannot close the known intermittent platform race.

## Process-death semantics matter

Normal Android instrumentation finish force-stops the target. That cannot validate sticky restart. Crash phases therefore use Android 15's supported `am instrument --no-restart`, finish instrumentation, and leave a test-only main-thread callback scheduled eight seconds later to SIGKILL its own process. The shell verifies instrumentation detached before death and requires the matching `SIGKILL_AFTER_DETACH` log, a different service-triggered PID after that marker, and the required service state. A PID alone is insufficient: the valid control polls until that restarted process's TrackService is foreground, and the tombstone case polls until the observed service has stopped. It does not call force-stop or treat an instrumentation crash as proof. MainActivity is backgrounded before the crash fixture is prepared so Activity relaunch cannot masquerade as service restart. The production service runs without the test APK after process restart.

Android 15 framework reference: https://github.com/aosp-mirror/platform_frameworks_base/blob/android-15.0.0_r1/services/core/java/com/android/server/am/ActivityManagerService.java (`finishInstrumentationLocked`, `instr.mNoRestart`). General references: https://developer.android.com/reference/android/app/Instrumentation and https://developer.android.com/tools/adb .

## Evidence and limits

The evidence artifact retains source/tree and production-path hashes, target/test APK SHA-256, installed target APK SHA-256 from each phase, API/build fingerprint, instrumentation assertion results, synthetic journal hashes/workspace/preferences, detached instrumentation state, PID transitions, service/foreground dumps and logcat. A skipped emulator, missing positive control or missing restart observation fails; it is not a pass. The expected SIGKILL marker must be distinguished from unrelated crash/ANR evidence during review.

These tests validate this emulator's actual Android filesystem/service behavior. They do not establish physical-device flash/power-loss durability, every OEM lifecycle, API26 compatibility or original-production-signer release provenance. The existing ephemeral CI validation signing and exact-head automated review remain separate from release approval.

Host regressions separately check harness reliability: `scripts/test-android-target-access.cjs` loads unchanged production TrackSession and the test access helper in different defining classloaders, demonstrates that direct package access fails, and exercises reflected request/accept/append/stop/field access. `tests/android-harness.test.js` executes the actual shell observation function with bounded synthetic logs and service snapshots, including delayed initialization, stale PID/log and missing-marker negatives. Neither host check is substituted for installed Android execution.


## Opt-in independent-FGS restart race probe

Use a pull-request head branch under `probe/api35-sticky-restart/`, or dispatch
`v19-validate.yml` on the desired ref with `restart_race=true`. The existing
validate job runs the normal build and **all original 13 installed phases first**.
The opt-in then adds `prepare-race` and (only after measured foreground recovery)
`verify-race`. Ordinary PRs and main pushes do not run this probe.

The separate test APK declares its own `FOREGROUND_SERVICE` normal permission and
an exported, short-lived `shortService` trigger. No production manifest, APK
component, location permission, UID sharing, binding, policy setting, battery
exemption or background-location grant changes. The helper receives no target
journal, session token or location. It is used only on the fresh owned emulator.
The shell's foreground-start privilege applies to the **test package only**.

After a real TOP start and background transition, the target instrumentation
fully detaches and kills its process exactly as in the original control. The
shell observes that death and ActivityManager's restart scheduling, then starts
the independent test service. Only ActivityManager restarts TrackService. The
classifier requires the helper's successful foreground transition before the
new target service process starts. No ordinary `stopForeground`, synthetic
null-intent callback, or instrumentation is involved in that restart window.

- Exit 0 requires that measured ordering, the new target TrackService foreground
  state, and then the existing real GPS/session/journal verification. This is
  one successful sample, not closure of the intermittent defect. GPS verification
  runs after reattachment; pre-reattachment GPS delivery is not claimed.
- Exit 1 reports an observed automatic-restart denial and keeps the job failed,
  even when the helper missed the window. The separate interleaving flag controls
  whether that failure can be associated with the test trigger.
- Exit 2 reports missed timing or incomplete observation. It is inconclusive,
  never a passing automatic-restart test. No platform delay is altered to force
  the window and no retry hides a failed sample.

`race-result.json` records line indices, old/new PID, measured interleaving and
any START_FOREGROUND cleanup during process absence. That app-op signature is
supporting evidence, not a captured internal framework stack. Original phase
results stay separate from the diagnostic. Node regressions execute the actual
shell and classifier with success, denial, transport failure, stale-state and
missed-window controls.
