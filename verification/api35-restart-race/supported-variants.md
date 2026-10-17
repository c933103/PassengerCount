# Supported application variants against the absent-process eligibility reset

## Boundary

No complete permission-neutral APK remedy was identified for the measured
all-processes-absent → foreground-eligibility cleanup → denied sticky restart
ordering. This is a bounded source/documentation conclusion, not proof that every
possible Android design fails. The public [START_STICKY contract](https://developer.android.com/reference/android/app/Service#START_STICKY)
explicitly supports sticky foreground-service restart despite background-start
restrictions. The original automatic-restart requirement stays open.

Current production declares foreground fine/coarse location and the location FGS
permissions, without background location, a special role or a fresh contextual
start exemption. [Android documents two separate restrictions](https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start):
FGS start eligibility and access to while-in-use resources. Satisfying only one
is insufficient for this location-tracking service.

## Evaluated variants

| Supported variant | Consequence for the observed ordering |
| --- | --- |
| START_REDELIVER_INTENT | Retains/redelivers an Intent. API35 return-value bookkeeping does not restore the cleared foreground-start or while-in-use reasons. Timing may differ, but the identified state loss remains. |
| START_STICKY_COMPATIBILITY | Weaker onStartCommand guarantee. Promotion from onCreate still runs after the server reset. |
| Earlier promotion/onCreate | Can harden startup latency but cannot execute before the replacement process exists. Run104 reset precedes replacement process creation by 1.83 seconds; run105 by 3.56 seconds. |
| Ordinary separate service process | Plausible conditional mitigation. If another same-package process survives and is not background-restricted, getProcessInPackage can keep the problematic predicate true. Android can also kill that survivor. It neither restores already-cleared reasons nor covers all-package-process death. Not tested on an installed build here. |
| isolatedProcess | Runs without the app's own permissions; it cannot directly host the current location implementation. A permission-holding broker retains a lifecycle dependency. |
| BIND_AUTO_CREATE / capability propagation | Can recreate a bound service and propagate a live eligible client's state. Same-UID self-bindings are skipped as fresh FGS-exemption sources in API35; propagation does not manufacture eligibility after all relevant processes disappear. |
| Planned stop/restart or handover | stopForeground itself resets state; explicit stopSelf/stopService removes the sticky continuation. Handover may avoid a planned gap with a surviving eligible process, but destruction callbacks are not guaranteed for unexpected death. |
| Alarms | Inexact alarms do not provide a general while-in-use-location exemption. Exact PendingIntent alarms require additional permission or an existing exemption absent here. Permission-free OnAlarmListener lifetime depends on the process/component and cannot reliably recover its death. |
| JobScheduler / WorkManager | Work scheduling is not location eligibility. A long-running WorkManager worker uses an FGS subject to type prerequisites. Ordinary system JobService binding does not automatically supply background-FGS-start eligibility in the inspected source. |
| PendingIntent or location receiver | A self-sent PendingIntent is not a fresh visible-user grant. A different visible app sending one is a documented contextual exception, not a general recovery mechanism. Foreground-only location delivery cannot be relied on after the FGS is lost. |

The separate process assessment is intentionally conditional, rather than an
unsupported claim that process separation never helps. A legitimate experiment
would compare service-process-only death with all-package-process death, while
retaining the independent FGS transition and requiring new GPS delivery. Passing
only the survivor case establishes mitigation, not full restart acceptance.

## Concrete options requiring distinct validation

1. Keep the original requirement and use the reduced reproduction to obtain a
   framework/vendor correction. The separate candidate source patch preserves
   live-process checks and consults actual package restriction state when absent.
   It passed twelve host predicate controls only; it has not been Android-built,
   installed or reviewed as a full framework correction. Sending the report
   upstream requires approval outside the user's project repositories.
2. Evaluate a normal separate-process architecture as a conditional resilience
   improvement, using both death cases above. No additional location permission
   is inherently required by process separation, but the retained all-process
   failure must remain a blocker if reproduced.
3. A genuinely exemption-based design would require explicit approval of new
   permissions/roles and policy review. Background location alone does not grant
   background FGS-start eligibility. Neither an unrelated role nor a fabricated
   user action is an acceptable workaround.
4. Visible-user recovery remains PR18's data-preserving fail-safe; it does not
   count toward automatic restart.

## Official sources and evidence limits

- [Pinned API35 ActiveServices](https://android.googlesource.com/platform/frameworks/base/+/4e43ad12e1b211f15152e9c5b16b0fe88e6b93f3/services/core/java/com/android/server/am/ActiveServices.java): predicate 2096–2119; scheduling/execution 5255/5604; service creation 6013; return bookkeeping 6695–6737; reset 8334; binding checks 8507/8563.
- [Service process/isolation attributes](https://developer.android.com/guide/topics/manifest/service-element)
- [Process lifetimes and non-guaranteed destruction callbacks](https://developer.android.com/guide/components/activities/process-lifecycle)
- [BIND_INCLUDE_CAPABILITIES](https://developer.android.com/reference/android/content/Context#BIND_INCLUDE_CAPABILITIES)
- [Alarm scheduling](https://developer.android.com/develop/background-work/services/alarms) and [AlarmManager listener lifetime](https://developer.android.com/reference/android/app/AlarmManager)
- [Long-running WorkManager workers](https://developer.android.com/develop/background-work/background-tasks/persistent/how-to/long-running)
- [Location delivery permission conditions](https://developers.google.com/android/reference/com/google/android/gms/location/FusedLocationProviderClient)

No installed variant comparison is claimed. The natural failures and source path
support a framework race hypothesis, but no system_server stack identifies the
exact cleanup caller on the Google image. Neither a source-double experiment nor
an intermittent green control proves that an OS release fixes the defect.
