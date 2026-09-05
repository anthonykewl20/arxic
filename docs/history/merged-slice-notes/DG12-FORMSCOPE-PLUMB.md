# DG12-FORMSCOPE-PLUMB — staged doc updates (charter §10.2)

Issue: #352 · PR: pending (not created in this slice) · Disposition: observed

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
| #352 | [DG12-FORMSCOPE-PLUMB] Retain crawl-symmetric form-drive scope and locator-resolution provenance in stage-8 receipts | open — fresh live koel campaign replay pending |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-08-30 | #352 (DG12-FORMSCOPE-PLUMB) retains each proposal form-drive step's crawl-bound field/typed-submit scope, selected crawl-symmetric strategy, and fail-closed candidate counts in stage-8 locator provenance. The observed live Koel shape is placeholder-only fields with literal `aria-label="undefined"` and a nullified submit accessible name; the driver now uses crawl-equivalent placeholder and button-text addressing without ordinal fallback. The run8 artifact remains read-only evidence and a fresh live replay remains pending. Disposition: observed. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### fixed`

```
- DG12-FORMSCOPE-PLUMB retain crawl-bound form scope, selected crawl-symmetric locator strategy, and fail-closed candidate diagnostics alongside label and tag/type provenance in stage-8 form-drive receipts (#352), making placeholder-only and duplicate-label resolution inspectable without an ordinal fallback.
```

## 4. `VERSION` bump required?

no — provenance receipt enrichment only; no release version decision in a parallel slice.

## 5. Evidence pointers

- Real-Chromium driver proof: `packages/playwright-agent-adapter/src/__tests__/exploration-driver.test.ts` drives the observed Koel-shaped placeholder-only controls despite literal `aria-label="undefined"` and a nullified submit accessible name, through crawl-symmetric placeholder and button-text strategies.
- Receipt regression: `packages/orchestrator-langgraph/src/__tests__/exploration.test.ts` retains exact email/password/submit labels, `tag[type]`, crawl form scope, successful `resolutionStrategy`, and failed semantic candidate diagnostics from planned steps.
- Read-only campaign evidence: supplied DG-12 Koel hostbound run8 stage-8 receipt — its pre-slice output shows structural constraints but omits the scope and resolution detail needed to inspect the resolved form identity.
- Artifacts: no new retained browser artifact; the fresh Koel campaign replay is intentionally deferred to the DG-12 runner.

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                                                    | Expected disposition                                                                                                                                                                   | Test                                                                                                       |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Duplicate semantic email/password labels across forms, but one typed `Log In` submit scope | observed — the receipt identifies the specific crawl-bound form scope plus `tag[type]`                                                                                                 | `exploration-driver.test.ts` real-Chromium duplicate-label proof; `exploration.test.ts` receipt regression |
| Placeholder-only fields with literal `aria-label="undefined"`                              | observed — label strategy excludes the literal sentinel; the restored crawl-symmetric label/placeholder union has exactly one candidate, then provenance names `placeholder-symmetric` | `exploration-driver.test.ts` live-Koel-shaped control proof                                                |
| Label and placeholder strategies identify different typed controls under the same text     | blocked — the restored union gate sees two candidates and returns `semantic-ambiguous` with exact per-strategy counts                                                                  | `exploration-driver.test.ts` cross-strategy ambiguity regression                                           |
| Nullified submit accessible name with visible `Log In` text                                | observed — role addressing has zero candidates, then crawl-symmetric button-text addressing selects the typed submit                                                                   | `exploration-driver.test.ts` live-Koel-shaped control proof                                                |
| Typed `<button><span>Log In</span></button>` submit                                        | observed — descendant-inclusive, exact button-text matching remains intersected with the typed button guard and uniquely resolves the submit.                                          | `exploration-driver.test.ts` nested-span submit regression                                                 |
| Zero semantic candidates after all applicable strategies                                   | blocked — `semantic-unresolved` records phase, zero count, and exact per-strategy counts                                                                                               | D1 driver sad path; `exploration.test.ts` provenance and diagnostic-message regression                     |
| More than one semantic candidate after strategy selection                                  | blocked — `semantic-ambiguous` records the exact candidate count                                                                                                                       | Existing D1 driver sad path                                                                                |
| Zero or more than one typed-submit form scope                                              | blocked — `form-scope-unresolved` or `form-scope-ambiguous` records the exact form count                                                                                               | `exploration-driver.test.ts` typed-submit scope sad path; `exploration.test.ts` classifier regression      |
| Fresh live Koel replay has not run after the crawl/drive symmetry correction               | blocked from a verified claim                                                                                                                                                          | DG-12 campaign rerun remains pending                                                                       |
