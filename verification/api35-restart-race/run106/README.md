# Run106: original controls pass; diagnostic setup remains unverified

All 13 original installed phases passed. The appended probe did not reach its
race: API35 rejected the ordinary background warm-start of the test helper with
`Error: app is in background uid null`. The original installed aggregate exited2.

The separate failure-path step ran and preserved the original exit/source. Its
fresh-emulator setup stopped at the required KVM access check before launching
another device, exiting2 with independent evidence. No relaxed acceleration,
access workaround or original-result replacement occurred.

The corrections use a legitimate brief test-package foreground service for warm-up
and reuse the same existing runner-only KVM preflight before each owned emulator.
They require a fresh exact-head hosted run. The aggregate remains failed, the
controlled interleaving is unobserved, and earlier natural product failures remain
open. This passing ordinary control is not an automatic-restart remedy.
