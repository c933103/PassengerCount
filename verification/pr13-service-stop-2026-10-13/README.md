# PR13 foreground-delivery stop repair and API35 context

## Source and scope
This revision follows PR13 head `7ac104a4a19156cd2c0d6f478a92a376480addfa` and integrates documentation-only main `5f4290bbc157139efbc43a4aef71ab76aba68b82` (merged PR11). The base tree is the previously tested merge `ea6ebfe96ede3fba5357ec07bc0b3e2e1c5a1adb`, plus main's README discovery link and project board. Producer PR10/12 remain unchanged.

The production change is bounded to rejected explicit ACTION_START delivery: acknowledge Android's foreground-start obligation before stopping, keep recording null, request no locations and accept no tombstoned/cancelled session. Cleanup runs in finally even if foreground acknowledgment is denied; the original exception propagates. A stale request with a newer accepted session still follows the unchanged current-session continuation. No manifest, target/min API, service type, Android permissions, workflow, KVM or signing changes.

## Preserved latest failing run
[Run 38329650928](https://github.com/c933103/PassengerCount/actions/runs/38329650928), head `7ac104a4a19156cd2c0d6f478a92a376480addfa`, tested merge `ea6ebfe96ede3fba5357ec07bc0b3e2e1c5a1adb`, tree `9afdceb2b942d807901739b44d9f22a4ccdc225c`.
[Artifact 11781398975](https://github.com/c933103/PassengerCount/actions/runs/38329650928/artifacts/11781398975): independently downloaded 4,631,187-byte ZIP, SHA-256 `d4a279bdbad75049ac54c86457aeea68e8709fbcc2ab39d3fc22cb81510616fa`. Bulk logs remain in the run artifact.

Passed host/native/browser/APK and KVM/API35 execution; installed bootstrap 6, basics 48, recover 15, receipt phases 10/15/11, prepare-valid 10, verify-valid 13 and prepare-deleted 12 assertions. Actual complete dumps prove detachment. Valid service restarted from PID4067 to4429; verify-valid accepted current session/token, foreground state, real emulator GPS and stale-A/current-B handling. Tombstoned service restarted4429→4759 and was observed stopped before cold verification.

Final verify-deleted in PID4789 checked persisted tombstone, unchanged journal/no restart samples and blocked reads. Its explicit stale foreground delivery then crashed with `RemoteServiceException$ForegroundServiceDidNotStartInTimeException`; logcat says “Bringing down service while still waiting for start foreground”. The old invalid-request branch stopped before acknowledging the explicit startForegroundService delivery. Overall CI failed; no complete installed-suite pass is claimed.

Earlier cohorts remain separate: [original background-start/FGS denial](../pr13-detach-proof-2026-10-13/README.md#preserved-failing-run) and [device-offline execution failure](../pr13-detach-proof-2026-10-13/README.md#review-correction-and-fresh-execution-boundary). The later successful valid restart does not erase that earlier failed background-start case or establish all background starts.

## Android contract and bounded fixture context
Manifest targets API35, min26, with the sole service type `location`, existing FOREGROUND_SERVICE/FOREGROUND_SERVICE_LOCATION and coarse/fine location permissions. No background-location exemption is assumed. Android's [START_STICKY contract](https://developer.android.com/reference/android/app/Service#START_STICKY) distinguishes sticky restarts from general background starts; [location while-in-use restrictions](https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start#wiu-restrictions) remain separate.

Exact AOSP Android15 revision `cc8bb19595c661f5cf42f330457000e643c67d1b`, ActiveServices blob `6bd7445fdd50eba48ca8c5293d99e89803036028`: [setServiceForegroundInnerLocked](https://github.com/aosp-mirror/platform_frameworks_base/blob/cc8bb19595c661f5cf42f330457000e643c67d1b/services/core/java/com/android/server/am/ActiveServices.java#L2158-L2255) clears fgRequired/fgWaiting at acknowledgment before its subsequent runtime allow/type checks; [bringDownServiceLocked](https://github.com/aosp-mirror/platform_frameworks_base/blob/cc8bb19595c661f5cf42f330457000e643c67d1b/services/core/java/com/android/server/am/ActiveServices.java#L6331-L6360) schedules the observed crash when stopping with fgRequired still set.

The harness now starts each prepared service while the real app Activity is TOP, then sends Home before the existing delayed detached SIGKILL. It records complete package-filtered process dumps and requires actual API35 curProcState TOP=2 before preparation and FOREGROUND_SERVICE=4 after Home. Instrumentation OOM labels are not treated as current activity state. Required detached proof, kill marker, new service-origin PID, foreground restart, durable receipts, GPS and tombstone assertions remain intact.

## Local verification
- `bash -n scripts/test-android-installed.sh`: passed.
- `node --test tests/android-harness.test.js`: 33/33 passed. Includes complete dumpsys response/error/truncation tests, TOP/FGS/wrong/missing process-state tests and lifecycle sequencing.
- `node scripts/test-track-deletion.cjs`: 251 production-extracted native assertions passed on JDK21. Covers explicit tombstoned/cancelled starts, no new GPS/session/journal, transient foreground cleanup, propagated SecurityException/IllegalStateException with guaranteed listener/service cleanup, null sticky restart after permission revocation and unchanged accepted-current-session continuation.
- Negative control removing acknowledgment: exit1, “foreground delivery stopped before acknowledgement”. Negative control removing finally: exit1, “foreground denial always stops rejected service and removes listener”. Both restored to fixed source before publication.

Changed-file SHA-256: TrackService.java `d30418907a3f18baf3f511482a5daf69e82d518e70246f67976cc5cb5bbd3866`; TrackDeletionFixture.java `adcd4cdf4c3e31a53f69d96934c62472f1ab0337b3f59b511293b506cce35a50`; test-android-installed.sh `a8278c61d52fb15b76154b838d4504c9e03c55098cb8017dbb24d1c615c0e2d1`; android-harness.test.js `aa1863ec7bad48810bd7867ce98af4dfc1c5cf4552abf24ce1acee254f3755fd`.

## Remaining acceptance
Fresh exact-head hosted CI and Code review are required. The service defect is not accepted as resolved until installed verify-deleted succeeds. The separate early !hasLocation branch's explicit foreground-delivery timeout behavior after permission revocation is not fixed by this bounded change; host null-restart data safety does not establish that device behavior. All-background-start, physical-device, API26, power-loss, live backend upload, original-signer and release acceptance remain open. Release1.11 stays held.
