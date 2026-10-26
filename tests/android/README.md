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

### Exact installed framework binary and host DEX analysis

[Run115](https://github.com/c933103/PassengerCount/blob/5fcb5f0dce4ffb27d2035f449192b215e2585772/verification/api35-restart-race/run115/README.md)
returned exactly `0000` in all four snapshots, with stable system_server PID 555
or 556. Both original/independent full-absence restarts still failed with exit 1.
Empty advertised snapshots do not establish a global debugger-policy denial or
make a full AOSP build a prerequisite for all further investigation.

The next bounded diagnostic reads the **actual installed**
`/system/framework/services.jar` and disassembles its DEX using the already
installed SDK 35 `dexdump`. It runs only in EXIT cleanup, after the original exit
and platform metadata have been saved; never before tests or inside the absence
interval. `scripts/capture-android-framework.py` receives the explicitly owned
serial and explicit existing host-tool path. It does not install a tool, query
another target, attach a debugger, forward a port or change device/security state.

Each `framework-static.*` directory retains outer stdout/stderr/exit status and a
unique nested `framework-binary-*` attempt. Device-before/device-after/local JAR
SHA256 must agree before static analysis. Exact host-tool bytes/path and adjacent
SDK package metadata establish tool provenance, not a vendor-signature claim.
Validated canonical ZIP entries and every contiguous `classes*.dex` are retained
with hashes, header/checksum results and bounded raw `dexdump -d` output. Missing
tools/metadata/DEX, unsupported formats, mismatched hashes, partial transfers,
command errors, output caps and timeouts remain incomplete; they cannot replace
the original gate exit or overwrite earlier evidence. Native pull progress on
stderr is preserved; completion additionally requires agreeing archive hashes.

The helper latches SIGTERM without throwing across a subprocess-spawn/cleanup
boundary, then terminates/reaps only its own native child and records interruption
with the actual native status. Its previous signal handler is restored. Host tests
exercise both outer 124 with a resistant native child and the outer 137 last resort.
The helper has a 90-second total budget; the outer wrapper 120 seconds plus a 5-second
forced-kill grace for its own local collector process group. A forced termination
can leave a missing inner receipt; the raw partial files and outer 124/137 remain
explicitly incomplete, never fabricated as a complete capture. JAR 256 MiB,
expanded ZIP 512 MiB, per-DEX 128 MiB/count 64 and disassembly 256 MiB per DEX/1 GiB total
are ceilings, not measured resource requirements. Exceeding a limit is incomplete,
not accepted clipped evidence. Partial archives and raw command statuses remain
available for diagnosis. Missing/unsupported DEX does not imply recoverable VDEX:
that section is optional in ART. A custom-image/OAT toolchain is not silently
substituted.

The goal is to examine actual `ServiceRecord` restriction-field writes and their
caller/control-flow sites across all captured DEX, then compare just those methods
with public Android 15 source. Static candidate sites are **not** an observed
runtime caller stack, exact executed interleaving or a proven restart cause.
Host fixture tests validate transport/archive orchestration, not Android policy.
Original 13 phases, all-process absence, negative controls and failure exits stay
binding. Complete capture/disassembly likewise cannot turn a failed restart green.

### Independent ActiveForegroundApp bookkeeping observation

The exact installed binary analysis identifies a concrete candidate chain:
new active-FGS package entry → same-user `updateForegroundApps` message → missing
UID/package process yields false allowance → `stopAllForegroundServicesLocked`
→ demotion and restriction reset. Existing retained-record snapshots fit this
pattern, but do not identify the executed caller. See the
[actual-bytecode report and offsets](https://github.com/c933103/PassengerCount/blob/f689fbcac329c01b980ea6abe9bf22156c75e639/verification/api35-restart-race/installed-binary-analysis/active/report.md).

Only `PASSENGER_RESTART_RACE_ONLY=1`, the separate post-failure diagnostic, replaces
its existing before/attempt service-dump command with plain
`dumpsys activity services`. Omitting the positional package enables
`ItemMatcher.all` and prints ActiveForegroundApps. Adding `-a` to the old filtered
command would not do this. No `-p`/`-c` is used: those can enable application dump
callbacks. This route uses the existing framework dump under AMS locks, does not
start a target component, change settings/permissions, or attach a debugger.
The original gate retains its exact package-filtered command, all 13 lifecycle
phases and full all-process-absence checks. No ADB command slot is added, but the
larger dump can still perturb timing; this is **not** timing-equivalent acceptance.

The independent snapshots carry an explicit scope sidecar. After the diagnostic
has terminated, `analyze-android-foreground-observation.py` reads only host files,
binds raw bytes/SHA256 plus native exit/stderr/scope, and extracts exact user0
PassengerCount ActiveForegroundApp and TrackService fields. Relative time strings
remain as printed; omitted `mEndTime` is not invented as zero. Random directory
names do not establish chronology. `section-not-listed`/`target-not-listed` mean
only not printed, never UID/process absence, a callback trace, or successful
restart. Existing absence checks/logs retain that separate evidence.

Every analysis has a new attempt directory. Only a complete summary atomically
publishes `foreground-observation.json`; partial later input or publication failure
retains earlier valid output and all raw captures. Parser output/status is separate
from both gate exits. Host analysis has a 15-second deadline plus 2-second forced
kill grace, and input/count limits; diagnostic receipt-write failure also retains
the actual diagnostic process exit. No Python/JavaScript policy model substitutes
for the real framework observation.

Richer output also exposed an existing classifier boundary bug: Pending,
Restarting and Destroy ServiceRecord blocks could leak an unrelated foreground
field into the target block. The classifier now separates those boundaries while
still requiring the exact active TrackService/new PID. Real negative regressions
retain inconclusive/denied outcomes rather than false foreground restoration;
ActiveForegroundApp membership alone cannot satisfy the original gate.

### Additional matched-input no-trigger contrast

The independent triggered diagnostic remains at the root evidence destination.
Only after its native exit and immutable evidence are retained does the wrapper
attempt another **fresh owned emulator**, under an exclusive `no-trigger-control/`
child. Existing child evidence is never reused or overwritten. The original
all-process-absence gate and all 13 lifecycle phases are unchanged; a control flag
is rejected on that original path.

The additional control uses the same runner, APKs, configured image, warm-up,
`prepare-race` detached kill, strict full-package-absence proof and log/services
snapshot sequence. It withholds only the later `TRIGGER` action. Host monotonic
measurements bracket the verified absence boundary, triggered command slot and
first services snapshot. The control replays the measured slot (at most 10 seconds)
using **host-only idle**, then records its actual timing. Before the control's
first services capture, a second host-only wait targets the triggered leg's
measured elapsed-from-absence deadline (also bounded to10 seconds). Already-late
arrival, requested wait, actual wait and overshoot are explicit; no device command
is added. Receipt/stdout publication and shell dispatch still intervene after the
host timestamp, so even an exact bracket target is not equal device-event timing.
Raw status/stdout/stderr and all timing receipts are hash-paired; durations/gaps
and deltas are reported, never timing equality. Invalid alignment still collects
the actual snapshot and preserves known denial1; comparison becomes ineligible.
First-log capture cost, Python measurement overhead, scheduling, warm-up state and
memory pressure remain explicit confounds. Run118 actually rescheduled restart
from 30000ms to8975ms and then0ms; future comparison must retain such events.

The separate control classifier requires actual detached death, sticky restart
scheduling, a distinct automatic target service process and the target's own
foreground state or denial. Any unexpected helper ENTER/FOREGROUND marker in this
fresh control contaminates the comparison. Full-absence raw stdout/stderr/native1,
scope, exact APK/source/fingerprint receipts and timing identities are separately
verified. Matching fingerprints do not prove whole-image/runtime-state equality;
permissions and before-service states remain separate observations. Missing or
mismatched comparison evidence cannot become a pass or erase a measured denial.

`foreground-observed-no-trigger` means only observed framework foreground state;
it never invokes `verify-race`, reattaches the UI, or claims GPS/session acceptance.
Denial remains1, uncertainty2. The triggered nonzero exit remains the paired step's
exit; only if triggered native0 does a nonzero control propagate instead of being
hidden. Both native receipts stay separate. The control is bounded to180 seconds
or the remaining existing eight-minute step budget with40 seconds reserved for
kill grace, host parsing and reporting. Timeout124/forced-kill137 and partial bytes
are retained; no workflow timeout or original acceptance was extended or skipped.

[Run118 source-bound observation and failure archive](https://github.com/c933103/PassengerCount/blob/7b3d519a935675055732d32cfdd1d19deae74aef/verification/api35-restart-race/run118/README.md).
A failure without the extra trigger shows it is unnecessary for that observation,
not that naturally queued updates are impossible. A differing pair supports a
stimulus/timing contribution, not a unique caller, failure rate or universal fix.

Run119 and120 both actually observed foreground in separate no-trigger controls,
while original/triggered gates failed. Control first dumps were261.37ms and81.17ms
earlier respectively; host-deadline alignment addresses this measured confound,
not memory-pressure rescheduling or whole-runtime equivalence. Crucially run120
cleanup precedes helper ENTER/FOREGROUND: helper foreground promotion is **not**
the established immediate cause. A command/activity-launch effect before helper
logging is only a hypothesis; other convergent framework callers remain possible.
[Preserved run119/120 evidence](https://github.com/c933103/PassengerCount/blob/e44d42de22775d778e8e5a66f4ba2787f670d2cf/verification/api35-restart-race/run120/README.md).

### Read-only profiling capability and identity preflight

The same before/after-terminal metadata flow now reads full `dumpsys activity
processes`, the shell package permission state, existing output-directory metadata,
ART APEX XML/candidate-library hash and existing library/trace-buffer properties.
No profiler is started/stopped, no trace file is created, and no property, permission
or security setting is changed. These queries never enter the absence interval.

A complete, well-formed processes dump can report AMS-owned profiler fields or that
those fields were not printed. Either result is **not permission to start profiling**;
no fields does not exclude a direct ART profiler. An existing profiler must not be
replaced. Native error/stderr, malformed, oversized or partial output stays
inconclusive and preserves previous attempt bytes. Candidate ART identity is not a
verified loaded native implementation or proof that asynchronous profiling works.

Exact installed services DEX supports a separate system-PID profiling route and
checks existing `Build.IS_DEBUGGABLE`; empty JDWP snapshots alone do not exclude it.
However starting profiling mutates transient global state, stops any previous AMS
profile and perturbs timing. A later sampling experiment needs its own state/identity
checks and explicit nonzero sampling; never substitute instrumented tracing.
[Java initialization/sampling path](https://github.com/aosp-mirror/platform_frameworks_base/blob/4e43ad12e1b211f15152e9c5b16b0fe88e6b93f3/core/java/android/app/ActivityThread.java#L1038),
[prior-profiler replacement](https://github.com/aosp-mirror/platform_frameworks_base/blob/4e43ad12e1b211f15152e9c5b16b0fe88e6b93f3/services/core/java/com/android/server/am/AppProfiler.java#L2038).
Atrace/Perfetto category activation writes trace-tag properties and is not a
read-only substitute; it remains unperformed. No runtime caller stack is claimed.
