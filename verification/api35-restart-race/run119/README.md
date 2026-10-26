# Run 119: full acceptance failed; independent contrast is not acceptance

[Hosted run](https://github.com/c933103/PassengerCount/actions/runs/40278271990), attempt1. PR head `61c3c6b156136ebf0cb4bf7e2ff2609b2ad67d5d`, tested merge `e4fbfcacc112addcb3d1ae8d76e600a377b22864`, tree `f5ac734774cfaa44503ae2f7b1aefbcc8df3d9cb`; merge parents independently read. Hosted 591/591 Node, native/browser/both APK builds and original13 lifecycle phases passed. Full all-process-absence gate remains **FAILED**, no merge or APK-fix claim.

| Separate result | Old → restarted tracking PID | Native exit | Observed outcome |
|---|---|---|---|
| original | 6778 → 7027 | 1 | automatic-restart-denied |
| triggered | 3084 → 3957 | 1 | automatic-restart-denied |
| control | 3003 → 4025 | 0 | foreground-observed-no-trigger |

Control is a fresh owned emulator, same exact APK/source/fingerprint receipts and full absence proof, no trigger command/marker or UI reattachment. Its foreground observation does not test GPS/session continuity or satisfy the original gate. Paired wrapper exit1 and original/triggered evidence hashes remain binding.

## Counterevidence and comparability

Triggered cleanup signature follows helper FOREGROUND (06:19:03.171 vs03.168), but this ordering alone does not establish its caller or cause. Run120 subsequently supplies pre-helper-logging counterevidence; do not generalize this ordering.

First services host bracket in control is 261.366645ms earlier; slot replay overshoot 0.083425ms. Dump duration differs by -50.629815ms. Timing equality is explicitly false. Raw timing receipt bytes/hashes/arithmetic are retained in control-result and role receipts. A future host-only deadline wait can reduce this first-dump difference, not make device event timing or causality equal.

Triggered TrackService scheduling is10000ms then memory-pressure107ms; control1000ms, no matching rescheduling line. Triggered pre-death token e60a006/count1/id19 becomes nonforeground with sixDENIED at a restarted-process snapshot, then is not printed; control token991688 remains foreground/count1/id19, including app=null in active/restarting listings and later new process.

All six before/after platform captures have native-success complete profiler dumps with terminal mForceBackgroundCheck and no printed AMS profiler fields. This does not exclude direct ART profiling or authorize start/stop. SET_ACTIVITY_WATCHER is granted to shell; ART APEX350820300 and candidate libart.so hash cf1c0b8e7fe7b9200a89bf30a076f44509c9a21fe18d7b33c63a48f673746cd1 are recorded, not executed/proven native profiling support. Profiling start is stateful, can stop/replace an existing profiler, write output and perturb timing; no profiling/atrace/Perfetto activation occurred.

Target fine/coarse and FGS/location-FGS permissions are granted in all six captures; no background-location declaration/grant appears, UID location AppOps remain foreground. Flags/timestamps and live AppOps activity differ; no whole-runtime equivalence inferred. All three exact services.jar captures remain SHA1d241dbf234d4773e80fc0d0fd137920bb4c5b1d1ce51b3ddf79d1afbc65a6c6 with matching three DEX/tool identities; raw disassembly hashes are independently verified, not assumed identical because filenames embed attempt paths.

## Preservation and verification

receipt.json records ZIP IDs, original lengths/digests/expiry, exact source, native exits and phase statuses. Every classifier input, observer raw/status/scope source, platform command stream/SDK metadata and framework archive/DEX/disassembly stream was independently rehashed against downloaded artifact bytes. The triggered guard's entire file list was independently rehashed after control. Selected raw lines carry original member paths, byte lengths, SHA256 and zero-based indices. Large raw logs/system dumps/JARs/disassembly stay in original artifact ZIPs, not substituted by these excerpts. Previous run evidence is additive and unchanged.

No permission, security/debug setting, app, signing, workflow, acceptance-gate, merge or release change. This archive is evidence only.
