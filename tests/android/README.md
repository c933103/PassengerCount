# API35 installed journal lifecycle validation

Test-only instrumentation targets the current `app.passengercount` APK. The test APK is compiled against target classes but packages only instrumentation/test-access classes and the separate-package race trigger described below. It reuses the current CI job's ephemeral validation signer, not a production key. The process-split candidate changes only private production process/provider declarations; instrumentation adds no production debug flag, exported component, permission or runtime hook. All nonpublic target methods, fields and session/request types are accessed through test-side reflection: identical Java package names do not grant package access across the separate defining classloaders used by `--no-restart`.

Run after the normal `android/build.sh` within the existing ephemeral validation job:

```sh
bash scripts/build-android-tests.sh
bash scripts/test-android-installed.sh
```

The runner must already permit hardware acceleration through `/dev/kvm`. The script fails with a saved blocker rather than changing device permissions/udev rules or silently using expensive software emulation. It creates one fresh API35 Google APIs x86_64 AVD and refuses an existing device serial or existing target package. Only that owned emulator is stopped on exit. The workflow adds steps to its existing validation job, not a matrix. API26 is explicitly untested by this harness.

## Boundaries exercised

- Exact packaged `record-deletion.js` and `storage.js` execute in a test-only WebView with network loads blocked before document load. They call the current real DeviceStorage bridge with real SharedPreferences and app-private files. This is not a replacement UI test; the production UI has separate browser coverage.
- The bridge host has the real target context attached without invoking MainActivity.onCreate, so it cannot trigger catalogue refresh. A fresh synthetic local catalogue is saved to the app's existing IndexedDB before the shell launches the normal empty Home Activity for process/foreground setup; this suppresses its automatic weekly download by the normal freshness contract. No Upload operation is called.
- Stopped deletion, actual LocationManager GPS callbacks, append-drain synchronization, late callback rejection, unrelated active-session continuation, malformed/symlink paths, real cleanup obstruction and durable pending selection/retry. The deterministic native drain test requires its deletion worker to be BLOCKED with production `TrackDeletion.delete` or the outer owner barrier in `TrackProvider.call` on the stack while an accepted writer holds the real session monitor. It does not infer native entry from WebView scheduling or worker liveness. Exact-JS coordinator completion is checked separately after that native drain.
- Cold-process recovery from the obstruction; constructed post-unlink/pre-final-save recovery. No injected power-loss/fsync failure is claimed.
- Real detached process death and sticky-service restart: valid-session positive control, then tombstone-before-stop state. The shell requires a changed PID and an ActivityManager process-start record for TrackService, plus correct foreground/stop state and durable data verification.

## Separate denied-restart recovery check

The controlled denial phases exercise the production null-intent path under real API35 policy. The test starts a synthetic session from a resumed Home Activity, detaches instrumentation, backgrounds Home, waits 15 seconds, and uses ordinary `stopForeground`. A later test-only callback invokes the real `onStartCommand(null, 0, -1)` without granting an exemption or changing platform policy. The shell requires the matching detached marker, the real `ForegroundServiceStartNotAllowedException`, a non-crashed process and the stopped service. Reattached tests verify the retained journal prefix, exactly one coordinate-free interruption receipt, unchanged survey/generation and no background bridge retry. Returning Home to TOP permits an explicit recovery and a new real GPS callback without erasing old evidence.

This is a controlled callback on an existing service, **not** a system sticky restart or reproduction of the process-absence race. It tests the fail-safe only. The original detached SIGKILL valid-session and tombstone controls run first, before this new fixture can add delay or policy demotion to their process sequence, with their existing assertions; this new check cannot satisfy or replace those gates. A passing ordinary sticky-restart sample also cannot close the known intermittent platform race.

## Process-death semantics matter

