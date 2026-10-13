# Deliberate history / durable-receipt composition

## Source and scope

Base: `fb48d501b2d2bb260808c622cccbe57699184afb`. Compose [PR #12](https://github.com/c933103/PassengerCount/pull/12) head `28c13494a143b0cca8ada3915087fe9007b12e1b` and [PR #10](https://github.com/c933103/PassengerCount/pull/10) head `153df48d5b3dc3f41a8fbc6ec342a9c0b4234d56` as ordered parents of one isolated draft. Neither producer branch is moved. Their earlier Code reviews apply to those individual heads, not automatically to this combination.

All 105 base, 120 PR #10 and 110 PR #12 leaf hashes/modes were verified before composing. The overlap is resolved explicitly:

- Keep PR #12's editable-only snapshots, live survey identity, evidence ledgers, occurrence references, lifecycle boundaries and keypad targeting.
- Keep PR #10's live upload receipts, upload-status refresh, durable checkpoint failures and coordinated record deletion. Normalize incoming history snapshots through the editable whitelist too, retaining the weather-change selection separately.
- Retain all parent test assertions. The VM fixtures load the additional production helpers required by the combination. All production Android/build files, the installed lifecycle script and workflow are byte-identical to PR #10. No runner, KVM, network or access settings changed.
- Retain both parents' README descriptions and all 31 previous packaged assets, plus PR #10's `record-deletion.js` (32 expected files). Refresh the service-worker cache name.

## Checks completed on the combined source

- `npm test`: **295/295 pass** (the parents' combined 292 plus three focused cross-feature regressions).
- `npm run test:native`: journal 97 assertions / 12 scenarios; session 26; export lifecycle 1,148; production export writer 928; deletion/service 232; separate-classloader target access 14. All pass using synthetic host files/framework fixtures.
- Source and browser-harness syntax checks pass. No parent assertion line was removed. The proof lists every inherited/source path and its hash/mode.
- New focused cases cover late GPS/native cursor/weather/ETA/calendar evidence while either upload response is pending, Undo/Redo, receipt identity and restart/no-repeat behavior; legacy/full snapshots retain live receipt, lifecycle and evidence state.
- A negative control replacing only the incoming snapshot whitelist with the unfiltered clone passes the two deferred-evidence cases but fails the snapshot-normalization case at retained receipt identity. This detects the unsafe naive composition.
- One inherited host test failed when its one-second wall-clock budget expired before the third poll. Its synthetic test clock now advances on the stubbed sleep, with a fixed five-poll bound. All original acceptance assertions remain; ten repeated full host-harness runs pass. The production 75-second installed observer is unchanged.

## Browser/APK and remaining acceptance

The combined actual-browser case additionally checks a confirmed receipt while late native evidence arrives after editing, Undo/Redo and cold restart. Both parent browser suites remain present. Local Chromium could not start because Unix socket creation returned EPERM; no browser test assertion ran locally. No local Android SDK is configured, so no local APK build is claimed. Hosted browser/APK validation and a fresh exact-head Code review are required.

The inherited API35 installed check remains a required failing/blocking check when `/dev/kvm` is unavailable or inaccessible. It has not been weakened, bypassed or permission-adjusted. An infrastructure preflight failure is not installed-device acceptance. API26, physical-device, power-loss and original-signer release verification remain separate. There is no backend idempotency/update contract, live-provider traffic, ready transition, merge or release publication in this work.

Evidence: [source/preservation proof](composition-proof.json), [expected packaged assets](expected-packaged-assets.json), [Node](node-tests.log), [native host](native-tests.log), [negative control](negative-control.log), [host clock stability](host-clock-stability.json), [local browser blocker](browser-local-blocker.log).
