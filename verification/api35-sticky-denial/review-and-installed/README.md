# Review and installed follow-up (2026-10-15)

## Exact revisions

- CI96: run 38720711045, PR head f0d60502bfaae0c54fb4c7303a38c48aef5fde04. Installed observation failed with ADB offline before a denial marker; not a pass. ZIP artifact 11964752409 SHA256 49a7192884df96822ed450f08938aaa4202ff2218ca6a896d935fe410dc6222f.
- CI97: run 38721936383, PR head 7e2d468d1bb9c5681e3ce5666a09673c093f743d, tested merge 934357001c95b0d9f202876da74f57498ba110a7, identical source tree 39eacad1e0d27e82c3a4941095d7eabd437abe46.
- CI97 installed ZIP artifact 11965703232 SHA256 eba481ddc43a0b79b37e312ad1e5cd0b5f891f230bed93ac7939accd4e811cc7. Downloaded ZIP matches its declared digest.
- CI97 validation bundle artifact 11966108069 has declared SHA256 f0e15b35b47a670a7bc6389d0cbb95492322a3253c2ce18ef83698c5900374c4; this bundle was not independently downloaded here.
- Latest implementation head f9508faf202f7a13dbe235d415c8b669c43f8491 adds strict ISO/calendar boundary validation. Its local 93 focused/lifecycle tests passed; its hosted CI/review are separate and pending at archive creation.

This archive contains selected original phase receipts/log lines, not the full ZIPs or APKs. The original artifacts remain subject to Actions retention.

## Verified installed outcome on head 7e2d468d

CI passed Node333/333, native host suite, browser, both APK builds and all 13 installed phases. The controlled callback in PID 4085 logged a real ForegroundServiceStartNotAllowedException at 10:45:07.025, saved interruption evidence and stopped without process death. The same PID passed 11 verification assertions and12 recovery assertions: prior journal bytes retained, same durable generation, exactly one coordinate-free denial receipt, no background bridge restart, and new real GPS after visible recovery.

This controlled callback is not an automatic sticky restart. The subsequent unchanged natural valid and tombstone samples passed with PID transitions 4085→4780 and4780→4983. The earlier recorded process-absence race remains unresolved; these passing samples do not close that gate. No release/signing, physical/OEM/API26 or power-loss claim is made.

## Review dispositions

- Passive View started a denied service: confirmed by hosted browser failure. Fixed to reconcile without starting or stopping a live/interrupted native session, with paired controls.
- Permission result before onResume could strand a launch: corrected by retaining only an actually deferred Activity request and rechecking durable ownership/permission when resumed; cancellation/destruction/no-repeat controls execute production callbacks/start/resume and TrackSession.
- Malformed NaN point time could erase usable boundary state: corrected while retaining original point bytes.
- Latest alleged reconnection for parseable malformed strings 2027/2026-02-30: exact reproduction produced two segments in both cases, so that claim was not confirmed. Independently hardened boundary/display validation against inferred/normalized dates; valid timezone offsets, leap day and fractional seconds remain accepted and unchanged.

Implementation and exact-head review status: https://github.com/c933103/PassengerCount/pull/18
Original failure record: https://github.com/c933103/PassengerCount/pull/17#issuecomment-6189425602
CI96: https://github.com/c933103/PassengerCount/actions/runs/38720711045
CI97: https://github.com/c933103/PassengerCount/actions/runs/38721936383

