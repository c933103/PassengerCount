# Run114: actual platform identity captured; JDWP enumeration remains incomplete

[Run40265931593](https://github.com/c933103/PassengerCount/actions/runs/40265931593), attempt1, is terminal **FAILED**. Head `061f9d22036572163fa0c68551cf4953d0d556c1`; tested merge `7fda308f3eaafa49469aad6078caf8c5add958a7`; verified tree `607269680eb52865d796bbf0f6257b18925a71cc` for both. Fresh exact-head Codex review was requested in [comment6407796080](https://github.com/c933103/PassengerCount/pull/19#issuecomment-6407796080); it was still processing when this archive was prepared. No review approval is implied by the test results.

## Original acceptance still fails

- Hosted Node453/453, native, browser, app and instrumentation builds passed.
- All original13 installed phases passed. UI IPC/lifecycle and service-only restart verification also passed; tracker6206→6742 with surviving UI was not used as full-process acceptance.
- Original full all-process-absence restart6742→6996 was denied, exit1. No optional cleanup signature was observed in that sample.
- Independent fresh-emulator full restart3071→4094 was denied, exit1; cleanup signature was observed during absence.
- Both terminal results remain paired with exact per-attempt raw log/service bytes. All paired inputs' hashes, byte lengths and successful capture statuses were checked. Prior run111/112/113 archives are untouched.

See [receipt](receipt.json), [original result](original-result.json), [diagnostic result](diagnostic-result.json), paired-input manifests, raw state snapshots and indexed trace excerpts in this directory. The ZIPs were independently downloaded and matched GitHub's artifact digests and lengths:

| Role | Artifact | ZIP bytes | SHA-256 |
|---|---:|---:|---|
| Original |12627005327|27136029|29e52e2587eaada09c444a927e6671ce100c8954a8ef5ae310ddbfb8f293ab6e|
| Diagnostic |12627090037|5891792|4fccd4a4ec5c46bce346bbf25f393113ae03d6cb32e1cced6456f2b0eb8a6d9d|

## What the new preflight actually established

Both before-tests and after-tests captures ran on each fresh emulator, outside test preparation/absence. Every ordinary query completed with exit0/empty stderr. SDK metadata and all raw command/member hashes were verified. Each collector nevertheless correctly reported **incomplete2**, solely because its `adb jdwp` query hit its2-second bound with no output; original exit1 was preserved.

The exact captures are stored as arrays of ZIP-member records in [original-platform-captures.json](original-platform-captures.json) and [diagnostic-platform-captures.json](diagnostic-platform-captures.json). Each member has its unchanged UTF-8 content, source path, byte length and SHA-256, including empty stdout/stderr and the original receipt JSON. The copied command status is not inferred from content.

| Observation | Result across all four captures |
|---|---|
| Fingerprint |google/sdk_gphone64_x86_64/emu64xa:15/AE3A.240806.043/12960925:userdebug/dev-keys|
| SDK image |Google APIs x86_64, revision9, API35, extension13|
| system_server PID |562 original;556 diagnostic; stable before/after in each emulator|
| ro.debuggable / build type |1 / userdebug|
| persist.debug.dalvik.vm.jdwp.enabled |empty property value; successful getprop|
| adb jdwp |timeout, empty stdout/stderr — **not a completed empty PID list**|
| FrameworksMockingServicesTests package query |successful query, no matching installed package|
| services.jar SHA-256 |1d241dbf234d4773e80fc0d0fd137920bb4c5b1d1ce51b3ddf79d1afbc65a6c6|
| framework.jar SHA-256 |f3a7bca4fadf18b9454d004f7aec9dea9a44cb197e61df80ed545a97e87b107c|
| SDK source.properties SHA-256 |809a6f5103c048607257f03f18e22dd740137e9009c99d4a496de846b6ee3412|
| SDK package.xml SHA-256 |c00c7fa7dd1587d93921b4b43a02799dfdd101a9488bed485e284dacd4ad95e6|
| Location UID app-op modes |COARSE_LOCATION and FINE_LOCATION:foreground|
| Background-location permission |not requested/granted in package captures|

After-test app-op history also includes prior FINE_LOCATION/GPS access and START_FOREGROUND entries. Those historical app-op entries do **not** override the separate ActivityManager background-start denial, and the captures are not an atomic permission snapshot at the failing call.

Userdebug and unset property are actual observations, but the timeout does not establish that system_server cannot be advertised or attached. The precise cause of the empty `jdwp` timeout is not established. No debugger attach, root, setprop, reboot, port forward or permission change occurred. AOSP source citations alone are not a proven match to these binary hashes.

## Next permitted tracing step: complete the capability observation without attaching

The immediate technical gap is an explicitly complete JDWP enumeration, not owner consent for the existing task. Official ADB [protocol documentation](https://android.googlesource.com/platform/packages/modules/adb/+/a8ab5ceccb41035804ad83bfa625adac4a8ccf83/SERVICES.TXT) and [daemon source](https://android.googlesource.com/platform/packages/modules/adb/+/refs/heads/main/daemon/jdwp_service.cpp) provide an initial length-framed `track-jdwp` snapshot. The CLI forwards it without stripping its header. A bounded first-frame reader can observe the existing advertised process list, then stop/reap only its own local client; this is not the separate `jdwp:<pid>` attachment service.

Require four ASCII hex length bytes plus the complete declared PID/newline body. `0000` is a complete empty snapshot; timeout, malformed/truncated framing and stderr remain incomplete. Preserve raw bytes, actual local termination status and stable preceding/following system_server PID separately. Do not convert the old timeouts into successful empty observations. A nonempty frame can be truncated by daemon capacity, so missing PID is not automatically proof of global absence. Any visibility conclusion applies only at that observed snapshot; listed PID does not prove attach permission.

That bounded transport probe is the next meaningful diagnostic source change under preparation, with regression checks and fresh natural validation before any claim about capability. It requires no paid provisioning, device/security-setting change, Work, platform reimplementation or debugger attachment. The original all-process gate remains unchanged. A custom AOSP module is still an investigative option, not an imposed product requirement or a substitute APK fix.
