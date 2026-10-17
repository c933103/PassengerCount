# Run108: harness attached to the wrong process

The installed aggregate and its separate diagnostic both failed before a detached death or controlled interleaving. Neither establishes a new product restart outcome. Original and diagnostic bootstrap passed. The first owner-local service assertion timed out in each run.

The captured instrumentation runtime PIDs were the real UI PIDs, while TrackProvider was running in a separate tracking PID. API35 `ActivityManagerService.startInstrumentation` and `instrumentWithoutRestart` select `ApplicationInfo.processName` for `--no-restart`, even when the instrumentation declares another `targetProcesses` value. Cold instrumentation uses the first declared target.

Sources: [API35 ActivityManagerService](https://android.googlesource.com/platform/frameworks/base/+/android-15.0.0_r1/services/core/java/com/android/server/am/ActivityManagerService.java), [API35 AppProfiler secondary-process attachment](https://android.googlesource.com/platform/frameworks/base/+/android-15.0.0_r1/services/core/java/com/android/server/am/AppProfiler.java), [documented instrumentation process list](https://developer.android.com/guide/topics/manifest/instrumentation-element).

The correction makes tracking the explicit application-default process and keeps MainActivity explicitly in its original process. All three actual production component process names remain identical. Owner-local fixtures can then attach without restarting. Real UI IPC fixtures use declared secondary-process instrumentation, wait for owner detachment before calling across Binder, and require independent UI completion/detachment evidence rather than treating the owner watcher result as UI success. This harness correction is not the product remedy.

Safe excerpts omit synthetic workspace/session contents and irrelevant emulator logs. Artifact ZIP bytes were downloaded and SHA-256 checked; hashes and run/source/APK identity are in receipt.json. Prior real restart failures and all original acceptance gates remain binding.
