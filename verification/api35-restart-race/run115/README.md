# Run115: complete framed JDWP snapshots; full restart still denied

Natural pull-request run [40268169329](https://github.com/c933103/PassengerCount/actions/runs/40268169329), attempt1, is **FAILED**. Head `9586a9125ad21abed97dfd7a2e6433779ae5b7ee`; tested merge `0750dec74d72a7ba4fe0e2fe6dd3b51fdd77ddf3` has the identical tree `dd61212fdfade7050da544d70c679a332dd7d930`. [Exact-head Codex review](https://github.com/c933103/PassengerCount/pull/19#issuecomment-6408140501) reports no major issues.

## Actual initial-frame outcome

All four before/after captures, on the original and independent disposable emulator, returned exactly four bytes `0000`: SHA256 `9af15b336e6a9619928537df30b2e6a2376569fcf9d7e773eccede65606529a0`. This is a protocol-complete empty initial registry snapshot, not a timeout. Each had empty stderr, stable bracketed system_server PID (555 original;556 independent), no output truncation and no cleanup errors. The local tracker was intentionally terminated only after its complete frame; actual native return `-15` remains recorded separately. Each metadata collector exited0.

**No JDWP process was advertised at these four snapshots.** This is not permanent/global absence, a debugging-policy denial, proof of attach permissions, or a full-restart acceptance result. No debugger attachment or debug/security/permission changes occurred.

The image remains Google API35 revision9 / extension13, fingerprint `google/sdk_gphone64_x86_64/emu64xa:15/AE3A.240806.043/12960925:userdebug/dev-keys`. The JDWP property remained unset and the same services.jar/framework.jar hashes were observed. Package permissions and foreground-only location app-ops were not broadened.

## Binding acceptance and regression results

- Hosted Node454/454, native, browser, both Android builds and all original13 lifecycle phases passed. IPC/UI-death and service-only restart6161→6674 also passed; a surviving UI process makes that service-only result **not** the original full-absence acceptance.
- Original full all-process-absence restart6674→6910: `automatic-restart-denied`, exit1; interleaved=true, cleanupDuringAbsence=false.
- Independent full-absence diagnostic2938→3666: `automatic-restart-denied`, exit1; interleaved=true, cleanupDuringAbsence=true.
- Original/independent failure statuses are unchanged by metadata success. No APK restart fix, merge or release is claimed.

## Byte-bound evidence

`receipt.json` contains artifact identities/digests, source and command outcomes. All archived per-attempt classifier inputs have verified exact bytes/SHA256, successful capture statuses and empty stderr. Root classifier results match their named attempt results. The `*-platform-captures.json` arrays retain every metadata member's original UTF-8 bytes, archive path, byte count and hash, including raw frame bytes, command timestamps/native statuses and SDK metadata. Earlier failure archives remain unchanged.

| Artifact | ZIP bytes | SHA256 |
|---|---:|---|
| Original12627777016 |26812693|728e7e682b559377d35985fbbf4d7e846cb908fe8a7af63c41c7c09b2ce70143|
| Independent12627363361 |5499742|e4ebd72b9d1ef793bda65f2201055d22a4877e8820d09a84e6d6c8a0391cde14|

Original classified log `race-observation.SgAHzF/logcat.txt`:12031315 bytes, SHA256 `0323b76af0d9406d3345099c7504c2e0ddacfbc262a16bdd5b425969e4e615c1`.
Independent classified log `race-observation.0GFLNV/logcat.txt`:6029140 bytes, SHA256 `036a13a6001e34e9514c210fb74b4f29c52daa785406e3c4f7d23f6d99de28ab`.

## Concrete next permitted investigation

Capture exact `/system/framework/services.jar` read-only after the original result has been saved, bind device-before/device-after/local hashes, then validate its actual ZIP/DEX entries and disassemble with the already-present SDK35 `dexdump` if available. No full AOSP build is required for this bounded static step. API35 Soong's install rules justify expecting DEX-bearing JARs, but actual bytes must establish that; VDEX is not assumed to contain a fallback DEX section.

Analyze restriction-field writes and caller references in the tested binary across every DEX, including death/detachment, demotion and sticky-restart scheduling. This closes the exact-binary/source gap left by a public r1 audit. Static candidate call sites/control-flow are **not** an executed caller stack, observed interleaving or proven runtime cause. The remaining runtime transition/order question remains explicit; no permission expansion or weakened full-absence gate is proposed.
