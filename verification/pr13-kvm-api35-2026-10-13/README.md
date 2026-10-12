# PR #13 — accelerated API35 installed acceptance

## Root cause and runner configuration

Run [38131702284](https://github.com/c933103/PassengerCount/actions/runs/38131702284) executed the host tests, production APK build and instrumentation compilation on GitHub-hosted Ubuntu 24.04.5. The existing installed runner refused at its unchanged `/dev/kvm` read/write check (exit 2), before emulator creation. The prior log does not prove whether the KVM character device was absent or just inaccessible.

GitHub documents accelerated Android SDK tools on GitHub-hosted Linux runners and the need to grant KVM access: [GitHub Linux runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners), [GitHub's Android virtualization announcement](https://github.blog/changelog/2024-04-02-github-actions-hardware-accelerated-android-virtualization-now-available/). The pinned runner is `ubuntu-24.04` (x64, full hosted VM; **not** `ubuntu-slim`). Ubuntu's hosted image lists `acl` as installed.

Immediately before the required installed stage, the workflow writes `kvm-access.txt` into the always-uploaded `PassengerCount-API35-lifecycle-*` evidence artifact. It classifies missing device vs unsupported runner vs denied permissions; if the genuine character device exists but is inaccessible, it grants **only the ephemeral job user** an ACL using `sudo -n setfacl -m u:<user>:rw /dev/kvm`. It never globally changes modes, changes udev rules, manufactures a KVM device or uses software emulation. The original `test-android-installed.sh` `-r && -w` preflight and `emulator -accel-check` remain mandatory.

## Additional installed test assertions

The existing production APK, signed test APK, native foreground-service lifecycle, real GPS callbacks, SIGKILL-and-system-restart and native deletion tests remain present. Three new required, cold-process instrumentation phases (`receipts-prepare`, `receipts-recover`, `receipts-final`) exercise production `storage.js`, the exact JNI/Android storage bridge and the production `record-deletion.js` coordinator using *synthetic local receipt state*. They verify immutable completed-upload identity, persistence across edits, an unconfirmed receipt remaining uncertain, exact deletion of a selected journal and preservation of the unrelated completed receipt across **two actual Android process restarts**. No live network or backend write is attempted or claimed. These phases do not claim to test full interactive UI Undo/Redo or a real server upload, which are separately exercised by host/browser tests.

## Acceptance rule

A successful build, 295 Node tests and hosted browser checks do **not** substitute for installed API35 results. Require observed `PHASE_PASS` and `INSTRUMENTATION_CODE: -1` for **all** phases, genuine API35 fingerprint/SDK, acceleration evidence, native traces and overall green workflow on the updated PR head. Classify KVM prerequisite failure as runner environment, instrumentation exceptions as app/test defects, and remain draft/unmerged until validated. API26, physical device, power loss, original production signer and server idempotency are not covered.

## Reproduction

Push the current PR branch; trigger `Validate Android v1.11` via normal pull-request CI on Ubuntu 24.04. Evidence is uploaded by `Preserve installed lifecycle evidence` even if KVM access fails. Do not ignore the preflight or promote APK artifacts from failed runs.
