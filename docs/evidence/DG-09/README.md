# DG-09 — retained real-world proof artifacts

Slice: #253 ([DG-09] generalized compiler — observation-bound assertions +
generic form-flow executor), which also resolves the verifier defect #258
(refs #258).

These are **sanitized convenience records**, not the proof. The proof is the
real-world suite in CI:

- `packages/playwright-compiler/src/observation-form-flow.real-world.test.ts`
  — real-Chromium observation capture of the redirect-login app + compilation
  of observation-bound form flows (auth AND non-auth domains).
- `packages/verifier/src/redirect-verification.real-world.test.ts` — the
  campaign failure case verifying end-to-end; the canned-literal twin
  classifying honestly (the #258 regression); the generic newsletter flow
  verifying end-to-end.

Regenerate this directory with:

```sh
ARXIC_DG09_EVIDENCE_DIR=docs/evidence/DG-09 pnpm exec vitest run \
  packages/verifier/src/redirect-verification.real-world.test.ts
```

## Files

| File                         | What it records                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `defect-258-regression.json` | The #258 acceptance proof: the campaign case (canned `url:/` post-login assertion on an app that redirects to `/dashboard`) now classifies `contradicted` with `ARXIC-VERIFY-APP-DEFECT` first, one `ARXIC-VERIFY-RUN-FAILURE` per failed run carrying the RETAINED assertion text (`Expected pattern: …/ / Received string: "…/dashboard"`), and `ARXIC-VERIFY-ARTIFACT-MISSING` reported ALONGSIDE — no longer replacing the cause. Persona values are absent (redaction gate asserted in-suite). |

Privacy notes: the retained evidence contains only loopback URLs, assertion
text, and diagnostic codes — no persona credentials (asserted in the suite
itself). No screenshots or raw trace ZIPs are retained here.

[#253]: https://github.com/anthonykewl20/arxic/issues/253
[#258]: https://github.com/anthonykewl20/arxic/issues/258