Normal Android instrumentation finish force-stops the target. That cannot validate sticky restart. Crash phases therefore use Android 15's supported `am instrument --no-restart`, finish instrumentation, and leave a test-only main-thread callback scheduled eight seconds later to SIGKILL its own process. The shell verifies instrumentation detached before death and requires the matching `SIGKILL_AFTER_DETACH` log, a different service-triggered PID after that marker, and the required service state. A PID alone is insufficient: the valid control polls until that restarted process's TrackService is foreground, and the tombstone case polls until the observed service has stopped. It does not call force-stop or treat an instrumentation crash as proof. MainActivity is backgrounded after preparation and before the scheduled kill so Activity relaunch cannot masquerade as service restart. The production service runs without the test APK after process restart.

Android 15 framework reference: https://github.com/aosp-mirror/platform_frameworks_base/blob/android-15.0.0_r1/services/core/java/com/android/server/am/ActivityManagerService.java (`finishInstrumentationLocked`, `instr.mNoRestart`). General references: https://developer.android.com/reference/android/app/Instrumentation and https://developer.android.com/tools/adb .

## Evidence and limits

The evidence artifact retains source/tree and production-path hashes, target/test APK SHA-256, installed target APK SHA-256 from each phase, API/build fingerprint, instrumentation assertion results, synthetic journal hashes/workspace/preferences, detached instrumentation state, PID transitions, service/foreground dumps and logcat. A skipped emulator, missing positive control or missing restart observation fails; it is not a pass. The expected SIGKILL marker must be distinguished from unrelated crash/ANR evidence during review.

These tests validate this emulator's actual Android filesystem/service behavior. They do not establish physical-device flash/power-loss durability, every OEM lifecycle, API26 compatibility or original-production-signer release provenance. The existing ephemeral CI validation signing and exact-head automated review remain separate from release approval.

Host regressions separately check harness reliability: `scripts/test-android-target-access.cjs` loads unchanged production TrackSession and the test access helper in different defining classloaders, demonstrates that direct package access fails, and exercises reflected request/accept/append/stop/field access. `tests/android-harness.test.js` executes the actual shell observation function with bounded synthetic logs and service snapshots, including delayed initialization, stale PID/log and missing-marker negatives. Neither host check is substituted for installed Android execution.


## Opt-in independent-FGS restart race probe

Use a pull-request head branch under `probe/api35-sticky-restart/`, or dispatch
`v19-validate.yml` on the desired ref with `restart_race=true`. The existing
validate job runs the normal build and **all original 13 installed phases first**.
If those gates pass, the opt-in adds `prepare-race` and (only after measured
foreground recovery) `verify-race`. If the installed step fails first, a separately
labeled workflow step boots a **second fresh emulator** and runs only bootstrap
plus the diagnostic. The failed original step remains binding: there is no
`continue-on-error`, result substitution, or retry of its gates. The separate
`restart-race-evidence` artifact includes its own exit status and copies the
original failure/source receipt; the wrapper verifies all original evidence is
unchanged. The diagnostic cannot turn a failed job green. Ordinary PRs and main
pushes do not run this probe.

The separate test APK declares its own `FOREGROUND_SERVICE` normal permission and
an exported, short-lived `shortService` trigger. The helper adds no production location permission, UID sharing, binding, policy setting, battery
exemption or background-location grant changes. The helper receives no target
journal, session token or location. It is used only on the fresh owned emulator.
The shell's foreground-start privilege applies to the **test package only**.
Helper warm-up is also a brief legitimate FGS start, followed by foreground stop
and a completion marker **before the target session starts**; an ordinary
background `startService` warm-up is not allowed on this image. The second-emulator
path reruns the same narrowly scoped hosted-runner KVM access check as the first,
writing only its separate diagnostic receipt.

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
any START_FOREGROUND cleanup during process absence. Its `evidence` object names
the exact log and service dump, their byte lengths and SHA-256 hashes. Each
`race-observation.*` directory retains that attempt's raw captures, stderr and
command exit codes. A completed classification is also retained there as
`result.json`; only then is the root `race-result.json` atomically replaced.
A later partial capture or failed publication cannot overwrite the preceding
complete pair. Failed attempts remain separate and the overall run is still
inconclusive (exit 2), not the old result's success. A denial already observed
in complete inputs remains failure (exit 1), including a later publication
error. Publish-mode classified denial uses internal code 10, mapped to the
unchanged product exit 1. A generic Node/shell launch exit 1 and internal
classifier error 3 are mapped to inconclusive 2, never to an Android denial.
The standalone classifier keeps its existing 0/1/2 interface.

