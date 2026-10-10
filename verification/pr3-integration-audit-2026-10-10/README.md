# PassengerCount PR3 integration audit, 10 October 2026

Exact older head:b9fe113aed0a1c6786b7aa5aeb5e9ce1389ae0d5. Exact current main:2ac807eeef3a282f7570e495cfd21a5f50e814fe. This evidence-only branch makes no app change.

## Passenger3 integration plan and reproduced risks

Current main retains PC001 recording-lifecycle, PC002 journal acknowledgement/replay, PC003 asynchronous PNG identity, PC004 export observer/permission/uncertain-completion and PC005 missing-GPS-heading fixes. All are mandatory preservation scope.

The18-file original feature diff is genuinely absent: reference-only upload payload, tabular CSV, structured JSON/GPX, native per-trip folders, bundle browser bridge, version1.10/code11 and aligned APK output.

A merge-tree against main2ac807e has four textual conflicts: `.github/workflows/v19-validate.yml`, `README.md`, `android/build.sh`, `app.js`. Resolve by composition: retain current native tests/triggers/lifecycle docs and native-track.js packaging, add export.js packaging and1.10 aligned artifact output, preserve all current service-worker assets and bump the cache version from currentv16 once. Keep old main's fixes in the auto-merged MainActivity, fieldkit and tests too; lack of a text conflict is not validation.

The actual old `download()` handler was executed in a controlled Node VM and reproduced:

1. syncNativeTrack returning false still enqueues saveBundle.
2. Mutating the selected survey while PNG decode awaits produces new survey identity/data with the already-captured old chart.
3. The CSV control is re-enabled in finally immediately after native enqueue, before result settlement.

Run `node verification/pr3-integration-audit-2026-10-10/reproduce-bundle.cjs` from this branch. The verifier reads the exact old app.js commit through Git and exercises its actual download handler with controlled journal/PNG/native-bridge doubles. It makes no network requests, uploads or file exports. These are host handler reproductions, not installed-device incidents.

Fix with acknowledged drain before snapshot, immutable survey/metadata/base/time snapshot before the first await, shared current chart/native pending gates through settlement, and native saveBundle through current queueExport/ExportSession. Preserve standalone PNG identity behavior. Update CSV-only export-permission browser expectations to folder results. Add delayed decode/navigation/mutation, failed drain, optional PNG failure, repeated activation, pending native completion, interrupted permission, late result, uncertain outcome and explicit retry tests. Retain the two existing review fixes for configured start and null GPX measurements.

Current-main baseline rerun:102 Node tests passed; native TrackJournal97, TrackSession26, export lifecycle1028 assertions across76 scenarios passed. New integrated-head `npm test`, `npm run test:native`, full Playwright, Android compilation and APK signature checks are required. Installed SAF/MediaStore/legacy filesystem bundle behavior and production signing remain distinct from simulated bridge/host tests and validation signing.

## Existing PR and CI

[PR3](https://github.com/c933103/PassengerCount/pull/3) remains unmerged. Its two old review findings were fixed and resolved at the old head:configured survey-start identity and omission of unknown GPX measurements. Preserve both during integration.

[Exact old-head push run35834424505](https://github.com/c933103/PassengerCount/actions/runs/35834424505) completed successfully on23 September. That run predates current lifecycle/export fixes. New integrated-head checks are required. The convenience workflow query excludes push-triggered runs; an empty result there is not evidence of missing CI.
