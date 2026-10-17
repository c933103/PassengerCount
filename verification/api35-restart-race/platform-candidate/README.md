# Bounded platform correction candidate, not an app fix

This one-time experiment is separate from PR19 and is not installed, built into
Android, or shipped in PassengerCount. The installed test probe still needs to
establish the causal interleaving on the Google API35 image. No correction or
release acceptance is claimed from this experiment.

AOSP base: frameworks/base 4e43ad12e1b211f15152e9c5b16b0fe88e6b93f3, Android 15 r1.
Official source: https://android.googlesource.com/platform/frameworks/base/+/4e43ad12e1b211f15152e9c5b16b0fe88e6b93f3/services/core/java/com/android/server/am/ActiveServices.java

The candidate keeps the live-process predicate unchanged. For absent processes
only, it consults AppStateTracker's actual package restriction flag, the same
source that attachApplicationLocked uses to initialize the new process's
background-restricted state. It denies when that state is unavailable. This
would avoid treating a temporary missing process as an affirmative background
restriction, while still demoting actually restricted packages.

`candidate-framework-fallback.patch` applies to that exact AOSP file.
`PlatformFallbackExperiment.java` contains the candidate method and explicit
minimal doubles; `java PlatformFallbackExperiment.java` passes 12 controls for
absent UID/process, restricted/unrestricted/unknown state and unchanged live
allow/deny behavior. The test does not emulate restart scheduling, type policy,
shared-UID edge cases, app-op callbacks or a full system_server. Those require
real platform tests and framework review. The patch is a reviewable hypothesis,
not an APK-level workaround or verified Android fix.

Source revision metadata and repeated results for the original unchanged two-
method source-path experiment are included. That experiment's original code,
license and limits remain at:
https://github.com/c933103/PassengerCount/tree/1a74aaf410c94bfb79d58e7b130529286ad66300/verification/api35-sticky-denial

Neither a new location permission nor an unrelated start exemption is added.
Sending an upstream report/patch outside the user's project repositories needs
separate authorization. Android policy changes or a custom OS build are not
part of this authorized product fix scope.
