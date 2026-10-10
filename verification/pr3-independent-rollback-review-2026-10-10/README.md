# Independent rollback review receipt

This evidence-only branch preserves the independently executed joined writer/lifecycle fixture, its runner, report, logs and identity verification. It does not change the accepted PR #3 source branch or wire additional tests into its workflow.

## Source identity

- Published correction: `f01e88f9f4033ac48625fc7182a9cf7682613698`.
- Accepted source tree: `084d92eadd79bf1eaf503c30f8740ba6105b1830`.
- Independently reviewed local commit with that identical tree: `fd3bf7dcbb2139d87476e7ae323b06768890ad65`.
- Parent of the correction: `c71de6bbf28f1cba676fee9c332917625b64e8a5`.

The reviewer verified all 15 correction-manifest entries and 14 unchanged whole-file checks. Node 126 and native journal/session/lifecycle/writer 97/26/1148/928 assertions passed. An additional 24 joined actual-production-writer and source-extracted-lifecycle cases passed 1,568 expanded lifecycle assertions. The published prior writer fails the new behavioral oracle as expected.

## Reproduce the independent joined evidence

At this evidence branch's repository root, run `node scripts/review-joined-writer-lifecycle.cjs`. It compiles the actual production ExportStorage and ExportSession with source-extracted MainActivity lifecycle/outcome methods. It uses the preserved `tests/native/JoinedReviewFixture.java` and the accepted host Android stubs. The optional generator can recreate the fixture and runner by running `python3 verification/pr3-independent-rollback-review-2026-10-10/make-joined-review.py` from the root.

The 24 added scenarios combine MediaStore/SAF, confirmed/zero/throw deletion, successful/failed final result persistence, and Activity recreation before delivery. They inspect retained rows/bytes, cleanup counts, no replay, settled controls, current visible observer and durable restart state. Android APIs and providers are controlled fixtures. This evidence does not claim installed Android behavior, production signing or release readiness. Exact-head CI/review/APK gates remain separately recorded on PR #3.

See [the independent report](independent-review.md), [joined test log](joined-writer-lifecycle.log), [identity verification](identity-manifest-independent.json), and [prior-source negative control](negative-control-independent.log).
