# Exact-head bounded recovery verification

Implementation/test head: `11d8dfd9cc396dcc99a6071a2820c032ec32e629`, tree `aa4f0341733ef02a99ccc2be902b36cfd30b5cbd`. [CI38727435153](https://github.com/c933103/PassengerCount/actions/runs/38727435153), job116396667377, completed successfully. Its tested merge `aaee6968899517801e5dfdfdbe984ebe2160d935` has the same tree. [Codex exact-head review](https://github.com/c933103/PassengerCount/pull/18#issuecomment-6191024716) completed with no major issues; no new inline finding was posted.

## Observed checks

- Hosted Node341/341, native host suites, browser workflow and both APK builds passed.
- All 13 API35 installed phases passed. Original detached-SIGKILL valid/tombstone controls ran before controlled denial/recovery. The deliberate policy denial used the real platform exception, saved its receipt, stopped without a crash, preserved prefix/generation, rejected background restart and later recovered with new GPS under visible foreground conditions.
- The installed target hash matches the downloaded validation APK. Both complete artifact ZIP digests were checked against their declared hashes; exact values are in artifact-sha256.txt. Validation ZIP includes signed PassengerCount.apk and aligned.apk; neither establishes original-signer upgrade/release provenance.
- Local focused/lifecycle99/99 passed. Independent deterministic property check: 1,500 permutations, 19,500 points, five offsets, nine fractional spellings through30 digits, four malformed forms. It verifies exact chronological valid-fix ordering, stable equal-instant journal ties, malformed slots/data, unchanged inputs and replay idempotence. BigInt is used only by the independent host oracle, not production. Both production files matched exact published blobs before this check.

Run the one-time property check with Node22: `PC_SOURCE_DIR=/path/to/checkout node property-track-order.mjs`. Checkout must be the stated head. This supplemental experiment does not alter or replace CI gates.

## Limits retained

The original natural API35 automatic-sticky-restart failure on CI38710322909 remains open. This passing sample does not resolve the source-backed process-absence race. The PR provides observable fail-safe recovery; release remains blocked. Physical/OEM/API26 service behavior, power-loss durability and original-signer acceptance remain unverified.

CI96/99 installed observation failures remain inconclusive; their ADB-offline outcomes are not relabeled. Earlier CI97/98 passing samples placed deliberate-denial phases first and changed timing exposure. CI100/101 and this run use corrected phase ordering; none disproves the original failure.

This deliberately minimal archive retains hashes, outcome summary and property-test source/result only. Runtime/process dumps, session-token fields and full artifact ZIPs are omitted. Full Actions artifacts expire2027-01-13; they are not durably mirrored here. No secret values or unrelated data are included, and earlier evidence/history is preserved.
