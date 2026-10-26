# Run 120: full acceptance failed; independent contrast is not acceptance

[Hosted run](https://github.com/c933103/PassengerCount/actions/runs/40280094337), attempt1. PR head `bf28a3aa9af0ca1f2d302b5b18722979448cc829`, tested merge `5e1e340bba1299b670ee8ba2e39a402c7c2ab2af`, tree `8525b3ab50ef239a72465ac7d6b619223d635f38`; merge parents independently read. Hosted 593/593 Node, native/browser/both APK builds and original13 lifecycle phases passed. Full all-process-absence gate remains **FAILED**, no merge or APK-fix claim.

| Separate result | Old → restarted tracking PID | Native exit | Observed outcome |
|---|---|---|---|
| original | 6670 → 6903 | 1 | automatic-restart-denied |
| triggered | 3131 → 3860 | 1 | automatic-restart-denied |
| control | 3049 → 3871 | 0 | foreground-observed-no-trigger |

Control is a fresh owned emulator, same exact APK/source/fingerprint receipts and full absence proof, no trigger command/marker or UI reattachment. Its foreground observation does not test GPS/session continuity or satisfy the original gate. Paired wrapper exit1 and original/triggered evidence hashes remain binding.

## Counterevidence and comparability

Triggered cleanup signature is **before** helper ENTER/FOREGROUND (06:37:47.951 vs48.071/48.099). Helper foreground promotion is not an established immediate cause or necessary logged predecessor in this run. Shell command/activity-launch effects before helper logging and other convergent framework callers remain hypotheses, not runtime stack proof.

First services host bracket in control is 81.167250ms earlier; slot replay overshoot 0.658507ms. Dump duration differs by -5.646990ms. Timing equality is explicitly false. Raw timing receipt bytes/hashes/arithmetic are retained in control-result and role receipts. A future host-only deadline wait can reduce this first-dump difference, not make device event timing or causality equal.

Both initial TrackService scheduling delays are10000ms, but triggered memory-pressure changes19798→7771→0ms versus control363ms. Triggered token c44a268/count1/id19 is retained app=null, foreground=false/type0/sixDENIED in sampled active/restarting listings; control token620156e/count1/id19 remains foreground in the new-process snapshot. Random attempt names do not establish chronology; raw log prefixes and first-timing receipt do.

All six before/after platform captures have native-success complete profiler dumps with terminal mForceBackgroundCheck and no printed AMS profiler fields. This does not exclude direct ART profiling or authorize start/stop. SET_ACTIVITY_WATCHER is granted to shell; ART APEX350820300 and candidate libart.so hash cf1c0b8e7fe7b9200a89bf30a076f44509c9a21fe18d7b33c63a48f673746cd1 are recorded, not executed/proven native profiling support. Profiling start is stateful, can stop/replace an existing profiler, write output and perturb timing; no profiling/atrace/Perfetto activation occurred.

Target fine/coarse and FGS/location-FGS permissions are granted in all six captures; no background-location declaration/grant appears, UID location AppOps remain foreground. Flags/timestamps and live AppOps activity differ; no whole-runtime equivalence inferred. All three exact services.jar captures remain SHA1d241dbf234d4773e80fc0d0fd137920bb4c5b1d1ce51b3ddf79d1afbc65a6c6 with matching three DEX/tool identities; raw disassembly hashes are independently verified, not assumed identical because filenames embed attempt paths.

## Preservation and verification

receipt.json records ZIP IDs, original lengths/digests/expiry, exact source, native exits and phase statuses. Every classifier input, observer raw/status/scope source, platform command stream/SDK metadata and framework archive/DEX/disassembly stream was independently rehashed against downloaded artifact bytes. The triggered guard's entire file list was independently rehashed after control. Selected raw lines carry original member paths, byte lengths, SHA256 and zero-based indices. Large raw logs/system dumps/JARs/disassembly stay in original artifact ZIPs, not substituted by these excerpts. Previous run evidence is additive and unchanged.

No permission, security/debug setting, app, signing, workflow, acceptance-gate, merge or release change. This archive is evidence only.
