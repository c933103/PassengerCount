# Transactional capture repair and retained full-restart failure

Implementation: `328d87d3c6bae32ba081aef6c1890e45e59bb9bd`, tree `6a939342a8bfab3098223144950ec138c330bcca`.
This evidence branch extends the prior archive at `69cd32be3d37392f4e1a69fcee7f0aad7af630dd`; it is not an implementation or release branch.

## Repair boundary

The run111 diagnostic ZIP was independently downloaded and its digest verified (`ca62ec0dc4d54a11ae8bb419477aaa210195b85b3c733559554826d307dff7f6`). Its root classifier cited zero-based lines 42508–43827, but the overwritten raw `race-logcat.txt` contained only 20529 lines and ended mid-line. That raw log's SHA-256 is `9d215f0a62378446ea140dfe3dca2e392b89e1582e3766d1f6b59e1c3b3c5efb`. Empty stderr did not establish the failed adb command's underlying cause. The original run111 installed exit 1 remains preserved in the old archive; the diagnostic exit 2 cannot replace it.

Only five implementation paths changed: the capture runner, classifier, regression tests, Android test documentation, and a compact source-bound receipt. Post-trigger capture attempts now have separate directories and retained command statuses/stderr. Complete classifications bind exact raw input paths, byte lengths and SHA-256; one atomic result replacement publishes a matching pair. Later partial or failed captures cannot overwrite prior valid observations. Captures are sequential, not a claim of a simultaneous OS snapshot.

Tests cover complete observation followed by partial/nonzero capture, zero-exit capture with stderr, second-input failure, classifier failure and launch exit 1; initial failures; mixed/missing/reused inputs; publication stages; ordinary success and denial; and already-observed denial followed by publication failure. Internal publish-mode denial status 10 distinguishes a measured product denial from a generic classifier exit 1. The runner still emits external product failure 1; capture/classifier uncertainty is 2, never success. Standalone classifier 0/1/2 remains unchanged.

[Exact-head Codex review](https://github.com/c933103/PassengerCount/pull/19#issuecomment-6407199890) found no major issues. Local focused tests passed 73/73 and the native suite passed. Local aggregate Node was 434/435 only because the temporary partial checkout lacked the bundled N8 binary fixture; local browser could not launch without Chromium. Natural full-checkout hosted validation supplies the actual complete-checkout results; neither local limitation was skipped or converted to a pass.

The original 13 lifecycle gates, all-package-process-absence criterion, production code, workflow, signing and permission scope remain unchanged. No unchanged manual OS rerun, merge, release or user-device action was performed. Diagnostic repair is not an APK restart fix.

## Terminal exact-head result

Natural [run113](https://github.com/c933103/PassengerCount/actions/runs/40261475995), attempt 1, tested merge `db7eb5561462b4d840f3657b8da20900400e2ed3` with the exact implementation tree. Full hosted Node passed 435/435; native/browser and both APK builds passed. All original 13 lifecycle phases and the service-only 6133→6639 restart with UI PID 6434 surviving passed. Full all-process-absence restart 6639→6874 was denied (original exit 1); its separate fresh-emulator 2970→3843 diagnostic also recorded denial (exit 1). The former has no observed cleanup signature; the latter has a cleanup signature during absence. The workflow remains FAILURE. Both ZIPs and every complete capture/result input pair were independently byte/hash verified. This is a verified diagnostic repair, not full restart acceptance.

Run112 remains separately retained: original exit 255 with terminal adb-device-offline evidence, incomplete original lifecycle suite; separate all-process diagnostic exit 1. It is not substituted for the exact-head result.

## Reading the new receipts

`run112/` and `run113/` record the separate naturally triggered runs. Each receipt binds implementation head, actually tested merge/tree, artifact ZIP IDs/digests/byte verification, original and diagnostic outcomes separately, and exact raw-file hashes. The role-specific `*-paired-input-manifest.json` files verify every retained complete observation, not just the last pointer. The root result is byte-equal to its attempt's result. Trace excerpts retain explicit zero-based classifier indices.

Full synthetic-emulator raw logs remain in the named GitHub Actions artifacts with their recorded expiry; compact receipts and exact target-scoped excerpts are durable here. No original archive file was replaced. A transport failure does not establish a product defect; a separate measured restart denial remains product failure. Neither result permits accepting less than full all-process-absence recovery.

## Concrete next product step (not another source audit)

The next missing evidence is the system_server eligibility mutation, not whether ActivityManager requests or recreates the tracker. For the recorded Google image, the fingerprint alone does not establish binary equivalence to the archived AOSP base. First obtain an instrumentable system image with its exact source revision/build configuration/flags recorded, preserving the same app/test APK pair and original all-process-absence sequence.

On that target, trace the same ServiceRecord identity and pending-restart membership across death, helper-triggered foreground-app update, demotion/reset, process recreation and promotion. Capture target-scoped caller stacks before and after every eligibility reset or record replacement, along with both real foreground-start and while-in-use reasons, process presence and actual restriction state. This distinguishes foreground-app cleanup from restriction-listener or other reset paths. A warning string alone is not proof of the caller or field mutation.

The concrete existing framework test entry point on archived base `4e43ad12e1b211f15152e9c5b16b0fe88e6b93f3` is:

```sh
atest FrameworksMockingServicesTests:com.android.server.am.ActiveServicesTest
```

- [Module definition](https://github.com/aosp-mirror/platform_frameworks_base/blob/4e43ad12e1b211f15152e9c5b16b0fe88e6b93f3/services/tests/mockingservicestests/Android.bp) (blob `4149e44a2ee908d609a01989ad6324ccd0d84a76`) uses platform APIs, `services.core`, the platform certificate and device tests. Its existing Ravenwood target only includes `BroadcastRecordTest`, not `ActiveServicesTest`.
- [Existing ActiveServices fixture](https://github.com/aosp-mirror/platform_frameworks_base/blob/4e43ad12e1b211f15152e9c5b16b0fe88e6b93f3/services/tests/mockingservicestests/src/com/android/server/am/ActiveServicesTest.java) (blob `7e1dc08f301e9d5caa2fea9ee88e30e6ed12e811`) wires `mRestartingServices` and real rescheduling methods on a mock. Its mocked ServiceRecords/delay assertions are not yet an eligibility-lifecycle regression.

Extend that test area with a retained previously authorized sticky ServiceRecord and deterministic foreground cleanup during full process absence. Execute real lifecycle/eligibility logic and assert the actual reason fields, record identity and restart membership, rather than only a Boolean helper predicate. Include absent UID, same UID without package process and UI-survives controls; genuine restriction changes, explicit stop/force-stop, deleted session, nonsticky/no-restart, permission revocation and shared-UID isolation must not gain eligibility. Reproduce baseline failure before choosing the smallest confirmed-cause correction.

The current PassengerCount workflow builds app/test APKs against a Google SDK image; it contains neither a platform source checkout nor a build of this framework test or instrumented system_server. That is the concrete execution dependency, not a missing-consent claim. No platform build, new system image, policy patch or upstream submission is claimed here. A matched framework experiment must then pass the unchanged original gates, including real GPS/journal continuity before any new UI/provider/instrumentation eligibility grant; custom-framework success alone would not repair the unchanged deployed Google image.