Follow the `evidence` paths when reading a classifier, not the preparatory
`race-scheduling-logcat.txt`. That earlier capture proves restart scheduling and
process absence before the helper, not the subsequent result. No old archive
is rewritten or reclassified by this storage-layout repair.

The app-op signature is supporting evidence, not a captured internal framework
stack. Original phase results stay separate from the diagnostic. Node regressions
execute the actual shell and classifier with success, denial, transport failure,
stale-state and missed-window controls, including complete capture followed by
partial failure, interrupted publication, exact input pairing and retained denial.


## Process-split candidate coverage

The production tracker/provider and application default share `:tracking`;
MainActivity explicitly retains its original `app.passengercount` process. The original 13 phases remain in order, with the lifecycle instrumentation
explicitly targeting the owner process. Bootstrap still seeds the real UI WebView;
the owner fixture uses a separate test-only WebView data-directory suffix. Owner
reflection tests use an explicit foreground-service delivery while the shell proves
the actual UI is TOP; the separate UI fixture checks the real bridge start path.

Added installed phases cover real cross-process start/token reuse, paged/legacy
reads, stop/deletion, large serialized page bounds, a Binder call demonstrably
blocked on the owner append monitor, owner death while that call awaits its reply,
and ongoing GPS in the unchanged tracker PID after UI-only death releases a deliberately blocked reliable-pipe snapshot. Host transport
doubles separately cover lost replies after durable start/stop, no automatic replay,
pipe interruption, stale A-stop/B-start and final-check/cleanup ordering. Host tests
do not establish Binder, installed-process or policy behavior.

The controlled `split` sample kills only the tracker and requires the original UI
PID to survive. The subsequent `race` sample explicitly kills both package processes
and proves absence before the independent helper FGS. Each has separate artifacts;
a denial in either keeps the job failed. The latter is a retained platform-boundary
negative control, not permission to merge an otherwise failed aggregate.


### API35 instrumentation targeting and UI relay

Run108 exposed that API35 `--no-restart` uses ApplicationInfo.processName rather
than the instrumentation's first declared targetProcesses entry. The production
application default is therefore explicit `:tracking`, with every component's
resolved process preserved. The actual aapt2-linked manifest contains only the
existing activity, service and provider; there are no library manifests, receivers
or custom Application initialization to relocate. The six permissions are unchanged.

Cold bootstrap uses the UI-only instrumentation declaration. Other fixtures attach
to the existing owner. For real UI IPC checks, the owner runner launches the real
visible MainActivity in a newly instrumented UI process using the documented
comma-separated targetProcesses list. It then finishes/detaches itself before
allowing the UI test to proceed. The UI waits for ordinary Home initialization,
so its orphan-stop does not race fixture setup. The owner watcher reply only
confirms the relay; the shell separately requires same-PID UI entry, success and
post-finish detachment in order. A missing/failed UI result or transport failure
fails the phase. The service process is uninstrumented during provider-death IPC.
The owner is initialized through another ordinary visible Home setup afterward,
before preparing the independent UI-death fixture.

