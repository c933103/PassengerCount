# PassengerCount: project brief and kanban

Discussion and dated evidence: [project-board PR11](https://github.com/c933103/PassengerCount/pull/11).

Updated: 13 October 2026, 01:34 UTC / 09:34 UTC+08. Main: `ed0a10a8bd61f9be7348cf6e3b980013acdecad3` (PR13 merged). Earlier snapshots remain attributed in [PR11](https://github.com/c933103/PassengerCount/pull/11) and [PR13](https://github.com/c933103/PassengerCount/pull/13). Release 1.11 / code 12 remains held.

## Brief and product decisions
Provide a reliable Android/web bus passenger-survey workflow: set-and-forget recording, time-aware route variants, GPS suggestions with manual overrides, usable numeric input and table/map, correct onboard totals, pause/abort/resume, durable autosave, and last-stop Save & return home.

- Government route/timetable data and recorded survey snapshots remain distinct; refreshes must not rewrite observations.
- Preserve CSV/JSON/GPX/PNG export, configurable destinations, explicit deletion and honest uncertain-write feedback.
- Keep weather/fleet/holiday/ETA evidence and assumptions explicit. Independent time-zone handling and default yue-Hant-HK plus English remain requirements.
- Database upload preserves the original reference field contract. Richer local/exported evidence must not silently change that contract.
- Preserve original upgrade-signing identity, local survey continuity and version monotonicity. CI's temporary test signer is not the production update signer.
- Product behavior and device limits: [README](../README.md). Automated mocks/host checks do not establish actual storage-provider, background GPS or live-feed acceptance.

## Using this board
Move each card between Backlog, Ready, In progress, Blocked and Done as evidence changes. Keep its stable ID, next action and child/evidence link. Ready means ready for the stated next step, not permission to merge or release. Done requires exact-source acceptance and applicable integration/release checks. A historical green run, a source patch or a linked PR alone does not satisfy a wider requirement.

Repository Issues are disabled. This Markdown board is the durable repository tracker; its documentation PR provides discussion until integration. Preserve repository settings and visibility. Detailed PRs and evidence registers retain their own scope and acceptance criteria.

## Backlog
- [ ] **PC-DEVICE: physical Android field acceptance.** Next: record actual device results for precise/approximate/denied location, screen-off recording, weak-GPS/tunnels, live supported feeds, export folders/providers, permission denial/revocation, rotation and offline/force-stop recovery. Child checklist: [README validation/device section](../README.md#validation-and-device-checklist). No device pass is claimed.
- [ ] **PC-PRODUCT: reconcile remaining feature requirements.** Next: compare the requested field-survey workflow with current main and verified outcomes, and open a separate bounded correction PR for each supported gap. Product baseline: [README](../README.md); delivered feature records: [PR1](https://github.com/c933103/PassengerCount/pull/1), [PR2](https://github.com/c933103/PassengerCount/pull/2), [PR3](https://github.com/c933103/PassengerCount/pull/3). An existing implementation is not evidence that every real-device case is accepted.

## Ready
No release is declared ready by this tracker. The bounded PR13 composition and repair are merged and verified; remaining product, field-device and release checks retain their own scope.

## In progress
The composition repair is complete. Remaining product/device requirements below stay open; producer PR10/12 are retained and are not closed by this snapshot.

## Blocked
- [ ] **PC-RELEASE-1.11: publish a verified upgrade.** [Merged PR13](https://github.com/c933103/PassengerCount/pull/13) and [green main run 38332107783](https://github.com/c933103/PassengerCount/actions/runs/38332107783) satisfy the scoped current-source/API35 gate, **not** release approval. Next: verify the original signer and unchanged CI APK payload using the [private-machine release gate](../verification/releases/1.11-candidate-verification.md); confirm a same-signer, data-preserving update from delivered 1.10/code11 to 1.11/code12, including API26/Android 8–9 and field-device cases, then obtain explicit publication approval. Do not upload signing keys or treat CI's validation-signed APK as distributable. This gate is pending; previous-signer evidence is historical, not a signed 1.11 candidate. Restricted review details remain in the designated private record.

## Done
- [x] **PC-DURABILITY: bounded composition, installed validation and integration.** [PR13](https://github.com/c933103/PassengerCount/pull/13) preserves producer [PR10](https://github.com/c933103/PassengerCount/pull/10) durability/upload/deletion and [PR12](https://github.com/c933103/PassengerCount/pull/12) editable history/evidence. Merged as `ed0a10a8bd61f9be7348cf6e3b980013acdecad3` with accepted tree `2af449ab36a4d895ad2e8bcb2e323a596097d025`; current-head and ready-triggered reviews completed without new findings. [Actual post-merge run 38332107783](https://github.com/c933103/PassengerCount/actions/runs/38332107783) passed host/native/browser/APK and all ten API35 phases, including TOP→FGS/detachment, independent-process receipts, sticky restart and final stale-start/tombstone/no-resurrection checks. [Verified artifact/APK/source receipt](https://github.com/c933103/PassengerCount/pull/13#issuecomment-6136150691). Earlier failed cohorts remain preserved. This bounded acceptance does not establish explicit foreground delivery after location revocation, all-background-start, physical-device, power-loss, API26, live backend or original-signer acceptance. Those remain with PC-DEVICE/PC-RELEASE; producer PRs stay open.
- [x] **PC-EXPORT-1.10:** [PR3](https://github.com/c933103/PassengerCount/pull/3) merged at `1b7cb84c094bc4616d0255d4844cec80ed1accc8`; post-merge workflow passed and APK packaged assets matched accepted source. [Exact post-merge evidence](https://github.com/c933103/PassengerCount/blob/8b5c365cbe44f420bffc2cfe1ccecc3b4e0308a4/verification/pr3-post-merge-2026-10-10/README.md). This does not complete current 1.11 acceptance.
- [x] **PC-VERSION-1.11:** metadata-only [PR9](https://github.com/c933103/PassengerCount/pull/9) merged at `fb48d501b2d2bb260808c622cccbe57699184afb`, preparing version 1.11/code12. Post-merge workflow 38017782982 passed. Release publication remains Blocked.
- [x] **PC-001/002:** scoped recording lifecycle and repeated journal replay fixes integrated in [PR5](https://github.com/c933103/PassengerCount/pull/5) and [PR4](https://github.com/c933103/PassengerCount/pull/4); their PR evidence retains the native/host/browser coverage boundaries.
- [x] **PC-003/004/005:** scoped PNG identity, interrupted Android8–9 export feedback and missing-heading handling integrated in [PR6](https://github.com/c933103/PassengerCount/pull/6), [PR8](https://github.com/c933103/PassengerCount/pull/8) and [PR7](https://github.com/c933103/PassengerCount/pull/7). Broader physical-device and later integration findings remain separate.

## Maintenance
Keep source/CI/artifact/release states separate. Update the child PR evidence and this board before reconciling the private master. Public cards retain only ordinary project status and already-public behavior; credentials, restricted allegations and unrelated private data stay out of this repository.
