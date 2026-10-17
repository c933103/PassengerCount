# Controlled API35 race reproduced twice

[Run107](https://github.com/c933103/PassengerCount/actions/runs/39008116648) tested
PR19 head bd18cb2eb4d45a6d1fa6c74d50bad07ac31d5889. Node/native/browser/builds
and all 13 original installed phases passed. The appended controlled probe then
reproduced automatic restart denial. The independent post-failure step repeated
the denial on a second fresh emulator. Both exits are1; the aggregate remains
failed and this head is not merge-ready under the applicable CI gate.

Both pre-death service dumps record foreground and while-in-use eligibility from
PROC_STATE_TOP. Both detached deaths are followed by ActivityManager sticky
scheduling, independent test-package FGS entry/promotion, target START_FOREGROUND
cleanup while no target process exists, a new service-triggered target PID, and
foreground promotion denial. Both classify interleaved=true and
cleanupDuringAbsence=true. No observer reattaches before the denied result.

First sample: target PID4883 dies06:03:04.104; helper enters04.316; target
cleanup04.320; helper success return04.321; target PID5359 starts05.120 and is
denied05.159. Cleanup occurs within the helper's foreground binder-call interval.

Second sample: target PID2611 dies06:04:09.392; helper enters09.736, succeeds09.747;
target cleanup09.754; target PID3595 starts10.433 and is denied10.553.

This reproduces the source-backed eligibility-reset race with an independently
controlled foreground transition, beyond the earlier natural keyboard traces.
It still does not capture a system_server cleanup stack or verify the candidate
framework patch. PR18 preserves the interrupted journal, but automatic restart
remains FAILED/open. Original failures and this failed aggregate are retained.

The helper's valid FGS warm-up completed before either target session. The second
emulator reused the same runner-only KVM check and independently saved artifacts;
original evidence was not overwritten. Exact hashes, zero-based classifier
indices and one-based trace excerpts accompany this receipt.
