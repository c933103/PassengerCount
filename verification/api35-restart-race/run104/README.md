# Fresh natural API35 reproduction, 2026-10-17

[Hosted run 104](https://github.com/c933103/PassengerCount/actions/runs/39006305699)
failed the unchanged original valid sticky restart gate before the new independent
FGS helper could run. Production code and production permissions are identical to
main `77fcc7685ceb4652c6089c14360fc166ebbe778d`.

The detached target PID 4097 died at 05:31:30.997 and its sticky restart was
scheduled at 30.998. At 31.292 the keyboard entered its own foreground service;
at 31.328 the target's START_FOREGROUND app-op cleanup was logged while the target
process was absent. Android created target PID 4429 for TrackService at 33.158,
but denied foreground promotion from SVC state at 33.700. At 33.740 PR18 preserved
the interruption and stopped; the final service dump is empty.

This is a fresh failure of automatic restart on unchanged production, not a test
helper failure. It independently repeats the retained October 15 ordering.
The AOSP eligibility-reset path remains a source-backed explanation, not a captured
framework stack proof. See the exact line-numbered excerpt and hashed receipt.

No retry overwrote this failure. A later green sample would not clear it or make
manual foreground recovery satisfy the original automatic restart requirement.
