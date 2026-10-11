# Hosted composition acceptance, 2026-10-11

Source head: fb2bd183db2869ad0c0294aab3987521497bb7a1. Tested merge: 7a19ce7c44b9308915502537b7b13af3b8435dbe. Both use tree 3fe771a4f1d3c2c954238292f933568e2c96192d. This evidence-only archive does not move the reviewed source branch.

[PR #13](https://github.com/c933103/PassengerCount/pull/13) deliberately composes PR #12 and PR #10, preserving their heads as ordered parents and leaving both producer branches intact.

[Run 38131702284](https://github.com/c933103/PassengerCount/actions/runs/38131702284) passes 295 Node tests, journal/session/export/deletion/classloader host suites, the full browser suite, APK build and validation-signature verification, and instrumentation compilation/signature verification. Its overall result is failure: the unchanged installed-API35 KVM read/write preflight returns exit 2 before emulator creation or installed test execution. No KVM/network/access changes or retry were attempted. This does not distinguish absent hardware from inaccessible permissions.

[Fresh Code review](https://github.com/c933103/PassengerCount/pull/13#issuecomment-6108057258) reports no major issues on fb2bd183db. [Bot summary](https://github.com/c933103/PassengerCount/pull/13#issuecomment-6108034484) records completion at 10:25:51 UTC.

The [downloaded Actions artifact](https://github.com/c933103/PassengerCount/actions/runs/38131702284/artifacts/11698454424) is preserved byte-for-byte as lifecycle-evidence.zip: 2258 bytes; SHA-256 20415828f9403d8a6f873dedbe720f7b406592b29031d758954bee694ac8390e. Its six files include source/tree, production hashes, SDK list, blocker/exit status, and APK digests. ZIP digest matches GitHub metadata and the run upload log.

Recorded production APK SHA-256: 5903969ed40151f3ca553ef7291ed0dcb4cdd7a64912e547b4a52e8ad7e27b98. Instrumentation APK SHA-256: 0c725926fe51165842ff66cfc97937a71e3b7805326d3b447ab7e86f7b3d68b0. APK files were not uploaded after the installed preflight failed, so these are digest receipts, not independently downloaded APKs. The 32 expected asset hashes remain source-based, not an independent APK-byte comparison.

Still draft and unmerged. Installed API35, physical-device, API26, power-loss and original-signer release verification remain open. This test infrastructure blocker must be resolved through an authorized runner-access path before installed acceptance; no source workaround or gate suppression is proposed here.
