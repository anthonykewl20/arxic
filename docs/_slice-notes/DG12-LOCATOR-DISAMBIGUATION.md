# DG12-LOCATOR-DISAMBIGUATION — staged doc updates (charter §10.2)

Issue: #352 · PR: unfiled · Disposition: blocked

## 1. `docs/SYNC.md` — tracker row (append)

```
| #352 | [DG12-LOCATOR-DISAMBIGUATION] Form-drive locator resolution is fatally semantic-ambiguous on duplicate login labels | ☑ done |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-08-30 | **#352 (DG12-LOCATOR-DISAMBIGUATION) form-drive locator disambiguation.** The driver now scopes controls to the unique form containing the planned submit and intersects both semantic and execution locators with crawl-recorded `tag[type]` identity; bare `.first()` remains forbidden as a selector. The run7 disposition remains blocked; real Chromium duplicate-label proof and targeted suites passed. Next: koel DG-12 run8. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### fixed`

```
- DG12-LOCATOR-DISAMBIGUATION form-drive locator disambiguation (#352): preserve crawl-recorded control identity into stage-8, constrain duplicate semantic labels by their form submit and `tag[type]`, and retain the constraint in locator provenance.
```

## 4. `VERSION` bump required?

no — fix pending integration; integrator determines the release bump.

## 5. Evidence pointers

- Read-only campaign evidence: `docs/evidence/DG-12/koel/runs/koel-dg12-hostbound-run7/stages/08.json` — stage 8 recorded three `ARXIC-EXPLORATION-LOCATOR-AMBIGUOUS` blocked actions after a correctly composed leased-persona plan.
- Root cause: `packages/playwright-agent-adapter/src/exploration-driver.ts` pre-fix lines 416–440 counted page/global semantic candidates before crawl-recorded intrinsic control identity; `packages/orchestrator-langgraph/src/exploration.ts:604-610` maps that failure to the blocked locator diagnostic.
- Real-Chromium proof: `packages/playwright-agent-adapter/src/__tests__/exploration-driver.test.ts` — two same-labelled email inputs across forms plus a same-form type collision; the login form is selected through its `Log In` submit and controls through `input[type=email]`, `input[type=password]`, and `button[type=submit]`.
- Provenance proof: `packages/orchestrator-langgraph/src/__tests__/exploration.test.ts` retains each structural constraint with the identity receipt.
- Plan-carrying proof: `packages/orchestrator-langgraph/src/__tests__/proposal-compile.test.ts` preserves crawl-recorded control tag/type from the form surface into every planned form-drive step.
- Gates: targeted vitest (73 passing) ✓ · typecheck ✓ · lint ✓ · format ✓ · license gate not run.

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger | Expected disposition | Test   |
| ------- | -------------------- | ------ |
| D1      | blocked              | driver |
| D2      | observed             | driver |
| D3      | observed or blocked  | driver |
| D4      | observed or blocked  | run8   |

- D1 — Same label across unscoped controls: block rather than choose by ordinal.
- D2 — Two forms share a field label: drive only after selecting the unique form containing the
  planned typed submit.
- D3 — Same-labelled controls remain after form scope but have distinct input types: intersect with
  the crawl-recorded `tag[type]`; otherwise block.
- D4 — Koel DG-12 run8: record email/password/submit attempts with label plus structural constraint,
  or a precise blocked diagnostic when no constrained locator is unique.
