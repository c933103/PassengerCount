# PR19 run122 — original failure retained; contrast did not execute

## Exact source and validation

- PR head `c7f31ec1f4482170efd8934e9f83603516d5f9a6`, tree `a4a5d4832ed1646279de4572a9483e3b73c950af`.
- Natural [run122 / attempt1](https://github.com/c933103/PassengerCount/actions/runs/40284527890), job `121444980038`, tested merge `b27e8261bfaca9b70fb426657e04986c3798bea4` with that same tree and parents main `77fcc7685ceb4652c6089c14360fc166ebbe778d` plus this PR head. Terminal **FAILED**.
- [Exact-head Codex](https://github.com/c933103/PassengerCount/pull/19#issuecomment-6410507174): no major issues. Hosted Node **649/649**, zero skipped; native/browser checks and both APK builds passed.
- Original **13 lifecycle phases** and service-only sequence passed. Original full all-package-process-absence restart **6663→6901** was denied; original native **1** remains binding.

The four-file source change retains the actual independent `pidof` native status before validating absence, including partial/failed cases. Local focused342 pass; aggregate648/649 was limited only by the known locally unmaterialized bundled catalogue, which the complete hosted checkout passed. Four source files were read back byte-for-byte;173 unrelated blobs/modes were preserved. This is diagnostic evidence handling, not an APK restart fix. Original lifecycle phases, full absence, permissions, production code, workflows and failure exits were not weakened.

## What actually ran

The original classifier's paired log contains the death, scheduled restart, helper ENTER/FOREGROUND, new process and `mAllowStartForeground false` denial. It has **no matched cleanup line** (`reset=-1`, `cleanupDuringAbsence=false`). Do not infer the earlier demotion sequence in this sample. Original final-log SHA256 is `65af74b0fe765ca28156736a1acb9274689de0c39dff19204e80c65129e60240`; classifier-input log SHA256 is `c983f24efe5db06deae43a980963b5e2cb39939e46efda3cec4c642d2549749a`.

The independent diagnostic bootstrapped, then its warm-up `logcat -d -v threadtime` returned native **255** with **696,320 partial stdout bytes** and empty stderr. It terminated **2**, before package-process absence, the triggered timing slot or first-services alignment. Its later final services read returned `adb: device offline`; after-tests preflight and installed framework capture subsequently completed0. These observations establish an incomplete capture and later transport recovery, not the underlying disconnect cause. Diagnostic final-log SHA256 is `f13800258856150a0637ffaa1959d0b7cda77f9c86bf68f99e57754d5b6583a5`.

The wrapper correctly recorded `not-run-timing-input-unavailable`, control status2 and paired2. **The no-trigger runner did not execute.** There is no new paired contrast or alignment measurement and no claim that host deadlines equalized device timing. The original1 and diagnostic2 are distinct.

## Verification and privacy

Both complete ZIP byte counts and SHA256 match hosted artifact metadata. All available classifier inputs, native capture0/stderr pairs, four platform preflight command/SDK streams and two framework archive/DEX/command-stream/package-metadata captures were independently rehashed. Original/triggered exact installed framework captures completed0. The triggered evidence guard records unchanged; control artifacts contain no guard input manifest because the wrapper stopped before control execution. This absence is recorded, not substituted with an invented verification.

Compact records retain source identity, native statuses, raw file hashes and narrowly selected relevant status/trace lines. Raw runner output and unrelated dump bodies are not republished. All staged files were checked for token/credential-like fields and UUID values before publishing. Full raw artifacts remain the existing hosted run artifacts; no new raw upload is made here. Artifacts expire **2027-01-24T07:13:59Z**.

See [receipt](receipt.json), [paired original inputs](original-paired-input-manifest.json), [original classifier](original-result.json), [warm-up failure boundary](triggered-warm-capture.json), and [control not-run record](control-result.json).

## Engineering stopping condition

The [source-linked engineering decision](../engineering-decision-20261026.md) remains: no demonstrated app-only remedy under existing grants satisfies this installed-image full-absence gate. This is not a claim that Android universally forbids sticky foreground restarts; runs119/120's no-trigger foreground observations and the documented sticky contract are retained counterevidence. Run120 cleanup precedes helper logging, so helper foreground promotion is not an established immediate cause. Actual caller-stack proof is still absent.

This run closes the already-active evidence repair. No additional generic collector, unchanged OS rerun or new image is launched to force a convenient control outcome. Further work must supply a concrete app-controlled causal intervention preserving the original requirement, an identifiable relevant platform remedy/build mapping, or a compatible real-framework regression harness testing the absent-process eligibility transition and genuine security-negative cases. Bounded official-source review found no verified matching remedy/test in the inspected revisions; inaccessible/newer branch coverage remains explicit in the decision, not a claim that none exists anywhere. User-interaction, background-location expansion and keepalive alternatives do not meet the unchanged condition. Profiling remains a separate stateful action, not authorized merely by a capability result.

PR19 remains open and **unmerged**. No release, signing, permissions/security settings change or application acceptance claim.
