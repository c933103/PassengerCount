# Final PR3 correction verification

Verified on 2026-10-10 at 02:12 UTC.

- PR head: `f01e88f9f4033ac48625fc7182a9cf7682613698`
- Accepted and published source tree: `084d92eadd79bf1eaf503c30f8740ba6105b1830`
- Actual main: `2ac807eeef3a282f7570e495cfd21a5f50e814fe`
- GitHub synthetic merge: `719de0706bc108dca81966f7a68088f33aef29cd`, parents main then PR head, same source tree `084d92eadd79bf1eaf503c30f8740ba6105b1830`.
- PR validation [run 38015692374](https://github.com/c933103/PassengerCount/actions/runs/38015692374), job 114105314071, explicitly checked out synthetic merge 719de0706bc108dca81966f7a68088f33aef29cd. All steps succeeded.
- Push validation [run 38015689829](https://github.com/c933103/PassengerCount/actions/runs/38015689829) succeeded for the exact PR head.
- CI: 126 Node tests; TrackJournal 97 and TrackSession 26 assertions; lifecycle 1,148 assertions across 84 scenarios; actual production storage writer 928 assertions; all real-browser scenarios passed, including delayed PNG snapshot/navigation, repeated controls, failed acknowledged journal persistence, optional PNG absence, late results and uncertainty/retry behavior.
- Independent joined production-writer/lifecycle tests add 24 scenarios and pass 1,568 lifecycle assertions; previous c71 writer fails the behavioral oracle. See the neighboring review report and logs.
- Fresh [Codex review](https://github.com/c933103/PassengerCount/pull/3#issuecomment-6092554470) explicitly reviewed f01e88f9f4 and reported no major issues. The security-review row in the summary remains historical at a68174b; this receipt does not claim a new security review.
- Prior P2 thread PRRT_kwDOUbe-Vs6q_yiF was outdated but still unresolved at this check, with [fix reply](https://github.com/c933103/PassengerCount/pull/3#discussion_r4235962995). Root owns final resolution and merge.

## Artifact

Artifact 11655916503 from the PR run was downloaded and SHA-256 checked against GitHub: `52794b16affba9ffb9d1a95b44dd14527288d45f15d8ed93d4da4e45c8f2d68d`.
APK SHA-256: `44778bad7f182c7b411b796fa532f11aa1d62ad3339a4aea8e35df613a6b4f38`.
The binary Android manifest declares app.passengercount, version 1.10, versionCode 11. app.js, native-track.js, export.js, core.js, fieldkit.js and upload.js match the accepted source bytes. DEX contains the uncertainty exception and native failure mapper symbols. Official SDK apksigner verified APK signature schemes v2 and v3.

The signer is the in-job ephemeral validation signer, CN=PassengerCount validation, certificate SHA-256 cdb8a2dfb1fcdecbe7f1d8b34f98a1662baf768e8cd7f7954832c141993f31bf. This accepts the test APK only. No production key was supplied or created, no production signing/release is claimed, and no installed-device test is claimed.

This evidence branch preserves the PR source unchanged. No merge was performed by the implementation worker.
