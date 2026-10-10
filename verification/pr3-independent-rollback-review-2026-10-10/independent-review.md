# Independent rollback-uncertainty review

## Verdict

Accepted for source publication at commit `fd3bf7dcbb2139d87476e7ae323b06768890ad65`, tree `084d92eadd79bf1eaf503c30f8740ba6105b1830`, parent `c71de6bbf28f1cba676fee9c332917625b64e8a5`.

No blocking defect found in the bounded 15-file correction. The reproduced incomplete-cleanup failure now preserves uncertainty through the actual native writer, outcome mapper, export-session settlement, visible observer, and durable restart. Confirmed cleanup remains retry-safe. This is source acceptance; fresh exact-head review/CI/APK/signature/artifact gates remain necessary. Prior-head CI is not validation of changed native code.

## Independent checks

- `npm test`: 126 passed, no failures/skips/cancellations (`node-independent.log`).
- `npm run test:native`: 97 TrackJournal, 26 TrackSession, 1,148 lifecycle assertions across 84 scenarios, and 928 actual-writer assertions passed (`native-independent.log`).
- Added 24 joined writer/lifecycle scenarios. They compile the unchanged production ExportStorage and source-extracted Activity lifecycle/outcome methods together, rather than synthesizing the writer exception. Both MediaStore and SAF fail their third companion open, then use confirmed, zero-return, or thrown deletion outcomes. Each case runs with successful/failed final result persistence and with/without Activity recreation before outcome delivery. The expanded harness passes 1,568 assertions, adding 420 to the existing 1,148 (`joined-writer-lifecycle.log`).
- Joined assertions verify actual retained row/byte counts, every expected cleanup attempt, unchanged open count/no replay, settled nonpending state, the last event delivered to the currently visible observer, durable restart result, and replay-free recreation. Partial output cases retain two written companions and receive uncertainty. Confirmed rollback retains no output and receives ordinary failure, except that a failed final durable result commit keeps restart conservatively uncertain.
- Reran the permanent writer oracle against published c71 source. It fails behaviorally at the incomplete-cleanup uncertainty assertion, as expected (`negative-control-independent.log`).
- Independently verified all 15 publication manifest contents and Git/SHA-256 hashes, exact head/tree/parent, full changed-path set, and all 14 whole-file preservation entries (`identity-manifest-independent.json`).

## Code review findings

1. MediaStore cleanup requires deletion result exactly one and treats zero or thrown cleanup errors conservatively. `deleteMedia(uri) && cleaned` deliberately calls each delete even after an earlier failure; the left-to-right expression is correct. If the current failed file was omitted from the earlier-companion list and already has an uncertain exception, successful earlier cleanup does not downgrade it.
2. SAF standalone and bundle paths check document deletion confirmation. A failed whole-directory rollback leaves an uncertain outcome. Known child URIs are not separately retried after failed directory deletion; retaining those possible partial files is correctly disclosed by uncertainty, with no claim of atomic rollback.
3. Legacy file-write cleanup checks false and thrown deletion results. Recursive cleanup attempts subsequent known children and then the directory even after a child fails. An unreadable directory remains unconfirmed. Successful complete fresh-directory removal can replace an earlier child-write uncertainty with ordinary failure. The implementation remains conservatively uncertain if a child deletion was unconfirmed even if its parent deletion reports success.
4. All four bridge export catches delegate to the new mapper. The mapper recognizes the typed writer uncertainty and stores the existing uncertain result through the conservative final-commit path. Queue ownership, pre-write durable uncertainty, observer transitions, shared pending controls and session settlement are unchanged.
5. Successful writer behavior and the earlier post-publication friendly-path fallback remain covered and unchanged. Snapshot serialization, optional PNG declaration, upload payloads, GPX, journal/track code, version, workflow, packaging and signing are preserved.

## Evidence and reproduction

The additional joined fixture is `tests/native/JoinedReviewFixture.java`; runner is `scripts/review-joined-writer-lifecycle.cjs`; generator is `make-joined-review.py` in this review copy. Run the runner with Node. It qualifies the actual uncertain-exception type by package to avoid the existing lifecycle fixture's nested storage-directory stub; no production behavior is replaced. Actual writer, rollback helpers, outcome mapper and queue/session code execute in the same harness. Android APIs, preferences and providers remain test doubles; this is not an installed Android test.

Author worktree was not edited and retains only its pre-existing untracked node_modules symlink. No remote state, production signing, or live provider/database writes were performed.
