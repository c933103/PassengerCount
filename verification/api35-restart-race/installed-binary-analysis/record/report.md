# Run116 exact ServiceRecord write inventory (static, not a runtime trace)

## Result

The exact installed `services.jar` is SHA256 `1d241dbf234d4773e80fc0d0fd137920bb4c5b1d1ce51b3ddf79d1afbc65a6c6`. All three DEX039 files and disassemblies were independently hash-checked against the collector receipt. The scan covered 4,731,276 dexdump lines across all three DEX files: **117 direct writes to the selected FGS/start/WIU/sticky/restart fields and 13 direct reset/clear/setProcess invokes**. All matches are in classes.dex; none in classes2.dex/classes3.dex. This is an exhaustive direct-instruction inventory for the listed fields, not coverage of reflection/JNI or proof that any site executed.

**No direct FGS restriction or foreground-state reset exists inside `ServiceRecord.setProcess`.** Process detachment alone is therefore not a static explanation of the lost reasons. `mStartForegroundCount` has one explicit writer, an increment during foreground promotion, and no explicit reset writer in this JAR. Existing before/pending snapshots for the same TrackService tokens retain count1 and sticky result1 while reasons/foreground state have already been lost.

## Exact fields and writers

Full declaring method signatures, code_item addresses, method-relative PCs, dexdump line numbers and embedded debug-source line hints for every write are in `all-target-field-writes.tsv` and `writer-index.json`. Code PCs are 16-bit DEX instruction offsets; dexdump lines are one-based. Embedded source positions are corroboration, not source identity.

- Six reason fields are **integer reasons**, not boolean permissions: `mAllowWiu_noBinding`, `mAllowWiu_inBindService`, `mAllowWiu_byBindings`, `mAllowStart_noBinding`, `mAllowStart_inBindService`, `mAllowStart_byBindings`.
- Constructor initializes those six to -1: PCs0021/002d/002f and0029/0031/0033 respectively, lines596081,596087–590,596085. Constructor also initializes `mAllowStartForegroundAtEntering=-1` at002b/596086. Default zero-valued fields need no explicit constructor iput.
- `clearFgsAllowWiu()V`, code_item35a104, writes WIU noBinding/inBindService/byBindings=-1 at0001/0003/0005, lines596527–529. `clearFgsAllowStart()V`, code_item35a0e4, writes corresponding START fields at0001/0003/0005, lines596504–506.
- Only other explicit nonconstructor writers to these six are `ActiveServices.setFgsRestrictionLocked(String,int,int,Intent,ServiceRecord,int,BackgroundStartPrivileges,boolean,boolean)V`, code_item2b1344, lines398122–398182. Bind pair:0039/003b; noBinding pair:0040/0042; byBindings conditional writes:0049/004f and005b/0063. PCs000e–0010 skip recomputation when the existing selected reasons are both non-denied;003e distinguishes by-binding update. This helper is not an unconditional overwrite of a prior allowed noBinding reason with DENIED.
- `mAllowWhileInUsePermissionInFgsAtEntering` is a separate boolean snapshot written at foreground entry+061e/399032. `mAllowStartForegroundAtEntering` is copied from the effective start getter+0618/399029. Neither is one of the six current reason fields.
- `mAllowUiJobScheduling` is written only in `ServiceRecord.updateAllowUiJobScheduling(Z)V` +0005/599331. It is a consequence/snapshot, not a substitute reason source.

## Foreground, sticky and process transitions

| Field | Explicit writers (method-relative PC; dexdump line) |
|---|---|
| `mStartForegroundCount` | `setServiceForegroundInnerLocked` **0623;399035**, reading0620 and adding at0622. No explicit reset/zeroing site. |
| `isForeground` | `bringDownServiceLocked`0293;386631, `setServiceForegroundInnerLocked`0612;399026 and07ec;399272, `startForegroundServiceDelegateLocked`0106;400970. |
| `foregroundServiceType` | `setServiceForegroundInnerLocked`05b4;398978 and0851;399329, delegate start0110;400975. |
| `startRequested` | `killServicesLocked`01b7;390872, `startServiceInnerLocked(ServiceRecord,...)`0023;401419, `stopServiceLocked`003f;402782, `stopServiceTokenLocked`0084;402923. |
| `callStart` | `serviceDoneExecutingLocked(ServiceRecord,IIIZ,Intent)`000f;397250 and0060;397290, `startServiceInnerLocked(ServiceMap,...)`0029;401212, `stopServiceLocked`0062;402802, `stopServiceTokenLocked`00a7;402943. |
| `stopIfKilled` | `serviceDoneExecutingLocked(ServiceRecord,IIIZ,Intent)`004a;397279,0056;397285,005c;397288 only. |
| `startCommandResult` | Same completion method0015;397253 only (special1000 result skips assignment). Result0 or1 reaches0059→005c, writes stopIfKilled=false; only result0 also clears callStart at0060. |
| `app` | `ServiceRecord.setProcess`0053;598953 only among explicit direct writes. |

