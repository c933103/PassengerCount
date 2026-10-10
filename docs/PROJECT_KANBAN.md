# PassengerCount: project brief and kanban

Parent: [private cross-project master](https://github.com/c933103/something-priv-maybe/issues/1) (access restricted).

Discussion and dated evidence: [project-board PR11](https://github.com/c933103/PassengerCount/pull/11).

Updated: 10 October 2026, 05:05 UTC / 13:05 UTC+08. Main: `fb48d501b2d2bb260808c622cccbe57699184afb`. Release 1.11 / code 12 remains held.

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
No additional source change is declared ready by this tracker. The immediate next steps are the current candidate's runner prerequisite, installed validation and review/release acceptance below.

## In progress
The installed-validation candidate is blocked below; runner-prerequisite proposal work remains tracked privately.

## Blocked
- [ ] **PC-DURABILITY: complete installed validation and current review.** [Draft PR10](https://github.com/c933103/PassengerCount/pull/10), exact head `153df48d5b3dc3f41a8fbc6ec342a9c0b4234d56`, tree `4353a60633aa8e526a797ccada9ee16e5d3fcc92`, remains based on main `fb48d501`. Production Java, manifest and application modules are unchanged from validated `ac6c8237`; the newer changes are the test-only harness. [Run 38024845688 and exact receipt](https://github.com/c933103/PassengerCount/pull/10#issuecomment-6093877056) passed 263 Node tests, native host regressions, browser checks, production APK build and test-instrumentation compilation. The installed API35 step stopped at the existing-access KVM preflight before emulator creation or any test phase; the run is failed/blocked, not an installed pass. The check does not distinguish a missing device from inaccessible permissions. Next: establish an approved, supported runner prerequisite, verify all exact-head installed phases and obtain acceptable current-head review; Codex review remains quota-blocked. No permission change, live backend test or release is claimed. Physical-device, power-loss, API26 and original-signer acceptance remain separate.
- [ ] **PC-RELEASE-1.11: publish a verified upgrade.** Next: accept and integrate required corrections, verify exact merged-source CI and packaged assets, rebuild with the original signing identity, check package/version/source/signature, then complete authorized publication. Dependencies: [PR10](https://github.com/c933103/PassengerCount/pull/10); version preparation: [PR9](https://github.com/c933103/PassengerCount/pull/9). The earlier original-signer candidate is historical preparation and does not establish release publication. Restricted review details remain in the designated private record.

## Done
- [x] **PC-EXPORT-1.10:** [PR3](https://github.com/c933103/PassengerCount/pull/3) merged at `1b7cb84c094bc4616d0255d4844cec80ed1accc8`; post-merge workflow passed and APK packaged assets matched accepted source. [Exact post-merge evidence](https://github.com/c933103/PassengerCount/blob/8b5c365cbe44f420bffc2cfe1ccecc3b4e0308a4/verification/pr3-post-merge-2026-10-10/README.md). This does not complete current 1.11 acceptance.
- [x] **PC-VERSION-1.11:** metadata-only [PR9](https://github.com/c933103/PassengerCount/pull/9) merged at `fb48d501b2d2bb260808c622cccbe57699184afb`, preparing version 1.11/code12. Post-merge workflow 38017782982 passed. Release publication remains Blocked.
- [x] **PC-001/002:** scoped recording lifecycle and repeated journal replay fixes integrated in [PR5](https://github.com/c933103/PassengerCount/pull/5) and [PR4](https://github.com/c933103/PassengerCount/pull/4); their PR evidence retains the native/host/browser coverage boundaries.
- [x] **PC-003/004/005:** scoped PNG identity, interrupted Android8–9 export feedback and missing-heading handling integrated in [PR6](https://github.com/c933103/PassengerCount/pull/6), [PR8](https://github.com/c933103/PassengerCount/pull/8) and [PR7](https://github.com/c933103/PassengerCount/pull/7). Broader physical-device and later integration findings remain separate.

## Maintenance
Keep source/CI/artifact/release states separate. Update the child PR evidence and this board before reconciling the private master. Public cards retain only ordinary project status and already-public behavior; credentials, restricted allegations and unrelated private data stay out of this repository.
