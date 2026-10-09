# PC-002: native GPS journal replay

## Reproduction and scope

The unmodified `main` commit `ae078dbe1a3dbdcc694bcf8315a6dd3c66888495`
was executed with a two-point synthetic journal. Calling the actual extracted
`syncNativeTrack` twice produced latitude sequence `[1,2,1,2]` instead of `[1,2]`.
The same importer is present on open PR #3 at
`b9fe113aed0a1c6786b7aa5aeb5e9ce1389ae0d5`; this patch is independently based on
main and does not incorporate or supersede that upload/export work.

## Correction

- Every newly written native record receives a UUID before append. Exact same-time
  measurements remain independently identifiable.
- A read-only bridge pages at most 256 complete journal rows per call using byte
  offsets, with the preceding row's exact SHA-256 digest as a cursor anchor.
  Reads no longer stop permanently at the first 20,000 journal rows.
- A partial EOF row is never acknowledged. Missing/truncated/replaced anchors
  restart reading; retained native IDs make replay idempotent. Existing journal
  bytes are never rewritten or deleted.
- Legacy rows have a deterministic byte-offset plus exact-row-digest identity.
  This preserves separate identical legacy rows and supports the existing
  append-only format without migration writes. The application never compacts or
  rewrites journals. An external rewrite that moves an ID-less legacy record to
  a different offset is ambiguous and can be retained again rather than silently
  discarded; UUID-bearing records keep their identity through such moves.
- Per-survey cursor and merged track are committed together in workspace storage.
  A failed commit rolls back both in-memory changes for a safe retry.
- Import compares stable record IDs rather than time-only cutoffs. A full stored
  measurement may claim one untagged foreground/legacy point; distinct accuracy,
  speed, heading, source or same-time journal records are retained. Stable time
  ordering prevents an already-newer foreground point from preceding imported
  earlier background points. The existing 20,000 retained-point cap is unchanged.
- Old APK full-array bridges remain supported with deterministic measurement and
  occurrence identity. They retain their old native read limit until upgraded.

## Local validation on 9 October 2026

- `npm test`: 68/68 passed, including 10 new importer regressions.
- `npm run test:native`: 95 assertions passed across 12 native fixture scenarios.
  Uses the actual production `TrackJournal` reader through Java's compiler module;
  it is not an Android framework/device test.
- `git diff --check` and JavaScript syntax checks passed.
- `npm ci --ignore-scripts --cache <writable-cache>` passed with the locked
  Playwright 1.62.1. The initial default npm cache location was unavailable.
- `CHROME_PATH=/usr/bin/chromium npm run test:browser`: **blocked before browser
  startup**, including an approved unsandboxed retry. Chromium's process-singleton
  socket creation returns `Operation not permitted`. No local browser pass is
  claimed. The full existing suite now includes real repeated View/GPX handlers,
  same-time evidence, foreground overlap, persisted cursor restart and new-tail
  tests; CI must run them.
- Android APK build: **not run locally**; this host has no configured Android SDK.
  CI retains the repository's APK build and ephemeral validation signing checks.
- CI is enabled for this branch, main and PRs targeting main. Acceptance requires
  the exact final head's browser/native/build CI and Codex review.

## Remaining scope

PC-001 is unchanged: import still only accepts `in_progress` surveys, and native
stop/drain acknowledgement plus late pause/abort/complete reconciliation remains
separate. This patch does not claim to repair already-corrupted historical tracks,
validate physical-device background tracking, or complete PR #3 acceptance.
