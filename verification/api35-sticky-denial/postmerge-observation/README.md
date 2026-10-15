# Natural postmerge installed observation failure

[PR18](https://github.com/c933103/PassengerCount/pull/18) merged as `77fcc7685ceb4652c6089c14360fc166ebbe778d` at2026-10-15 11:48:11 UTC. Main readback confirmed that revision; tree `aa4f0341733ef02a99ccc2be902b36cfd30b5cbd` exactly matches reviewed/tested head11d8dfd9cc396dcc99a6071a2820c032ec32e629. Premerge acceptance and its limits remain in the neighboring final-head archive.

Natural push [CI38729936933](https://github.com/c933103/PassengerCount/actions/runs/38729936933), job116404936303, ended **failure**. Hosted Node341/341, native suites, browser and both APK builds passed. Installed bootstrap passed6 assertions; the next command, launch_home's first `adb shell am start -W`, emitted its initial Starting line and exited255. No basics/restart/controlled-denial phase ran. Final service capture says `adb: device offline`. Installed postmerge behavior is therefore **unverified**, not a pass and not a reproduced service-restart failure.

The retained device log shows low-memory kills of unrelated system apps near the disconnect, but no evidence establishes that as the cause of ADB transport loss. The emulator shutdown messages occur in cleanup and do not independently prove a preceding emulator crash. No blind rerun, permission/policy change, added boot delay or gate relaxation was performed.

Artifact11969589038 complete ZIP was downloaded and verified: SHA256 `2b3c02dab98b6333f38b2d6329209f6cefb70238596fda7f00949400536bb77a`, 1,208,801 bytes. Source/APK hashes are retained here; the full ZIP and runtime/process/session data are not mirrored. Actions artifact expiration is2027-01-13. Build outputs reached the build checks, but the later validation-APK artifact upload was skipped after installed failure.

## Remaining outcomes

The observable fail-safe mitigation is merged and had exact-head premerge installed acceptance; natural postmerge installed acceptance is blocked by the recorded transport failure. The original automatic-sticky-restart defect on CI38710322909 remains independently open, and release remains blocked. No platform-valid automatic-restart remedy, original-signer upgrade, physical/OEM/API26 behavior or release approval is established.

A next bounded diagnostic step would capture host ADB transport/process state and exact command stderr at failure, while retaining fail-closed gates and their current timing. That is a proposal, not a completed diagnosis or permission to rerun until green.
