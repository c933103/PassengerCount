# Run118 — real framework bookkeeping observed; full restart still fails

[Hosted run118](https://github.com/c933103/PassengerCount/actions/runs/40273911376), attempt1, is **FAILED**. Head `c80f6008cc3512e986ae2c40461da3286992d511`; tested merge `da0a060fc343cfaca3cbad367edf7de30a465ce1` has the same tree `5a8f9531e0ea7c972873f4f60bb53ccd6e9b61d1`. [Exact-head Codex review is clean](https://github.com/c933103/PassengerCount/pull/19#issuecomment-6408907584).

- Hosted Node **486/486**, native suite, browser checks, both APK builds and all original13 lifecycle phases passed. Service-only restart6153→6686 passed with the separate UI alive.
- Original full all-package-process-absence restart **6686→6934** was denied, exit **1**. Interleaved=true; no cleanup signature observed in that sample.
- Independent fresh diagnostic **3059→3964** was denied, exit **1**. Interleaved=true; target AppOps finish warning occurred during absence after helper promotion. The warning is not itself a reset call-stack trace.
- Independent full-services observation completed separately, exit **0**, with a fresh atomically published summary. That completion cannot turn either restart failure green.

## New actual-platform evidence

Before death, exact user0 PassengerCount map entry had `mNumActive=1`, `mAppOnTop=false`, with no printed end time. The warmed helper package was not listed. TrackService token `d5f580` was foreground LOCATION, count1, TOP no-binding reasons.

Two later snapshots retain the same sticky/pending service token with `app=null`, count1 and notification ID19, but nonforeground/type0 and all six reasons DENIED. The target map entry is not printed; the helper package now has an active entry. The final snapshot no longer lists the target service after the recorded restart denial. Missing dump entries are not proof of UID/process absence; the original strict absence check and raw death/UID logs supply separate evidence.

All four full dumps have no printed Handler/queued `what=2` section. This cannot exclude work already dispatched. The helper absent-before/present-after state supports the installed new-entry enqueue prerequisite, not proof of the executed branch or caller. Other known callers converge on the same demotion writes.

Exact log-prefix comparisons prove attempt order `kqpePd → De6EOw → mo4kMN`, independent of directory names. Memory-pressure events changed the scheduled restart from30000ms to8975ms and then0ms. This is a real confound for any subsequent no-trigger comparison; no causal claim should silently assume an identical restart window. See [source-bound observation analysis](foreground-observation-analysis.md) and [raw/status/hash-bound excerpts](foreground-observation-evidence.json).

## Byte verification and retention

Both complete artifact ZIPs were downloaded through the supported artifact connector and matched GitHub byte count/SHA256:

| Role | Artifact | Bytes | SHA256 |
|---|---:|---:|---|
| Original | 12629821306 | 90804437 | `c067762193312cf822ff43205ccecc8e4e8e0f375dbecc325d2bea06bb4ff13c` |
| Independent | 12630165446 | 69642362 | `59ae1452028a588362ff179fd9d40806594b0617e2794184758b8b00be1bb8ad` |

Original final log11245063bytes SHA256 `e46d7b4519f1851ac1376d213ac4a5a3a95e6a166a35e8080453413b6d7929e4`; independent final log6889164bytes SHA256 `302d85883651702541ebdc6ffd8fffb240d9948e95a01923de0f8dc6b1cbedb2`. All complete classifier log/services input hashes, native capture statuses and paired result pointers were verified. All16 observer stdout/stderr/status/scope files match their recorded hashes and exact ZIP bytes; fresh observer report and root match byte-for-byte.

Both exact-framework collectors completed, native0. Every recorded framework archive/DEX/disassembly/command stream hash was independently rechecked. Both services.jar files remain21446452bytes SHA256 `1d241dbf234d4773e80fc0d0fd137920bb4c5b1d1ce51b3ddf79d1afbc65a6c6`; all three DEX files and SDK35 tool identity match the prior installed analysis. All four JDWP initial frames are complete-empty `0000` snapshots, not global debugger impossibility or policy denial.

Full ZIPs, original logs and full unfiltered service dumps remain in established GitHub artifact storage, recorded expiry2027-01-24; no retention setting changed. This evidence ref retains compact metadata, exact relevant raw excerpts, input identities and failures, not a claim that every bulk artifact byte is committed permanently. Prior run111–117 archives are preserved unchanged.

## Next executable contrast

Implement a bounded additional fresh-emulator no-trigger observation alongside the independent triggered result, keeping identical APK/image/permissions/warm-up/full absence and dump sequence as far as measured timing permits. Record host slot timing, actual memory-pressure/rescheduling events and any unmatched window explicitly. Original full triggered gate and its exit remain binding; a control observation is not an APK acceptance result. A failure without TRIGGER would show the extra stimulus is unnecessary, not rule out naturally queued updates. A differing result in one pair does not prove a unique caller or universal recovery.

No app/permission/signing/security-setting/debugger change, merge, release or acceptance waiver occurred.
