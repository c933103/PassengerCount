# Automatic sticky-restart race investigation

## Outcome and unchanged acceptance

The automatic background tracking restart requirement remains open and release
remains blocked. This change supplies an opt-in installed race probe; it is not a
production remedy. Main `77fcc7685ceb4652c6089c14360fc166ebbe778d` preserves data and
allows visible-user recovery after denial, but that does not satisfy automatic
restart. No production source, permissions, signing material or release changes.

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
