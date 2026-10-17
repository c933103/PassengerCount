# Automatic sticky-restart race investigation

## Outcome and unchanged acceptance

The automatic background tracking restart requirement remains open and release
remains blocked. PR19 now includes a **candidate bounded production correction**:
normal separate tracking process and acknowledged private IPC. Installed results
for this candidate are pending; a successful service-only death sample would not
resolve the explicitly retained all-package-processes-absent failure.

Main `77fcc7685ceb4652c6089c14360fc166ebbe778d` preserves data and allows visible-user
recovery after denial, but that does not satisfy automatic restart. Run107 on the
prior diagnostic-only head reproduced controlled denial twice; its immutable
[receipts and safe excerpts](https://github.com/c933103/PassengerCount/tree/b05aababba2580231587357e079f46152f49f015/verification/api35-restart-race/run107)
remain binding. No production permission, signing material, or release change.

## Separate-process candidate

TrackService and a non-exported, same-UID TrackProvider run in `:tracking`.
Only that owner reads/writes tracking preferences and owns the journal monitor.
MainActivity uses synchronous private calls for start/request/stop/delete/pages.
Acknowledgement follows durable work under the same append/fsync barrier; lost
replies return failure/unknown without automatic mutation replay. Cleanup checks
the latest session and stops under that same monitor. Existing tracking files,
tokens, tombstones and directory-sync semantics are retained.

Each client uses a short-lived
[unstable provider reference](https://developer.android.com/reference/android/content/ContentResolver#acquireUnstableContentProviderClient(java.lang.String)):
normal provider death must not cascade into killing its UI client. No persistent
binding, watchdog, hidden Activity, background-location permission or restart
loop is added. Pages are byte-bounded as well as record-bounded. Legacy full reads
use the dedicated [openFile](https://developer.android.com/reference/android/content/ContentProvider#openFile(android.net.Uri,%20java.lang.String))
reliable-pipe return, with the owner monitor held through snapshot streaming.
Transport/read errors do not become empty successful snapshots.

The supported benefit is conditional: if the normal UI process remains alive,
the framework predicate can still find the package process during tracker death.
If the UI dies alone, the separate tracker can continue. If both package processes
are absent, this APK does not repair framework eligibility reset. The probe retains
that all-processes-absent scenario as a failing/inconclusive binding gate, not a
success expectation silently replaced by service-only death. Process separation
also costs memory and remains subject to ordinary Android/OEM process policy.

Installed harness adaptation retains the original 13 behavioral phases and order,
with owner reflection now attached explicitly to `:tracking`, independent real-UI
TOP proof, and distinct service PID observations. Test-only WebView storage has a
separate suffix. Actual UI-process bridge tests then exercise remote start/read,
stop/deletion, Binder blocking behind an accepted append, owner death before reply,
and UI-only death. The service-only controlled race has separate evidence before
the all-processes-absent controlled race. No instrumentation remains attached and
no IPC/Activity starts target during either restart window.

Original failure: [PR17 diagnosis](https://github.com/c933103/PassengerCount/pull/17#issuecomment-6189425602)
and [run 38710322909](https://github.com/c933103/PassengerCount/actions/runs/38710322909).
The [PR18 postmerge receipt](https://github.com/c933103/PassengerCount/pull/18#issuecomment-6191613141)
explicitly keeps that failure open. Their retained passing and failing traces
have the same API35 fingerprint, with retained TOP eligibility in the passing
sample and cleared start/while-in-use eligibility in the failure.

## Supported platform diagnosis

The documented [START_STICKY contract](https://developer.android.com/reference/android/app/Service#START_STICKY)
says background-start restrictions do not apply to sticky foreground-service
restarts. Therefore the observed failure must not be redefined as an inherently
unsupported requirement.

In [AOSP Android 15 ActiveServices](https://android.googlesource.com/platform/frameworks/base/+/4e43ad12e1b211f15152e9c5b16b0fe88e6b93f3/services/core/java/com/android/server/am/ActiveServices.java),
`killServicesLocked` retains the pending sticky ServiceRecord. A separate
foreground-service entry schedules a per-user `updateForegroundApps` pass. Its
background-restriction predicate returns false when the target UID or package
process is absent. The pass can consequently call `stopAllForegroundServicesLocked`
on that retained record. Foreground demotion finishes the app-op and
`resetFgsRestrictionLocked` clears both saved reasons. A restarted service then
re-evaluates eligibility from its new background process.

The retained failure orders detached death, restart scheduling, another app's
FGS start, target START_FOREGROUND cleanup, new target service process, then
denial. This matches that code path but does not prove which system_server
call caused the cleanup on the Google image. No framework stack was captured.

On 2026-10-17 the absent-process predicate remains unchanged in checked official
[android15-release](https://android.googlesource.com/platform/frameworks/base/+/cc8bb19595c661f5cf42f330457000e643c67d1b/services/core/java/com/android/server/am/ActiveServices.java),
[android16-release](https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/services/core/java/com/android/server/am/ActiveServices.java)
and [main](https://android.googlesource.com/platform/frameworks/base/+/1cdfff555f4a21f71ccc978290e2e212e2f8b168/services/core/java/com/android/server/am/ActiveServices.java).
The prior two-method host experiment was rerun with those exact method bodies:
7 controls passed for each source, including both absent-process cases selecting
demotion. This is a source-path experiment with doubles, not Android execution
or proof that every current shipped build is affected.

## Why no speculative application patch

The retained reset occurs before the replacement app process starts. Moving
`startForeground` earlier in app callbacks, switching sticky return constants,
or retrying the same denied start cannot restore server-side reasons already
cleared. The original trace also includes a second denied attempt.

[Android's restriction documentation](https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start)
separates permission to start an FGS from eligibility to access while-in-use
location. The current manifest has foreground location only. Background location
alone does not establish a background FGS-start exemption; ordinary queued work
or a second process is not a general permission-neutral restoration API. No
unsupported keepalive, fabricated user action, policy bypass or permission
expansion is introduced.

## Bounded next actions

1. Run this probe on the unchanged API35 hosted image. Require measured ordering
   and retain a timing miss as inconclusive. A matching failure strengthens the
   platform-race case; a successful sample does not erase the retained failure.
2. If the race reproduces, prepare an upstream platform report with the reduced
   interleaving, fingerprint and trace. Sending it outside this repository needs
   separate authorization. A framework correction must preserve legitimate
   background restriction and explicit-stop behavior while distinguishing a
   pending authorized sticky restart from a newly started background service.
3. Validate any candidate app or framework remedy against this interleaving,
   original sticky/tombstone controls and actual new GPS delivery. A new OS
   version alone is not accepted as a fix without the observed result.
4. Any broader permission/exemption-based design is a separate product decision
   requiring approval and policy review; the present task grants none. Visible
   recovery remains a fail-safe only.

## Local verification and limits

See `local-receipt.json` for exact input hashes and results. Browser and installed
Android checks remain separate required hosted observations. Host classifier
checks cannot establish automatic restart on Android. The run instructions and
exit classifications are in [the test guide](../../tests/android/README.md#opt-in-independent-fgs-restart-race-probe).

## Fresh hosted observations and failure-path wiring

Runs [104](https://github.com/c933103/PassengerCount/actions/runs/39006305699)
and [105](https://github.com/c933103/PassengerCount/actions/runs/39006630427)
failed the original valid sticky restart gate on unchanged production before the
probe ran. Both observed target START_FOREGROUND cleanup during process absence,
then service-triggered process creation and denied foreground promotion. Run104
also observed a keyboard FGS entry in the absent-process window; run105's keyboard
FGS entries preceded death. Neither captures the framework cleanup caller.
[Run104 retained evidence](https://github.com/c933103/PassengerCount/tree/d4c61ca3018b95ce3406037d6b30685f91a131d3/verification/api35-restart-race/run104)
is immutable; these failures remain binding and are not retried away.

The workflow now permits a separate opt-in diagnostic step after an original
installed-step failure. It uses a new disposable emulator and independent
evidence/exit status. It does not replace, rerun, or suppress the original failed
step, and the job remains failed even if the diagnostic observes success.
Failure-path host regressions exercise success/denial/inconclusive diagnostic
exits while preserving the original nonzero receipt and trace. Android execution
of this additional path remains a separate hosted observation.

Run [106](https://github.com/c933103/PassengerCount/actions/runs/39007438327)
passed all 13 original installed phases, then exposed two diagnostic setup
failures: ordinary background helper warm-start was rejected, and KVM access was
unavailable when the second emulator path began. Both exits remained 2 and the
aggregate stayed failed. No controlled race observation is claimed. The helper
now warms through a short test-package FGS and proves warm completion before the
target starts. Both emulator paths reuse the existing runner-only KVM preflight;
no device permission scope, acceleration requirement or target permission expands.


Run [108](https://github.com/c933103/PassengerCount/actions/runs/39010001390) passed
Node/native/browser/build checks and both bootstraps, but both installed paths
failed before detached death: API35 attached owner-local instrumentation to the
UI PID despite the declared targetProcesses. This is a harness targeting failure,
not a new candidate restart result. Its [immutable receipt and safe PID excerpts](https://github.com/c933103/PassengerCount/tree/5c2a83b88ec9835e47d3995cb51c028c71878577/verification/api35-restart-race/run108)
retain both failures and downloaded artifact hashes. The corrected application
default/explicit-Activity process declarations leave all three resolved component
processes unchanged. A supported multi-process test relay requires independent
UI execution/detachment evidence. Both original and appended installed gates must
run again on the corrected exact head.
