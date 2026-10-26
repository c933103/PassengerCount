# Run116 installed ActiveServices RESET caller map

## Useful result

The installed binary exposes a specific, testable **demotion of a retained sticky service while its package has no process** route:

`new active-FGS package (the existing separate-UID trigger is suitable)` → `requestUpdateActiveForegroundAppsLocked(same-user ServiceMap, 0)` → `ServiceMap.handleMessage(what=2)` → `updateForegroundApps` → UID/package process lookup returns false when the UID record or package process is missing → `stopAllForegroundServicesLocked` → `setServiceForegroundInnerLocked(id=0, flags=0)` → `resetFgsRestrictionLocked`.

This fits the sampled pending state much better than completed service teardown or a first-promotion timeout. It is a **static route plus independent state/log consistency, not an observed runtime stack or proof this caller executed**. No application fix, acceptance success, permission change, or impossibility of an application-level solution is claimed.

## Provenance and limits

- [Run116](https://github.com/c933103/PassengerCount/actions/runs/40270319226), [original artifact 12628766327](https://github.com/c933103/PassengerCount/actions/runs/40270319226/artifacts/12628766327), [diagnostic artifact 12628861107](https://github.com/c933103/PassengerCount/actions/runs/40270319226/artifacts/12628861107).
- Tested PR head `142fcaf81a37b198aa9c90f7ce0dd271942c0396`; merge `8e17a36c894b16ea5acd262693a78e509183acbf`; tree `44328ab7f85f2e51e74b58856b878b5db977957b`.
- Exact installed `/system/framework/services.jar`: 21,446,452 bytes, SHA256 `1d241dbf234d4773e80fc0d0fd137920bb4c5b1d1ce51b3ddf79d1afbc65a6c6`; three DEX039 entries. Local hashes independently verified against the receipt. SDK35.0.0 dexdump hash `ef273cb9e5a01ccbba046ea7c80d73203f0c908d2779b4c58e21091753c86049`.
- All three complete disassemblies scanned. Exactly three **direct invoke instructions** target RESET; none in classes2/3. This is not a claim to enumerate native/reflection callers or runtime optimized machine-code stacks.
- `manifest.json` binds all inputs and verbatim method excerpts. `direct-invocations.json` includes exact signatures, DEX file offsets, code-unit PCs, disassembly line numbers, and raw six-byte RESET invoke bytes. All line numbers below are 1-based in `classes.dex-dexdump.stdout`; `+PC` is a 16-bit code-unit offset from the method's instruction array, not a byte offset.

## Every direct RESET invoke

| Declaring method | Invoke PC / DEX byte offset | Dump line / embedded source line | Necessary local path |
|---|---|---|---|
| `ActiveServices.bringDownServiceLocked:(Lcom/android/server/am/ServiceRecord;Z)V` | `+029e` / `0x2ad470` | 386636 / 6437 | Normal teardown path; both old-isForeground branches converge at +0293 before RESET. No foreground-only guard on RESET. Exceptions may abort earlier. |
| `ActiveServices.setServiceForegroundInnerLocked:(Lcom/android/server/am/ServiceRecord;ILandroid/app/Notification;III)V` | `+03b7` / `0x2b1b9e` | 398705 / 2488 | Nonzero notification ID; earlier validation succeeds; not routed through the existing-short-FGS or time-limited-type branches; count==0 (+039f), fgRequired==false (+03a3), elapsedRealtime-createRealTime > timeout (+03b5). |
| Same method | `+0858` / `0x2b24e0` | 399332 / 2806 | ID==0 (+000d→07a6) and isForeground==true (+07aa). Notification flags choose cleanup details, not whether RESET runs; normal path reaches it after type=0 and observer signaling. |

### Local ordering that matters

- Teardown removes the instance-map entry at +01b6 (line386516), removes the intent-map entry +01eb, zeros totalRestartCount +01ee, and calls `unscheduleServiceRestartLocked(r,0,true)` +01f0. It then writes isForeground=false +0293, ID=0 +029a, notification=null +029c, RESET +029e. RESET precedes `clearDeliveredStartsLocked` +02a6 and the possible scheduleStopService +0339. A non-null different record removed from the instance map produces an exception at +01e6 rather than reaching RESET.
- The timeout path **clears fgRequired earlier** at +0143, after reading it +013f. The +03a1 predicate re-reads the field, not saved `origFgRequired`. Therefore this predicate is not evidence that the original start used startService instead of startForegroundService. After RESET it immediately recalculates at +03e4 with `BackgroundStartPrivileges.NONE,false`. These details also occur in [public r1 lines2236–2244](https://github.com/aosp-mirror/platform_frameworks_base/blob/android-15.0.0_r1/services/core/java/com/android/server/am/ActiveServices.java#L2236-L2244) and [2485–2500](https://github.com/aosp-mirror/platform_frameworks_base/blob/android-15.0.0_r1/services/core/java/com/android/server/am/ActiveServices.java#L2485-L2500); they do not establish this timeout caused Run116.
- The stop-foreground path writes isForeground=false +07ec, finishes START_FOREGROUND AppOp +0825, logs exit +0841, clears type +0851 and deferred flag +0853, signals observers +0855, then RESET +0858. It does not remove the service record or unschedule its sticky restart.

## RESET's actual field-write callees

`resetFgsRestrictionLocked:(ServiceRecord)V`, code_item `0x2b05e0`, lines395006–395038:

1. +0000 calls `ServiceRecord.clearFgsAllowWiu:()V`.
2. +0003 calls `ServiceRecord.clearFgsAllowStart:()V`.
3. +0007/+0009 null `mInfoAllowStartForeground`/`mInfoTempFgsAllowListReason`; +000c clears `mLoggedInfoAllowStartForeground`.
4. +000e evaluates `isFgsAllowedWiu_forStart`; +0012 passes the result to `updateAllowUiJobScheduling`.

Each clear method has three direct `iput` writes of integer -1: WIU PCs +1/+3/+5 at DEX bytes `0x35a116/0x35a11a/0x35a11e` (lines596527–596529), START at `0x35a0f6/0x35a0fa/0x35a0fe` (596504–596506), respectively `_noBinding`, `_inBindService`, `_byBindings`. No branches in either clear method. RESET itself does not write count, isForeground, ID, notification, or type. The public r1 [RESET method](https://github.com/aosp-mirror/platform_frameworks_base/blob/android-15.0.0_r1/services/core/java/com/android/server/am/ActiveServices.java#L8334-L8341) matches this ordering; it is a comparison, not a claim the whole Google image equals r1.

## One further level: why stopAll can run

Only two direct callers enter `setServiceForegroundInnerLocked`: the `setServiceForegroundLocked(ComponentName,IBinder,I,Notification,I,I)` lookup wrapper at +0024/line399696, and `stopAllForegroundServicesLocked(I,String)` at +005a/402301. The latter passes **id0, null notification, flags0, type0, uid0**. It selects same-UID OR same-package foreground services, excluding entering-reason301 and device-provisioning packages (+0025..003f). It does not require `r.app != null`.

Exactly three direct callers target `stopAllForegroundServicesLocked`:

1. **`updateForegroundApps(ServiceMap)` +0063 / DEX0x2b33a2 / line403535.** Its loop examines all active foreground packages in that user's map. Unless an ended entry has already qualified for removal, it reaches this call when `mAppOnTop == false` (+0052) and the UID/package allowance check returns false (+005c).
   - `isForegroundServiceAllowedInBackgroundRestricted(I,String)Z` returns false on missing UidRecord at +0008 or missing package ProcessRecord at +000e, branching to +0018 (lines390398–390409). **This can occur without checking a ProcessStateRecord's background-restriction/AppOps state.** Only a present process reaches the overload that checks background restriction and process state. [Public r1 comparison](https://github.com/aosp-mirror/platform_frameworks_base/blob/android-15.0.0_r1/services/core/java/com/android/server/am/ActiveServices.java#L2115-L2120).
   - ServiceMap `handleMessage` dispatches what2 to this method at +0024/line383310. `requestUpdateActiveForegroundAppsLocked(...,0)` obtains what2 at +0001 and sends it at +001c (394735–394750).
   - **Existing external trigger:** when startForeground creates a previously absent active-FGS package entry, `setServiceForegroundInnerLocked` inserts it at +0605 and requests this same-user update at +060a/line399022. The existing separate-UID RestartRaceTriggerService can therefore cause the worker to revisit PassengerCount during its full-process-absence interval. This requires no new app permission or artificial process-survival exception.
   - A second natural enqueue is UID top-state change: `foregroundServiceProcStateChangedLocked` sets mAppOnTop=false when curProcState>2 (+0033,+0043) and sends the immediate request +004d/389221 if changed. This is another possible source of the same worker, not a claimed observed event.
2. **`ActiveServices$BackgroundRestrictedListener.updateBackgroundRestrictedForUidPackage(I,String,Z)` +0023 / 0x2a3c3a /381586.** Updates ProcessList state, then requires both UID/package allowance=false and alarm-clock temporary allowance=false. No direct branch simply on the boolean callback argument.
3. **`OomAdjuster.lambda$applyOomAdjLSP$1(ProcessRecord)` +0010 /0x33b5c0 /543283.** Under AMS lock, calls stopAll using the captured process's uid/package, with no recheck in this callback. `applyOomAdjLSP` posts its synthetic Runnable at +0354/538511 only after bound-by-nonrestricted state changes to false and `isBackgroundRestricted()` is true (+033e..0349). A queued callback can execute later; its enqueue conditions have not been observed here.

## Reconciliation with both actual denial captures

`state-narrowing.json` verifies each original byte length/hash before selecting TrackService lines. Original token `b430e75`; diagnostic `48f66dc`. Before and pending snapshots have count1. Pending retains startRequested/callStart=true, ID19 and non-null notification, but has app=null, all six reasons DENIED, isForeground=false, type0 and scheduled restart.

- First-promotion timeout requires count0, unlike the sampled count1→1 transition. The parallel all-DEX writer analysis found only the count increment, not a reset. Sequential snapshots do not prove every intervening state or rule out unobserved object replacement/mutation.
- Completed bringDown would have removed map entries, unscheduled restart, set ID0 and notification=null before RESET. It does **not alone explain** retained ID19/notification, same record and pending sticky restart without later unobserved restoration/reinsertion.
- stopAll→stopForeground(flags0) preserves ID/notification, count and sticky record while clearing type/foreground/reasons: this matches the sampled field pattern. None of this proves the runtime caller was updateForegroundApps rather than another demotion caller.
- Existing full-log bytes corroborate opportunity, not stack: diagnostic log has gone uid10209 at04:48:39.329, trigger foreground at39.609, then `START_FOREGROUND` finish warning at39.612 on system_server TID614. Its thread name is not independently mapped. Original log has gone uid10209 at04:47:32.532 and trigger foreground at32.921. Filtered contexts retain exact source hashes and LF line numbers. An AppOps finish warning is **not itself proof of a permission-policy denial or a RESET invocation**.

## Smallest next executable investigation

The existing trigger already exercises the concrete external stimulus; do not invent a new app feature, alter permissions, or replace the original full-absence gate. First compare the already captured next-run state/logs against this exact retained-record pattern. Additional absence/timing samples alone cannot identify a caller stack.

For a decisive framework observation/regression, the minimum targets are:

- entry to `updateForegroundApps`: target ActiveForegroundApp uid/package, mAppOnTop/mEndTime, UID lookup and package-process lookup results;
- `stopAllForegroundServicesLocked` entry: immediate caller and target uid/package;
- `setServiceForegroundInnerLocked(id0)` and RESET: record identity, count, fgRequired, isForeground/type/ID, six reason fields, map/restarting membership before/after;
- enqueue/dispatch of ServiceMap what2, distinguishing the existing trigger's +060a enqueue from UID-state and other enqueue sources.

A bounded **actual-framework** regression can prepare a retained started foreground ServiceRecord (count1, ID19, non-null notification, queued sticky restart), mAppOnTop=false, and no package process; dispatch the real ServiceMap what2/updateForegroundApps and assert demotion plus preserved record/restart. The positive control keeps a legitimate present, nonrestricted package process, and the negative control omits the queued update. This must execute real framework code, not a Python/JavaScript policy reimplementation. It is a diagnostic regression, not full-restart acceptance. These caller/lookup observations are not in the current receipts. This static analysis does not establish an exact-installed runtime tracing capability or a runnable actual-framework harness; public r1 source agreement alone is not an execution result.

No device action, settings change, debugger attachment, repo write, or gate mutation was performed. Only temporary extraction/report files were written. The original failing full-all-process-absence acceptance and exit1 remain binding.