`killServicesLocked` calls `setProcess(null,null,0,null)` at005d/390700. Its `startRequested=false` at01b7 is conditional on `canStopIfKilled(false)` after successful scheduling; it is not unconditional during sticky death. `canStopIfKilled` (596394–596414) returns false for a nonshort started service with stopIfKilled=false and false argument, consistent with retained startRequested in the supplied snapshots. This is static branch interpretation, not proof of the runtime branch.

`ServiceRecord.setProcess(ProcessRecord,IApplicationThread,int,UidRecord)V`, code_item35b634, lines598913–599000,173 code units, has no reset/clear invocation and no direct write to the six reasons, foreground flag/type, sticky flags, or startForegroundCount. It writes `app`, updates process state, background-activity start privileges, pending connection metadata and association/UID bookkeeping.

`resetRestartCounter()V`, lines598791–598800, zeros restartCount/restartDelay/restartTime/mEarliestRestartTime/mRestartSchedulingTime, **not** startForegroundCount or FGS reasons. The restart scheduling/time field writes are included in the TSV to avoid conflating restart counters with foreground entry count.

## Direct invocation inventory (not runtime stacks)

- `clearFgsAllowWiu`: only `resetFgsRestrictionLocked`0000/395016.
- `clearFgsAllowStart`: RESET0003/395017; `setServiceForegroundInnerLocked`020b/398479 (already foreground and short-FGS branch),02a4/398562 (time-limited type branch).
- RESET: `bringDownServiceLocked`029e/386636; `setServiceForegroundInnerLocked`03b7/398705 and0858/399332. The separate ActiveServices investigation owns detailed reset-site control flow.
- `setProcess`: `collectPackageServicesLocked`005b/388315; `killServicesLocked`005d/390700; `realStartServiceLocked`000e/393660 (attach),013c/393816 (failure cleanup); `serviceDoneExecutingLocked(ServiceRecord,ZZZI)`00a6/397496; delegate start00f0/400960. Complete signatures and instruction bytes are in writer-index.json.

## Narrow public-r1 comparison and observed mode

Official mirror source: [ServiceRecord android-15.0.0_r1](https://github.com/aosp-mirror/platform_frameworks_base/blob/android-15.0.0_r1/services/core/java/com/android/server/am/ServiceRecord.java), fetched blob`b9cdf27a741574322e0c43c4e22b125debad4290`. Targeted setProcess (source1215–1277), clear helpers401–410 and sticky helper agree with relevant actual binary behavior; no source-policy divergence is established here.

One useful build-specific refinement: r1 source280–299 expresses new mode as flag&&per-UID compat. Installed `Flags.newFgsRestrictionLogic()` at530942–530947 invokes the interface but unconditionally returns1; `FeatureFlagsImpl`1735194–1735196 also returns1. ServiceRecord's three useNew* methods therefore return the per-UID compat result, using IDs311208629 (WIU start),313677553 (WIU capabilities),311208749 (BFSL start). This is compiled behavior, not evidence of a bug or license to alter flags.

The actual original and diagnostic TrackService before/pending/restarting blocks already print **all three useNew*()=true**, count1, and startCommandResult1. Parent independently matched ENABLED messages for all three IDs/UID10209 in both raw run116 logs and is binding those lines separately. No further mode probe or toggle is warranted. `trackservice-state-excerpts.json` binds selected TrackService blocks to the original per-file archive hashes and avoids confusion with test-only short-FGS trigger records.

## Next meaningful trace/regression target

Current evidence narrows the missing event to a state-changing call **between before and pending/restarting**, not to the later failed promotion and not to mere setProcess detachment. A real framework regression/trace should retain the same ServiceRecord identity and record, around the identified RESET/clear sites and foreground demotion/type-zero sites: six reason fields, isForeground/type, app identity, startRequested/callStart/stopIfKilled/startCommandResult/count, immediate caller and full stack. Keep detach/reattach checkpoints to order events, but do not treat them as reset writers. Use real framework methods and a source/build-matched harness or specifically authorized instrumentation; do not replace it with a mocked policy model.

The existing image's read-only static route cannot supply that runtime stack, and prior complete-empty JDWP captures do not authorize debugger/security changes. The all-process-absence gate and original failures remain unchanged. Static candidates alone do not establish the runtime caller or an application fix.
