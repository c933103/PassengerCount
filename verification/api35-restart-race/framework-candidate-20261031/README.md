# UNEXECUTED framework correction candidate — PR19

This is a reviewable Android framework patch and regression fixture, **not an application fix, an executed framework test, or completed PassengerCount acceptance**. Do not merge PR19 or release on its basis. No platform image or device settings were changed.

## Immutable source and scope

Apply to `platform/frameworks/base` commit `45034f0663f960d9ee5fb0a101a4732b71f6e2f4`, tree `6667cba9cf8225451f0822ad94cb21902025dfa3`, the recovered Android16 QPR2 branch snapshot. This is not a claimed source match for the failing API35 Google image. Original PR19 head remains `c7f31ec1f4482170efd8934e9f83603516d5f9a6` and run122 still fails full-process-absence restart.

1. `0001-regression-and-selection-seam.patch` mechanically extracts the **unchanged** three-term stopAll selection predicate into a package-visible method and adds 13 framework tests. It is the baseline preparation, not a remedy. The first two tests are expected to fail their preservation assertions on this baseline; that expectation is UNEXECUTED.
2. `0002-preserve-eligible-pending-sticky-fgs.patch` adds a private per-record exception for a genuinely pending started sticky foreground service. It does not return a blanket allowance for a missing UID.

The exception requires all of: no service host; retained foreground state and prior start eligibility; start still requested; sticky callback retained and stop-if-killed false; exact record still in `mRestartingServices`; application not stopped; no package process in any surviving UID record; and a non-null AppStateTracker confirming the package is not background-restricted. Unknown tracker fails closed. Existing alarm/provisioning exceptions and the demotion implementation remain unchanged. No new start, privilege, service type or user-stop resurrection is introduced.

This candidate addresses the concrete static stopAll demotion route. It is not proof that route caused every recorded failure, or that preserving this record suffices for later GPS recovery. Restriction races, shared UIDs, package updates, force-stop queue removal and the full service lifecycle require executed review/test coverage before adoption. This narrow candidate only protects records still in mRestartingServices; a later handoff window after queue removal is not protected or claimed repaired.

## Regression fidelity and limits

The tests execute the real production selection predicate and private preservation policy against **real ServiceRecord objects**. The positive absent-UID case also invokes real `stopAllForegroundServicesLocked` and asserts foreground/type, start/WIU eligibility, notification identity, absent host and queued restart remain intact. Only external AMS/process/restriction dependencies and static compatibility/local-service lookup are mocked. A real HandlerThread supplies the ServiceMap looper. Reflection field setup fails loudly on mismatch.

Negative cases cover actual restriction, unavailable restriction state, package-stopped flag, explicit service stop, canceled restart, stop-if-killed/nonsticky state, missing sticky callback, denied eligibility, existing host and existing package process. Already-demoted state is not restored. These are policy-selection tests: negatives do **not** execute the complete demotion path, and user-stop tests set actual record/queue inputs rather than invoking the entire force-stop API. No mock replaces the policy under test. No source-only result is labeled Android runtime success.

## Reproducible build and run on an existing compatible platform environment

Prerequisites: an already provisioned, synced Android16 QPR2 platform tree, working Soong/Atest environment with a selected build target, and an already authorized compatible disposable device. The test module uses platform APIs, `services.core` and a platform certificate; a generic Android SDK checkout/Google emulator is not an established substitute. Do not root, remount, change settings, accept new licenses or provision a paid runner to execute these instructions.

```sh
# Run in an existing configured AOSP shell; PATCH_DIR is this artifact's absolute path.
test -n "$ANDROID_BUILD_TOP" && test -n "$TARGET_PRODUCT"
cd "$ANDROID_BUILD_TOP/frameworks/base"
test "$(git rev-parse HEAD)" = 45034f0663f960d9ee5fb0a101a4732b71f6e2f4
test -z "$(git status --porcelain)"
git apply --check "$PATCH_DIR/0001-regression-and-selection-seam.patch"
git apply "$PATCH_DIR/0001-regression-and-selection-seam.patch"
atest FrameworksMockingServicesTests:com.android.server.am.PendingForegroundRestartTest --dry-run
atest FrameworksMockingServicesTests:com.android.server.am.PendingForegroundRestartTest -b
# On a matching authorized test device, retain baseline build/test logs and actual failures.
atest FrameworksMockingServicesTests:com.android.server.am.PendingForegroundRestartTest -it -s "$ANDROID_SERIAL"
# Baseline must fail the two preservation assertions, not compilation, fixture setup or transport.
git apply --check "$PATCH_DIR/0002-preserve-eligible-pending-sticky-fgs.patch"
git apply "$PATCH_DIR/0002-preserve-eligible-pending-sticky-fgs.patch"
atest FrameworksMockingServicesTests:com.android.server.am.PendingForegroundRestartTest -b
atest FrameworksMockingServicesTests:com.android.server.am.PendingForegroundRestartTest -it -s "$ANDROID_SERIAL"
```

The prepared baseline command intentionally returns failure; do not put the whole sequence in an unconditional `set -e` script or ignore why baseline failed. Require all 13 candidate tests to pass. Retain source hashes, selected target, build fingerprint, actual return codes and test XML for both legs. Restore only the two known patched files afterward using the preserved baseline; do not discard unrelated changes.

The test APK statically includes framework code; **passing it does not patch system_server**. Full acceptance additionally requires a properly built compatible framework image containing this correction and the original PassengerCount APK gates, with complete process absence, restored FGS, real GPS/journal/session continuity and existing deletion/recovery gates. Test genuine background restriction and user-stop on that real framework. Keep API35 failures separately; QPR2 success alone cannot relabel API35 as repaired. No image deployment is authorized or performed by this artifact.

## Current execution-route finding

The current chat executor has no javac, adb, Android platform checkout or `/dev/kvm`; it has approximately 17 GB free disk and 9.7 GiB RAM. The visible saved AndroidControl configuration lists application repositories, not an established platform build/device environment; no Work task was started. Existing PassengerCount CI builds SDK applications on a hosted API35 emulator. It is not a verified platform-module compiler, nor a compatible QPR2 platform-signed test device. A full AOSP checkout/build here would be unbounded relative to available resources and is not attempted.

A feasible bounded route is **module-only build in an already configured matching platform tree and installation on its existing compatible test device**, followed separately by actual patched-image acceptance. Such a tree/device is not currently connected or established. No successful compile/run is claimed. The supplied patch is source/interface-checked and apply-checked, but its buildability remains to be established by the platform compiler; fixture or API problems must be fixed before claiming the candidate works.

## Local checks

`manifest.json` binds original/prepared/candidate source and both patches. Reproduce with `python3 validate_artifact.py --framework-root /path/to/pinned/frameworks/base`; it writes only a temporary tree and never modifies that source checkout. Local checks validate exact application of patch1 then patch2 to pinned source, round-trip reversal and fixture count; they do not execute Java/Android policy. See `local-validation.json` for actual outcomes. No app/workflow/source gate modification or unchanged-image rerun occurred.
