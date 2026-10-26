# Run116: exact installed framework DEX obtained; full restart still denied

Natural [run116 / 40270319226](https://github.com/c933103/PassengerCount/actions/runs/40270319226), attempt 1, is **FAILED**. Tested head `142fcaf81a37b198aa9c90f7ce0dd271942c0396`; merge `8e17a36c894b16ea5acd262693a78e509183acbf` has the same tree `44328ab7f85f2e51e74b58856b878b5db977957b`.

## Executed route, not an AOSP-build prerequisite

Both original and independent post-result captures successfully read the exact installed `/system/framework/services.jar` and disassembled all **three DEX039 files** using the existing SDK Build Tools 35.0.0 `dexdump`. Every native command completed 0. Pull progress stderr was preserved; hash/disassembly stderr was empty. Device-before/device-after/local JAR hashes agree, both emulators yielded identical JAR/DEX bytes, and no output was clipped. Outer collector status 0 is only static evidence completion, not restart acceptance.

- JAR: **21,446,452 bytes**, SHA256 `1d241dbf234d4773e80fc0d0fd137920bb4c5b1d1ce51b3ddf79d1afbc65a6c6`.
- `classes.dex`: 9,848,536 bytes, SHA256 `51c668be9387f76e46eec3c5fdaaa1b544f9e76ff14ec7b9983f021c0dafcb85`.
- `classes2.dex`: 9,084,864 bytes, SHA256 `5f49d723b85f83ec734bf4f28764c6d015f47aecceb8f36c0f0f12a84d5a697a`.
- `classes3.dex`: 2,408,764 bytes, SHA256 `318fb48b46c030bc6b2255712e8ef5bbe0eec6ec51c672aa8d0d32a8808ab1d9`.
- SDK dexdump: 3,620,016 bytes, SHA256 `ef273cb9e5a01ccbba046ea7c80d73203f0c908d2779b4c58e21091753c86049`.

The three raw disassemblies total about 361 MB per capture. Their raw hashes are retained individually. After excluding exactly the first two input-path header lines, each original/independent disassembly body matches byte-for-byte by SHA256; input-path differences are not erased from the raw evidence. `framework-capture-manifest.json` binds every framework member's bytes/hash, all command statuses, tool metadata and the full structured receipts. Full raw ZIPs remain in the linked established workflow artifact storage, with the reported 2027-01-24 expiry; no deletion/retention change occurred.

This was read-only target capture and host static analysis, after the original terminal status. No debugger attachment, debug/security setting change, permissions expansion, app/manifest/workflow change or full AOSP provisioning occurred.

## Binding acceptance

Hosted Node **470/470**, native, browser, both Android builds and all original 13 lifecycle phases passed. IPC/UI-death and the separate service-only sequence also passed; these do not satisfy full absence.

- Original full all-process-absence restart **6822→7097**: `automatic-restart-denied`, exit **1**, interleaved=true, cleanupDuringAbsence=false.
- Independent full-absence diagnostic **3062→4038**: same denial, exit **1**, interleaved=true, cleanupDuringAbsence=true.

The source/test correction for Codex's independently reproduced invalid-DEFLATE receipt-loss finding is the later head `31d693bb821efbf97baaa4d21d5c30c20544a4a4`, not the source tested here. [Finding](https://github.com/c933103/PassengerCount/pull/19#discussion_r4374018363) · [corrected-head review](https://github.com/c933103/PassengerCount/pull/19#issuecomment-6408503405). Run116's actual archives are valid and completed; the newly covered corrupt-archive boundary does not relabel this failed gate.

## Failure provenance

| Artifact | ZIP bytes | SHA256 |
|---|---:|---|
| Original12628766327 |92,700,042|1189b449a1a9d06059546a9935f0fa03e8bb43d82f686a990a15d7e8f15cf0ee|
| Independent12628861107 |69,331,333|05eecf360845dce16e4bae6138c2b05c41f91befdda407a870b02fd8d15c22d0|

Original classified log `race-observation.cr71Bp/logcat.txt`: 11,727,049 bytes, SHA256 `1da3dd591903f09a26fa65acc0f874817323f162a48037f96ec69302d1748d59`.
Independent classified log `race-observation.LuCjFL/logcat.txt`: 6,753,827 bytes, SHA256 `51969376294a0b5b6b0292d9f3ad28c85d162639155a816a309fd8b89738cad6`.

Every paired classifier log/service input was independently checked against its recorded bytes/hash/native status; root results match their named attempts. All raw platform metadata members are retained in the compact capture arrays. Earlier failure evidence remains unchanged.

## Next technical action

Analyze restriction-field writes and reset caller/control-flow sites in these actual DEX files, including death/detachment, foreground demotion and restart scheduling. This now uses the tested binary, not an assumed match to public r1. Static candidate sites/branches cannot establish the executed caller stack, exact interleaving or runtime cause. The original full-restart task remains open and unmerged; no APK restart fix is claimed.
