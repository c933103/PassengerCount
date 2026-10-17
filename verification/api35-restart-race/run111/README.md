# Run111: installed separate-process resilience established; full restart gate fails

Exact implementation head: `052fbb20ed7edd6f849681bf60e2862176b40aaf`.
[Hosted run](https://github.com/c933103/PassengerCount/actions/runs/39013057272),
job `117339471185`, completed **failure**. The unchanged original job remains
binding. No merge or release is accepted by this receipt.

## Installed results

- All thirteen original lifecycle phases passed, including ordinary detached
  service-only sticky restart, deleted-session stop, journal/receipt recovery,
  and controlled-denial preservation/visible recovery.
- Actual UI-process private IPC basics passed 23 assertions. A remote Binder
  deletion waited behind an accepted append/fsync, then acknowledged durable
  deletion; 16 drain assertions passed. Page size includes JSON/nativeId overhead.
- Actual provider death while remote deletion awaited acknowledgement left the
  UI alive and returned failure/unknown without replay; 15 assertions passed.
  Death specifically after a durable start/stop but before its reply is covered
  by host fault-injection controls, not claimed as a separate installed sample.
- A deliberately unread reliable pipe blocked the owner journal barrier. UI-only
  death released it. Tracker PID 6144 survived unchanged and real GPS appended
  before verification reattached; 9 verification assertions passed.
- Controlled **service-only** death: UI PID 6449 survived in the background,
  tracker 6144 died, the independent test-package FGS entered foreground during
  the restart gap, and ActivityManager automatically restarted tracker 6660.
  The foreground snapshot retained TOP eligibility. Reattached verification
  passed 14 assertions, including real GPS and session/journal continuity.
  Foreground restoration was proved before reattachment; this case does not
  separately establish pre-reattachment GPS delivery.
- Controlled **all-package-process absence**: both normal app processes died,
  strict PID/AMS absence checks passed before the helper transition, and automatic
  tracker 6660 to 6897 restart was denied with
  `ForegroundServiceStartNotAllowedException`. Both start and while-in-use checks
  reported denial. This failed the original installed step with exit 1.

The helper interleaving was measured in both scope comparisons. Neither run111
sample logged the separate START_FOREGROUND cleanup signature, so its classifier
has `cleanupDuringAbsence=false` and `reset=-1`. Do not claim a directly observed
cleanup in this run. Earlier run104/105/107/109/110 traces remain available and
support the source-level eligibility-reset hypothesis; no system_server caller
stack has been captured.

## Independent diagnostic and evidence integrity

After original failure, the separately labelled fresh-emulator diagnostic ran
with its own evidence and exit code. Its last successful classifier was an
unverified/late-helper sample with foreground restored. A subsequent logcat
capture failed and overwrote that raw capture with a partial file; the run ended
inconclusive, exit 2. The retained JSON is explicitly a **last successful
observation**, not a terminal success or a classifier reproducible from the final
partial file. `job-outcome-excerpt.txt` preserves this transport failure and the
binding original exit. No automatic rerun or success masking was used.

Both downloaded ZIPs were SHA-256 verified against GitHub's upload digests.
`receipt.json` binds source/tree/APKs/environment, artifact IDs, file hashes and
limitations. Excerpts preserve relevant assertion/dispatch/process/eligibility
lines with source hashes; synthetic tracking contents and unrelated emulator logs
are omitted. The original artifact's `result.txt` was written after the initial
phases and before the optional race, so its PASS text is not the overall result;
`exit-code.txt=1` and the completed workflow failure are authoritative.

## Reproduction

Use the existing `v19-validate.yml` workflow at the exact head. Its probe branch
selects `PASSENGER_RESTART_RACE=1`; the installed command is
`bash scripts/test-android-installed.sh` on the owned disposable API35 emulator.
The original phases run first, then actual IPC/death fixtures, then the measured
service-only comparison and all-process-absence comparison. After failure,
`bash scripts/test-android-restart-after-failure.sh` creates the independently
labelled diagnostic. It cannot turn the original result green. Classifier exit
0 requires the observed interleaving and foreground restoration plus subsequent
behavioral verification; denial is 1, and missing timing/observation is 2.

## Remaining acceptance decision

This is an APK-shippable, permission-neutral **bounded correction**, with actual
installed benefit when the UI survives tracker death or the tracker survives UI
death. It does not solve all-process-absence restart. Process separation adds
memory/IPC cost, and the UI survivor may itself be killed. No memory-pressure,
physical-device, API26, power-loss, original-signer upgrade or universal OEM
recovery acceptance is claimed.

Keep PR19 blocked under the original requirement. The practical choices are:
1. Keep full automatic-restart acceptance and pursue a framework/vendor fix using
   the retained reproduction. The archived framework candidate has host predicate
   controls only, not an Android build or installed validation. External upstream
   submission needs its own authorization.
2. Explicitly approve separately scoped delivery of this bounded resilience
   improvement, while retaining all-process failure as an open product issue and
   reviewing a replacement release gate. That acceptance change has not happened.
3. Consider a genuinely exemption-based redesign only with explicit permission/
   role approval and policy review. Background location alone is insufficient.

The older `supported-variants.md` correctly described process separation as an
untested candidate when written; this run supersedes that installed-test status.
The public [START_STICKY contract](https://developer.android.com/reference/android/app/Service#START_STICKY)
remains relevant: the failure is not proof that Android intentionally disallows
sticky foreground-service restart. [Foreground-start and while-in-use eligibility](https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start)
are distinct. PR18's visible recovery remains a data-preserving fail-safe, not
fulfilment of the original automatic-restart requirement.