References: [instrumentation process list](https://developer.android.com/guide/topics/manifest/instrumentation-element),
[API35 process selection and finish](https://android.googlesource.com/platform/frameworks/base/+/android-15.0.0_r1/services/core/java/com/android/server/am/ActivityManagerService.java),
[secondary process attachment](https://android.googlesource.com/platform/frameworks/base/+/android-15.0.0_r1/services/core/java/com/android/server/am/AppProfiler.java).
Installed execution remains required; host relay tests cannot establish Android
Binder or restart behavior.


## Read-only platform capability/source-identity capture

The existing restart-race opt-in also captures platform metadata **after install
and grants but before any test/session preparation**, and again from EXIT cleanup
**after the test's terminal result**, before stopping the owned emulator. It adds
no observation call to the all-process-absence interval and does not change any
original lifecycle, permission, race or acceptance check.

`scripts/capture-android-platform-preflight.py` requires the explicitly selected
owned emulator serial; blank serials are rejected. It reads fixed build/JDWP
properties, system_server PID before/after a length-framed `track-jdwp` initial snapshot, target
package/app-op/service state, framework JAR digests, platform-test package presence
and SDK image metadata. It does not attach a debugger, start/stop an app, install,
root, set properties, reboot, forward ports or change permissions/settings.
Userdebug alone does not prove that system_server is available to JDWP.

Each `platform-capability-before-tests.*` / `platform-capability-after-tests.*`
directory retains the outer collector stdout, stderr and exit status; its unique
nested attempt retains exact command bytes, statuses, SHA-256 hashes and timings.
Any failed/timed-out query or stderr is incomplete (collector exit 2), never a
restart result. The wrapper bounds the whole collector to 35 seconds; an outer
timeout remains recorded as 124. Missing SDK metadata remains an explicit error.
Repeated/partial captures cannot overwrite earlier attempts. The original gate
exit is saved **before** cleanup metadata, which cannot change that exit, rewrite
race-result.json or turn a failed installed step green.

Host Python tests mock transport only, not Android policy. Node tests execute the
actual shell wrapper/EXIT cleanup across success, failure, timeout and transport
boundaries, and verify placement outside test preparation/absence. Real installed
full-restart acceptance still requires the unchanged device gate. This is a
meaningfully new diagnostic capture, not an APK restart fix or a platform patch.
The prior observed transition and alternative tracing/build routes are archived
[here](https://github.com/c933103/PassengerCount/blob/dd80561e8cb5c9b94ffe4786c201a443275fea69/verification/api35-restart-race/route-20261026/route-plan.md).


### Complete initial tracker frame versus silent timeout

Run114's four `adb jdwp` calls timed out with no bytes. Those observations remain
incomplete in the [immutable archive](https://github.com/c933103/PassengerCount/blob/ceeb9e3866c2019288e2d13baaf6fe9a7f72a6fe/verification/api35-restart-race/run114/README.md);
they are not reclassified as an empty process list. The successor uses ADB's
[documented tracker framing](https://android.googlesource.com/platform/packages/modules/adb/+/a8ab5ceccb41035804ad83bfa625adac4a8ccf83/SERVICES.TXT):
four ASCII hex length bytes and exactly that many decimal-PID/newline bytes.
The helper reads one complete initial frame within a 3-second monotonic bound,
then terminates/reaps only its spawned local client. A small bounded drain catches
immediate stderr/native failures; total capture/cleanup is also bounded by the
existing 35-second outer wrapper.

`complete-frame` describes protocol completion, not a fabricated adb exit 0:
`nativeReturnCode` and intentional termination/forced-kill metadata remain separate.
Timeout, malformed/truncated frame, stderr, unexpected native exit, output-limit
and cleanup failure remain incomplete. `0000` is a complete empty advertised
snapshot. A nonempty list may be capacity-truncated, so a missing PID is labelled
`not-listed-in-reported-frame`, not unavailable. A single stable system_server PID
must bracket the frame for a capability observation; a listed PID still does not
prove attach permission. No `jdwp:<pid>` connection, debugger attach, port forward,
policy override or debug/security-setting change is made.

Raw bytes, frame boundaries, native statuses, hashes and timestamps are retained.
Host regressions exercise actual local subprocess pipes, fragmented/extra frames,
empty/partial/malformed data, stderr/native failure, output bounds and client
termination/reaping; separate collector tests check target identity and provenance.
Neither suite models or substitutes for real Android policy. Original acceptance
checks and their exit 1 failures are unchanged.
