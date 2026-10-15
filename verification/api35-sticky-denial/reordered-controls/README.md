# Reordered controls: inconclusive API35 observation and precision correction

Source/test head for CI99: `996102f6d6004baed6d3e7af644b19274fbe01e5`; tested merge `29a2f2522596320103e333572098d7e11a52c830`, tree `aec5bc60b7c19897f08c6a228a8e7a382f07be68`. [CI38724427235](https://github.com/c933103/PassengerCount/actions/runs/38724427235), job116386646526. Hosted Node/native/browser and both APK builds passed. Installed API35 checks passed seven phases through prepare-valid and confirmed detached/background state. ADB observation exited255 before the scheduled SIGKILL; retained final service dump says `adb: device offline`, and no SIGKILL marker exists in retained logs. Automatic restart, tombstone and subsequent controlled recovery remain unverified on this sample. This is not evidence for either a platform-restart pass or reproduced platform failure.

Artifact11968475452 was downloaded and its complete ZIP verified as SHA256 `cb39e730a7af0d234702ff3f852b5a19ce832a5271723813981f68eebb9b20a5` (1,311,893 bytes). This directory retains only source/APK hashes, outcome summary and focused test results, not runtime/process files or the complete ZIP/log archive. Actions expiration is 2027-01-13.

Controlled-denial phases now follow the original valid/tombstone sequence. A one-time comparison confirms the executable sequence through verify-deleted matches main; an ordering test protects the placement. Earlier passing CI97/98 deliberately demoted the service before sticky controls, adding about30 seconds, so their race exposure is limited. The original CI38710322909 failure and release hold remain open.

## Precision correction

Codex finding4282186592 reproduced on head996102f6: fractional points .5001234566/.5001234568 around observation .5001234567 exported one segment due to millisecond truncation. Head `76dcaf4b0a8bf8b2d54f36150f065b8d91e3e768` (tree `df323b9869f10e28007574bd7e1bc48653fd6163`) normalizes only the whole second/offset and compares fractional decimal text exactly after removing insignificant trailing zeros. It uses no BigInt/new WebView facility, preserves original points/metadata and keeps malformed-date negatives. Local focused/lifecycle96/96 passed; exact input hashes and full focused result are retained here. New-head hosted CI38725286496 and review were pending at this archive revision. Do not transfer CI99 or earlier installed results to the new source tree.

## Publication limit

The original proposed archive publication was denied because runtime/process receipts included a live-looking tracking session token and runtime data. No commit or ref changed from that denied call. This safer minimal archive omits those files and all session tokens/secret-like values; it does not classify the rejected value as a proven credential or noncredential.
