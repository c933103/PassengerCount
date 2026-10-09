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

## Review correction: equal-time retention boundary

Codex's [review finding](https://github.com/c933103/PassengerCount/pull/4#discussion_r4226812014)
was reproduced on `938bc05`: with 20,003 journal records and the first six sharing
a timestamp, invalidating the cursor changed retained IDs `3..20002` to include
`0..2` instead of `3..5`. Stable time sort alone did not preserve journal order.

The bridge now supplies each row's absolute byte offset as an occurrence-order
tie-breaker. Import persists that order and refreshes it when a known ID is read
again. Full-array old bridges use their array index. The retention cap is applied
after timestamp and journal-occurrence ordering, so replayed evicted equal-time
records cannot displace later occurrences. Untagged foreground ties retain their
own stable order after the identified native cohort.

The added 20,003-row invalidated-cursor regression fails on `938bc05` and passes
with this correction. Updated local results: **69/69 Node tests and 97 native
assertions passed**, with JavaScript syntax and whitespace checks also passing.
The initial head's complete browser/APK CI passed (runs 37886815283 and
37886803291), but the changed head requires fresh CI and Codex review; earlier
success is not final-head acceptance.
