# Working in PassengerCount

Read [README.md](README.md) for behavior, build and device checks and [the validation workflow](.github/workflows/v19-validate.yml) for the checks on the branch being changed. Existing acceptance holds, signing requirements and release decisions remain in force.

## Keep changes and evidence focused

- Define one finishable outcome, its affected behavior and observable acceptance checks. Keep implementation, meaningful regressions and compact failure fixtures together; split unrelated audits or archive work.
- Keep bulky run logs, captures, APKs and duplicate source dumps on durable evidence refs or established artifact storage. In the implementation PR, retain one compact receipt: exact source and test revision, environment, command/run, outcomes, failures, untested scope, artifact hashes where bytes matter, and immutable archive links.
- Preserve existing archives, retention commitments and recovery paths. Inspect consumers, licensing and packaging before moving anything; verify the archived bytes and accessibility first. This guidance authorizes no deletion, expiry or history rewrite.
- Test current behavior, data integrity and compatibility directly. Do not add permanent historical-source hash gates, recursive inverse adapters or full-tree reconstruction as ordinary CI. A one-time migration comparison is distinct from a lasting product contract.
- Match acceptance to the requirement and risk. Preserve negative controls and the original failure; never silently weaken assertions, skip required checks or relabel failed aggregates as passed. A reviewed replacement is required before retiring an existing gate.
- Require applicable current-head CI and risk-focused review before an authorized merge; re-review affected fixes and integrations. Record published, tested, reviewed, merged and released separately. Missing, blocked, cancelled and failed checks remain distinct.
- Keep public records standalone and free of credentials, secrets, private tracker links and unrelated private data. Use the designated private reporting channel for sensitive security findings.

## PassengerCount contracts and verification

- Preserve survey identity, recorded observations, stop occurrences, timestamps, track evidence, upload receipts and lifecycle boundaries. Editing, Undo/Redo, deletion, restart and failed storage/export operations need behavioral regressions, including recovery and failure cases.
- Keep government catalogue inputs, attribution, vendor licenses and compact offline fixtures with their consumers. Product data is not disposable run evidence. Use mocked/offline transport for routine tests; do not exercise live uploads or provider traffic without authorization.
- Use the applicable Node, native host, browser and Android checks in the current branch. Host shims and mocked browser transport do not establish installed-device behavior; validation signatures do not establish original-signer upgrade or release acceptance.
- `android/build.sh` explicitly copies web assets plus `vendor/` and `data/`; root guidance and verification archives are not selected by that list. `sw.js` also has an explicit precache list. Reinspect both on the actual working branch before changing packaged content.
- For documentation-only work, inspect the diff and links and confirm that executable, generated and packaged inputs remain unchanged. Root documentation still appears in Git source archives. If any shipped or corresponding-source bundle inputs change, regenerate and bind the new artifact to the final source; never reuse an old bundle hash.
- Instruction adoption alone does not migrate active PR archives or satisfy their installed-device, integration, signing or release gates.
