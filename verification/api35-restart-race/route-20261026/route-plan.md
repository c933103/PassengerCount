# Full-process restart: observed transition and executable investigation route

Status at 2026-10-26: PR19 remains open and unmerged at `328d87d3c6bae32ba081aef6c1890e45e59bb9bd`. This is additive evidence/preparation, not an APK restart fix, replacement gate, or platform patch. The [original installed run](https://github.com/c933103/PassengerCount/actions/runs/40261475995) still fails with exit 1; its independent diagnostic also fails with exit 1. The [capture repair receipt](../capture-pairing-20261026.md) remains historical evidence.

## 1. Acceptance and mechanism are different

The binding requirement is automatic recovery after **all PassengerCount app processes are absent**, with tracking/journal/session integrity and all original installed lifecycle, persistence, recovery, upload-receipt and deletion gates preserved. A surviving UI process is not equivalent. Manual relaunch is not automatic restart. No failed original gate may become green because a diagnostic or narrower test passes.

A custom AOSP image, `ActiveServicesTest`, and a particular proposed framework fix are investigation mechanisms, not owner acceptance requirements. A legitimate application-level solution is still admissible if it meets the original full gate without hidden privileges, misleading service types, or weakened process absence. No such new candidate is demonstrated by the evidence here. In particular, the documented [sticky-service restart behavior](https://developer.android.com/reference/android/app/Service#START_STICKY) distinguishes OS restarts from new background starts; it justifies investigating why this already-started service loses eligibility, rather than declaring all application designs impossible.

## 2. Actual permission matrix (not assumed)

[Source pins](source-pins.json) contain exact manifest bytes and Git blob IDs for main `77fcc768…`, pre-repair PR19 `052fbb20…`, and current `328d87d3…`. Main's blob is `71e664ff73f0ab8e1c666aae4325fab9e24f6d4a`; both PR19 manifests are `e662df9107df615588e83505013f4ca08188ec7a`.

| Permission | Those source manifests | Both run113 installed package dumps |
|---|---|---|
| ACCESS_FINE_LOCATION | declared | requested; runtime granted=true |
| ACCESS_COARSE_LOCATION | declared | requested; runtime granted=true |
| FOREGROUND_SERVICE | declared | install granted=true |
| FOREGROUND_SERVICE_LOCATION | declared | install granted=true |
| ACCESS_BACKGROUND_LOCATION | **not declared** | **not requested or granted in either complete dump** |
| INTERNET | declared | install granted=true |
| WRITE_EXTERNAL_STORAGE | declared, maxSdkVersion=28 | not requested on API35 |

The [original package dump](original/package.txt#L62-L87) and [diagnostic package dump](diagnostic/package.txt#L62-L87) show targetSdk 35 and the same relevant grants. These are installation/preflight snapshots, not an atomic permission/app-op snapshot at the failing call. Diagnostic fine/coarse flags additionally include USER_SENSITIVE_WHEN_GRANTED/WHEN_DENIED; neither flag is a background-location grant. [MainActivity](https://github.com/c933103/PassengerCount/blob/328d87d3c6bae32ba081aef6c1890e45e59bb9bd/android/src/app/passengercount/MainActivity.java#L119-L120) requests fine/coarse, and the [installed runner](https://github.com/c933103/PassengerCount/blob/328d87d3c6bae32ba081aef6c1890e45e59bb9bd/scripts/test-android-installed.sh#L109-L110) grants those two only.

Both terminal logs contain the while-in-use location warning **and** a separate background-FGS start denial/ForegroundServiceStartNotAllowedException. [Android's documentation](https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start) treats background-start and while-in-use eligibility separately. Adding background location alone is therefore not a demonstrated fix for the observed start denial. It is also a new permission, not something already granted. Nothing in this preparation adds permissions, changes settings, or relabels service types.

## 3. New evidence: retained-record eligibility loss is already observed

This corrects the earlier receipt's statement that the mutation itself remained unobserved. The exact **caller and moment** remain unknown; before/after state is now directly present in preserved intermediate captures.

| Run113 capture | Before death | During pending restart, before recreation | Terminal |
|---|---|---|---|
| Original artifact 12624841544 | ServiceRecord token `30844ba`; process 6639; TOP start + WIU reasons; foreground LOCATION | Same `30844ba`; `app=null`; all start + WIU reasons DENIED; foreground=false/type=0; sticky startRequested=true, stopIfKilled=false, callStart=true, startCommandResult=1; restart pending | new PID 6874; automatic-restart-denied, exit 1; TrackService absent from terminal services dump |
| Independent artifact 12623729936 | Token `bae2c2e`; process 2970; TOP start + WIU; foreground LOCATION | Same `bae2c2e`; app=null; DENIED both; foreground=false/type=0; same sticky/pending state | new PID 3843; automatic-restart-denied, exit 1; TrackService absent |

Read exact [original before](original/before.txt#L3-L37) / [pending](original/pending-restart.txt#L3-L37), and [diagnostic before](diagnostic/before.txt#L3-L37) / [pending](diagnostic/pending-restart.txt#L3-L37). Pending dumps also list the same token under Restarting services. Token equality is observed dump identity, not a claim of globally collision-proof identity. These are sequential commands, not an atomic OS snapshot. The separately preserved [absence](original/absence.txt) and [process scope](original/scope.txt), classifier result and source-bound log hashes retain the original process-absence contract.

The original classifier did not observe the optional cleanup signature; the diagnostic did. That difference must not be erased or treated as proof that the cleanup signature is the only possible reset path. [Capture index](capture-index.json) binds every copied input to its original ZIP member, byte length, SHA-256 and available command status; selected log lines retain one-based raw-log coordinates. Originals are copied byte-for-byte, not reconstructed.

Both images: `google/sdk_gphone64_x86_64/emu64xa:15/AE3A.240806.043/12960925:userdebug/dev-keys`; SDK download `x86_64-35_r09.zip`; emulator 37.2.12 build16428233. Original ZIP SHA-256 `29c4e4d5d263d5da57982b986625762421e187d4314e83135e946cce29de6f1c`; diagnostic `6b220ba14bb4e2224cda27a87e7841ce2dc12bfaa880640073d0a413dcc6d8b0`. Earlier raw/ZIP hashes and failures remain unchanged in the parent evidence commit.

## 4. First executable step: same-image, read-only capability preflight

Prepared [read-only-preflight.py](read-only-preflight.py) requires an explicitly selected **already-running owned ephemeral** target and a fresh output directory. It queries fixed build properties, system_server PID, an `adb jdwp` PID snapshot, PassengerCount package/app-ops/services, readable framework JAR digests, and framework-test package presence. Optional SDK source.properties/package.xml bind the installed image revision. It neither starts the app nor runs acceptance. No root, setprop, reboot, install, privilege grant, debug attach, port forward, or device-setting operation occurs.

Planned invocation at the existing SDK-image CI startup point, before original gates and again before teardown if needed:

```sh
python3 verification/api35-restart-race/route-20261026/read-only-preflight.py \
  --serial "$ANDROID_SERIAL" \
  --output-root "$RUNNER_TEMP/passengercount-platform-capability" \
  --sdk-image-dir "$ANDROID_HOME/system-images/android-35/google_apis/x86_64"
```

**Prepared, not wired or executed on a device.** It is on the evidence ref, not the PR implementation checkout; a normal reviewed source change must materialize/wire it before a naturally triggered validation. Do not run an unchanged manual OS rerun. Preserve the original test exit separately; preflight exit 0 only means its commands completed, never that the APK restart passed. Missing command evidence yields 2; a timed-out JDWP query also yields 2 and retains partial output. `adb jdwp` is a finite snapshot, unlike `track-jdwp`, as confirmed by the [official daemon implementation](https://android.googlesource.com/platform/packages/modules/adb/+/refs/heads/main/daemon/jdwp_service.cpp). Tests exercise transport/capture behavior only, not a substitute Android policy model.

Exact missing input for choosing the next trace route: current system_server PID and whether it appears in `adb jdwp`; existing JDWP property; installed image metadata plus framework binary hashes; actual package/app-op state near the failure. The closed run113 VMs cannot supply new reads. A new, meaningfully instrumented validation is needed for those observations, not another source-policy audit.

## 5. Conditional real-framework trace, without assuming a full build prerequisite

[Official platform debugging](https://developer.android.com/studio/platform/debug) supports real Java system-process stacks/fields. Its Enable JDWP operation sets a persistent property and reboots; that operation is outside this no-settings-change preparation and has not been used. The [pinned API35 Zygote source](https://android.googlesource.com/platform/frameworks/base/+/4e43ad12e1b211f15152e9c5b16b0fe88e6b93f3/core/java/com/android/internal/os/Zygote.java#1036) enables JDWP for eng, or userdebug with the property enabled; [ZygoteInit](https://android.googlesource.com/platform/frameworks/base/+/4e43ad12e1b211f15152e9c5b16b0fe88e6b93f3/core/java/com/android/internal/os/ZygoteInit.java#685) applies it before system_server fork. This is source evidence, **not proof that the tested Google image has identical source or that attachment works**.

If system_server is already exposed and attachment is available under unchanged access, prepare a target-scoped JDI/JDWP collector against actual loaded classes. First record VM capabilities, class/method/field signatures and image identity; do not assume source line tables or field-watchpoint support. Observe the specific TrackService record at restriction reset, foreground demotion, service death/detach, pending-restart enqueue/dequeue and foreground promotion. Capture caller stack/thread, record identity, package/UID, process attachment, start/WIU reason fields, foreground/type, started/sticky flags and monotonic ordering before/after each transition. Use actual runtime signatures; static r1 names/line numbers are not a matched-image contract. No method invocation, field modification, policy override or blanket method tracing. Stop after the target transition and terminal result; detach/resume on collector failure.

A debugger pause perturbs timing: use the shortest thread-scoped suspension needed and record it. Even a successful instrumented restart cannot replace uninstrumented original acceptance. If JDWP/attach/event support is unavailable, record that exact result. Do not silently enable it. A debug-capable disposable image or explicitly scoped test configuration may be an alternative later; that is not proof a custom AOSP image is always necessary.

## 6. Framework regression route and actual resource gap

The verified source module [FrameworksMockingServicesTests](https://android.googlesource.com/platform/frameworks/base/+/4e43ad12e1b211f15152e9c5b16b0fe88e6b93f3/services/tests/mockingservicestests/Android.bp) uses platform APIs, services.core and a platform certificate. Its [ActiveServicesTest](https://android.googlesource.com/platform/frameworks/base/+/4e43ad12e1b211f15152e9c5b16b0fe88e6b93f3/services/tests/mockingservicestests/src/com/android/server/am/ActiveServicesTest.java) currently uses mocked ActiveServices/ServiceRecord objects around real restart-scheduling methods. The Ravenwood target includes BroadcastRecordTest, not ActiveServicesTest. `--host` is not an established shortcut.

Once the actual caller/order is known, add a regression driving the **real** eligibility lifecycle methods and a real ServiceRecord; mock only necessary external dependencies, not the policy under test. Cover: previously eligible sticky LOCATION service losing all app processes; unrelated FGS start interleaved while restart is pending; absent UI both before/after recreation; ordinary ineligible background start still denied; explicit stop/session deletion still prevents resurrection. Assert reason/foreground/sticky transitions and final outcome, not merely a copied predicate. Run baseline failing and patched passing cases on the same source/image pair, plus the actual APK gate independently.

In a configured, matching AOSP checkout/device environment, the concrete [Atest](https://source.android.com/docs/core/tests/development/atest) route is:

```sh
atest FrameworksMockingServicesTests:com.android.server.am.ActiveServicesTest --dry-run
atest FrameworksMockingServicesTests:com.android.server.am.ActiveServicesTest -b
atest FrameworksMockingServicesTests:com.android.server.am.ActiveServicesTest -it -s "$ANDROID_SERIAL"
```

The pinned frameworks/base commit is `android-15.0.0_r1`, not a verified match to `AE3A.240806.043/12960925`. The [public build table](https://source.android.com/docs/setup/reference/build-numbers) maps r1 to AP3A.240905.015.A2; the tested AE3A identifier was not found there. No exact matching source manifest/test APK/platform certificate has been verified. A test APK built for public AOSP must not be assumed installable on the Google image merely because both say API35.

Resource facts, not a claim of measured minimum for this one module:

- [AOSP's documented workstation baseline](https://source.android.com/docs/setup/start/requirements) is 400 GB free disk and 64 GB RAM for checkout/build; its example full-build times are about 40 minutes on 72 cores versus 6 hours on 6 cores. Current local workspace has about 30 GB free/9.7 GiB RAM and no /dev/kvm or Android platform build tree.
- [Standard public Actions Ubuntu](https://docs.github.com/en/actions/reference/runners/github-hosted-runners) is 4 vCPU/16 GB RAM/14 GB SSD and supports Android SDK acceleration. This repo's existing job is 25 minutes. Its SDK emulator already runs the actual APK gates; it is not a demonstrated full AOSP build machine. No larger/paid runner was provisioned.
- [Official Cuttlefish](https://source.android.com/docs/devices/cuttlefish/get-started) offers prebuilt images and same-build host packages, avoiding a full build for a baseline run. KVM and host packages/udev/group setup are required. Public build [16644040](https://ci.android.com/builds/submitted/16644040/aosp_cf_x86_64_only_phone-userdebug/latest) visibly offers a 1.1 GiB image ZIP, 857.2 MiB host package, 165.2 KiB manifest and 77.3 KiB repo.prop. This latest-release build is **not established as API35 or matched to our failure**. Its inspected artifact list did not expose FrameworksMockingServicesTests. Compressed sizes are not unpacked RAM/disk requirements. No images downloaded or host settings changed.
- [Official Android 15 GSI release metadata](https://developer.android.com/topic/generic-system-image/releases) provides initial AP3A.241005.015/build12366759 x86_64, SHA-256 `96716f9bff890f7336274b8bc80b3dd816b3571f881beffbfe91800ee41300f9`; the build table maps that release to android-15.0.0_r2. This is a public source-associated alternative, not the tested Google SDK image. A GSI alone does not supply a compatible Cuttlefish kernel/vendor/host set, verified debug capability, or this test APK. No license dialog was accepted and no image was downloaded. Android CI's attempted android15 branch lookups returned ambiguous not-found/credential text; that is not proof all API35 prebuilts are unavailable.

Thus the next executable step is the inexpensive same-image capability/identity observation above. The exact further input for a new platform regression is either an existing sufficiently provisioned, matching AOSP build/device environment, or a verified API35 image + source manifest + compatible platform test bundle/build path. Do not invent either availability or an owner-consent blocker.

## Validation of this preparation

`python -m unittest -v test_read_only_preflight.py`: 4/4 host transport/archive tests passed, including success followed by a partial failure preserving the prior attempt. `python -m py_compile read-only-preflight.py`: passed. Neither command contacts Android. No actual preflight, debugger trace, framework regression, or new APK acceptance run has executed. All original raw hashes, failures and acceptance gates remain binding.

Native review caught and corrected an initial finite-snapshot/stream misunderstanding before publication: a JDWP timeout is incomplete, never collector success. No device query was made by the incorrect draft.
