# WEB-402-ORACLE — numeric layout evidence

Tracker: [#402](https://github.com/anthonykewl20/arxic/issues/402).
Implementation: this PR's `feat/visual-oracle` tree, based on `2395041`.
Observed 2026-09-06. Full product acceptance remains open.

## Environment and reproduction

Actual Chromium and the Express vulnerable-auth reference app, booted through
`bootFixtureApp` with an ephemeral port and per-run temporary database. A local
HTTP proxy serves the real app and introduces a controlled CSS regression:
`body { min-width: 1800px; background: #c00030 }`. This tests a real rendered
regression, not a claim that the unmodified app has that defect. Viewport 800×600,
DPR 1, en-US, UTC, light scheme, reduced motion, fresh anonymous context.

```bash
ARXIC_ORACLE_EVIDENCE_DIR=docs/evidence/WEB-402-ORACLE \
  pnpm exec vitest run apps/web/src/__tests__/visual.test.ts \
  apps/web/src/__tests__/visual-oracle.test.ts
```

Initial run: five tests in two files passed (7.83 s). Typecheck and lint exited 0;
license gate: `Rejected: 0`. CI status is reported on the PR, not inferred here.

## Results and evidence

| Test point | Result | Evidence |
| --- | --- | --- |
| Unapproved capture | Pass: blocked before capture | Existing visual-run test assertion |
| First clean capture | Pass: overflow delta 0, audit unverified | [Baseline PNG](baseline/checkpoint-1.png), [assessment](baseline/checkpoint-1.assessment.json) |
| Consecutive clean run | Pass: unchanged PNG, same zero overflow | [Repeat PNG](repeat/checkpoint-1.png), [assessment](repeat/checkpoint-1.assessment.json) |
| Controlled CSS regression | Pass: exact overflow delta 1008, assessment fail, approved baseline preserved | [Overflow PNG](overflow/checkpoint-1.png), [assessment](overflow/checkpoint-1.assessment.json) |
| Altered assessment | Pass: retrieval rejects hash mismatch | Real visual-run artifact tamper assertion |
| Altered PNG / missing privacy mask | Pass: baseline integrity rejects / capture blocked | Existing visual-run assertions retained |
| Missing/unstable/non-finite evidence | Pass: unverified, no fabricated pass | Four public assessment seam tests include malformed data, hard failure and incomplete coverage |

The 1008px delta includes the reference page's native body margin. The initial
expected literal 1000 was corrected to 1008 after real layout evidence; the exact
matcher was retained, not widened.

All three PNGs were opened by the agent. They show the real auth form with
magenta input masks; the changed image shows the controlled red background.
The screenshot alone cannot prove offscreen document width; the numeric report
supplies that measurement. Baseline and repeat PNG bytes are identical.

Each directory retains the original capture privacy sidecar, sanitized action
timeline and adjacent sanitization provenance. SHA-256 checks matched every PNG
against both its privacy sidecar and assessment, and every timeline against its
sidecar. Independent timeline inspection found only navigate/capture actions,
ordinal checkpoint and fixed stability result. Scene nodes contain only the
allow-listed numeric `id`, `parent`, `x`, `y`, `width`, `height` fields; no DOM
text, attributes, URLs, field values, a11y names or raw trace ZIPs are retained.

A follow-up browser-boundary test reproduced non-numeric data escaping the
collector. The trusted host now rejects malformed numeric fields and rebuilds
the allow-listed projection before retention. All five assessment/collector
tests pass after that correction. This follow-up uses a fake of the external
browser boundary; the real capture path is covered by the reference-app test.

## Limits

No independent human inspection or release sign-off is claimed. No paid model
call, full-a11y scene, atomic capture, new recording, full-page capture,
contrast/alignment/occlusion solver, complete discovery, expanded state or
cross-platform campaign was executed. The model-review path is unchanged.
This proof establishes the first evidence slice, not the full owner-requested
auditor or #402 completion.
