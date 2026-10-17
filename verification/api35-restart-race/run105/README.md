# Current-head API35 reproduction, 2026-10-17

[Hosted run 105](https://github.com/c933103/PassengerCount/actions/runs/39006630427)
failed the unchanged original valid sticky restart gate on PR19 head
`a2ee57fa6628389328b1e16e9176936cde936b10`. The new probe did not execute.

The detached PID 4086 died at 05:36:28.402, with sticky restart scheduled at
28.406. Target START_FOREGROUND cleanup occurred at 28.475 before replacement
PID 4509 was created for TrackService at 32.037. Foreground promotion was denied
from SVC state at 32.174, and PR18 saved the interruption at 32.179. The final
service dump was empty.

Keyboard FGS starts preceded death in this sample. Unlike run104, this excerpt
does not show another FGS entering after target death. It therefore supports the
absent-process cleanup/denied-restart observation, but does not identify the
system_server caller or prove the controlled helper interleaving.

Node, native host, browser and both APK builds passed. Seven instrumentation
phases completed, followed by the original automatic-restart failure. The
remaining original phases and the appended probe did not run. No retry erased
this result; PR19 has failed applicable current-head CI and is not merge-ready.
