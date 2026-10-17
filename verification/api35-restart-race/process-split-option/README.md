# Ordinary process split: useful bounded option, not a manifest-only patch

## Fit to the actual requirement

In current production, MainActivity and TrackService share the default process.
The original installed fixture SIGKILLs that service-hosting PID after detaching
instrumentation and backgrounding Home. Thus the tested service-process death
also leaves no ordinary same-package process alive. It is not a force-stop or a
claim that every OS termination must be recoverable.

A supported `android:process=":tracking"` architecture can separate two useful
cases: UI-process death could leave recording uninterrupted, and tracking-process
death could restart successfully while the ordinary UI process survives. The
API35 predicate can find that surviving same-package ProcessRecord and preserve
saved eligibility. This is a concrete resilience opportunity for the end-user
objective of continued automatic recording, not a discarded idea because it
cannot guarantee universal OS survival.

The original absent-package interval remains a required regression, separately
labeled: stop neither component, detach instrumentation, kill the service process
and any ordinary same-package survivor, then retain the independent FGS transition.
A service-only pass is useful mitigation evidence but does not erase that failure.
No implementation or installed success is claimed here.

## Why the one-line manifest change is unsafe for this code

On [production main 77fcc768](https://github.com/c933103/PassengerCount/tree/77fcc7685ceb4652c6089c14360fc166ebbe778d/android/src/app/passengercount):

- TrackService.java 24–46 caches static `session` and a SharedPreferences-backed
  store; 25/50–57 keeps static `running` for synchronous stop completion.
- MainActivity.java 261–280 directly starts/stops/deletes through those static
  objects. `stopTrackingAndDrain` promises an acknowledged barrier before returning.
- MainActivity.java 283–325 reads journals under the same session monitor.
- TrackSession.java 20–40 serializes start/stop/accepted append through Java's
  object monitor. TrackDeletion.java 20–36 uses that same gate for durable
  tombstoning, session invalidation, unlink and directory sync.

Separate processes create independent statics/monitors. Even an ideal shared
store would not make the UI's monitor wait for a service append; Android also
[does not support SharedPreferences across multiple processes](https://developer.android.com/reference/android/content/SharedPreferences).
The existing stop/drain/deletion guarantees would therefore need real IPC and
single-owner coordination, not MODE_MULTI_PROCESS or a declaration-only change.

`SplitSessionBoundaryExperiment.java` compiles with unchanged production
TrackSession. With one controller, the stopper demonstrably blocks on an accepted
append. With two controllers sharing even a perfectly visible store, an acknowledged
stop returns before that append completes. Six bounded host controls pass. This
isolates the monitor issue; it is not an Android two-process result or a newly
observed production bug. Command and source hashes are in `receipt.json`.

## Concrete safe implementation scope and acceptance

1. Keep one authoritative tracker process owning session/tombstone state and all
   journal append/read/delete operations. Use a non-exported, same-app IPC boundary
   for start, stop-and-drain, deletion and paged reads. Android's
   [bound-service IPC guidance](https://developer.android.com/develop/background-work/services/bound-services)
   supplies supported mechanisms. No hidden activity, keepalive service, second
   foreground notification or watchdog is required for the architectural split.
2. Preserve synchronous acknowledgments at the JS bridge boundary; on Binder
   death or failed durable commit, return failure/unknown rather than reporting a
   completed drain/delete. Preserve generation IDs and idempotent retries.
3. Add installed cases for UI-only death, tracker-only death with a surviving UI
   process, and all ordinary package processes absent. Require ActivityManager
   service-triggered restart, new GPS delivery, preserved generation/journal and
   recorded original failure classification. Keep the observer/IPC detached in
   the restart window so a test binding cannot supply eligibility.
4. Repeat stop-during-append, delete-during-append, late callback, stale generation,
   tombstone restart, malformed journal/path, commit/unlink/fsync failure and
   process death during IPC acknowledgment. Measure additional process memory,
   restart latency and battery/notification behavior rather than assume cost-free.

This is a larger but supported permission-neutral application option. It should
be a focused implementation with those regressions, not mixed into PR19's
currently running diagnostic head or presented as an already tested product fix.
