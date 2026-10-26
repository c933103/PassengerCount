# Run117: current-head validation; full restart still failed

Current head `31d693bb821efbf97baaa4d21d5c30c20544a4a4`, tree `6fb112b74c989b274d343f7a135cb3c269543706`, has [clean exact-head Codex review](https://github.com/c933103/PassengerCount/pull/19#issuecomment-6408503405). Natural [run117 / 40270931898](https://github.com/c933103/PassengerCount/actions/runs/40270931898), attempt 1, is **FAILED**. Tested merge `705782a5bacbaceb1dc22a618c5b7b89447dc7bc` has the exact same tree.

Hosted Node **470/470**, native, browser, both Android builds and all original 13 lifecycle phases pass. The independent and service-only observations do not replace the full gate:

- Original full all-process absence **6699→6963**: automatic-restart-denied, exit **1**; interleaved=true, cleanupDuringAbsence=false.
- Independent full absence **2931→4104**: automatic-restart-denied, exit **1**; interleaved=true, cleanupDuringAbsence=true.

Both post-result static collectors completed with the same exact services.jar (21,446,452 bytes, SHA256 `1d241dbf234d4773e80fc0d0fd137920bb4c5b1d1ce51b3ddf79d1afbc65a6c6`) and all three DEX039 hashes as run116. All native commands completed 0, no disassembly stderr or clipping. All six disassembly bodies match run116 after excluding only the first two raw input-path header lines; original raw hashes/header bytes remain preserved. Four initial JDWP frames are complete-empty, bracketed by stable system_server PID 558/559. None of these diagnostic completions makes the original failure green.

The current source includes the reviewed genuine invalid-DEFLATE boundary repair. That corruption is covered by a real ZIP host regression; the actual installed archives here are valid. No app/manifest/workflow/permission/signing/debugger change, merge, release or APK restart-fix claim.

## Exact evidence

| Artifact | ZIP bytes | SHA256 |
|---|---:|---|
| Original12628183306 |91,648,364|aa00d0da5630582c9039cc2a8deb1bebe7d18f391a49423156873e07578d504e|
| Independent12628003695 |71,387,293|2ba53f4eb32b0d9abff7317ecf3f493ccd92c121c94c0eb6af81689c0ea676ab|

Original paired log `race-observation.GfrDnC/logcat.txt`: 12,123,136 bytes, SHA256 `73eecc86e4fa00743e0fbbb62d5e2a4c3091c9d7033efa5539775d131405984c`.
Independent paired log `race-observation.jSCSol/logcat.txt`: 7,097,353 bytes, SHA256 `0b0d37b6879b5f231618ab89e2dfd6cf488a3bd5481001eed0978a588812f02f`.

All classifier input bytes/hashes/native statuses and root-to-attempt pairing were independently verified. Framework manifests verify every recorded raw byte hash; platform capture arrays preserve all metadata member contents. Raw ZIPs remain in established workflow artifact storage with reported 2027-01-24 expiry; no retention/deletion change occurred.

Actual-binary analysis from run116 also applies to these matching DEX bytes. It narrows a foreground-app update/demotion route but does not establish an executed caller stack. The next meaningful read-only observation will enrich only the independent diagnostic's existing service-dump command slot to include ActiveForegroundApps, with original gates and full absence untouched; interpretation remains separate from acceptance.
