# FIX-312-compiler-placeholder-binding — slice note

Issue: #312 · Status: fixed on this branch, awaiting CI + AC-4 round-8 field proof · Disposition: observed

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
| #312 | [FIX-312-compiler-placeholder-binding] label-kind controls compile to label-first placeholder-fallback locators (the #303 exploration-lane semantics) — placeholder-addressed apps verify | ☑ done (code; AC-4 round 8 pending) |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-08-25 | **#312 (FIX-312-compiler-placeholder-binding) compiler binds placeholder-addressed controls.** Root cause (round-7 field evidence + local probes): the directus login form has ZERO <label> elements — controls addressed only by placeholder; the exploration lane binds them via #303's labelOrPlaceholderLocator, but the compiler emitted getByLabel only, so the compiled formScope matched 0 forms and every verification run failed toHaveCount(0) (run-6's runs[].passed=false was the same failure, masked by the then-current #307 network diagnostic). Fix: the generated spec defines `labelOrPlaceholderControl(root, text) = root.getByLabel(text).or(root.getByPlaceholder(text))` and uses it in BOTH the formScope filters and the field fills; the unique-form (count === 1) fail-closed gate, submit getByRole binding, assertions, and verifier strictness are UNCHANGED. Red-first: contract test (emission shape) + a real-Chromium replay against a placeholder-only login page (test app gained `placeholderAddressed`) both fail pre-fix and pass post-fix. **Next: DG-12 round 8 under #256 (AC-4).** |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### fixed`

```
- FIX-312 compiler placeholder binding (#312): label-kind controls compile to label-first placeholder-fallback locators (`labelOrPlaceholderControl`), matching the exploration lane's #303 semantics — apps whose forms are placeholder-addressed (zero `<label>` elements, e.g. the directus admin login) now scope and replay; the unique-form fail-closed gate and all verifier strictness are unchanged.
```

## 4. `VERSION` bump required?

no — generated-suite emission change only; no shipped contract or schema change.

## 5. Evidence pointers

- Defect evidence: `docs/evidence/DG-12/directus/runs/directus-dg12-run7/` stage-10 (`ARXIC-VERIFY-APP-DEFECT` + `RUN-FAILURE` toHaveCount 0→1 + downstream `SCREENSHOT-INVENTORY-INVALID`); run-6 `runs[].passed=false` (masked by the #307 diagnostic). Local probes: `getByLabel('Email').count() === 0`, `getByPlaceholder('Email').count() === 1`, `getByRole('textbox', { name: 'Email' }).count() === 1` on the live target; the exact driver step fails `semantic-inaccessible` pre-#303-code and resolves post-#303-code.
- Fix: `packages/playwright-compiler/src/spec-generator.ts` — helper emitted in the spec preamble; both formScope filter builders and both field-fill emitters route through it; `nonSemanticLocatorRationale` wording updated to disclose the fallback.
- Red-first tests: `packages/playwright-compiler/src/index.test.ts` `'#312 label-kind controls compile to label-first placeholder-fallback locators'` (red pre-fix: emission was `getByLabel` only); `packages/playwright-compiler/src/observation-form-flow.real-world.test.ts` `'#312 placeholder-addressed controls replay (real Chromium)'` — real app (`placeholderAddressed: true`), compile, EXECUTE the suite (red pre-fix at the spec-shape assertion; post-fix the suite itself passed 1/1 through form-scope → fill → submit → /dashboard assertions).
- Contract updates disclosed: three existing tests pinned the old `getByLabel(...)` emission (`policy-safe staged bundle`, `camel-case labels`, verifier `spec drift` mutation target) — updated to the helper form; the drift test still drifts the FIELD locator to a non-binding name and is still caught by the artifact-hash gate before execution.
- Gates: playwright-compiler + verifier 175/175; cli/m0-pipeline/bundle-promoter/intent-proposal-spike 320/320; typecheck/lint clean; `format:check` after this note: `All matched files use Prettier code style!`

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                    | Expected disposition                                                                                            | Test                                                        |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| placeholder-only controls (zero `<label>`) | form scopes to exactly 1; fills land; submit reaches the observed state (observed, real Chromium)               | `#312 placeholder-addressed controls replay`                |
| labelled controls (regression)             | bind by label first — same helper, label branch wins (observed: DG-09 labelled compile+capture tests unchanged) | existing DG-09 describe                                     |
| spec drift on a field locator              | blocked by the artifact-hash gate BEFORE execution (observed)                                                   | `blocks a staged spec drift before execution`               |
| ambiguous formScope (two scoped forms)     | fails closed at `toHaveCount(1)` — emission unchanged by this slice                                             | emitted gate (unchanged); covered by the formScope contract |

## 7. Not done / known-weak spots

- AC-4 (real directus round-8 stage-10 passes binding and reaches real assertion results) executes under #256 after this merges — this slice's real-world proof is the fixture-app replay.
- The fallback widens the LOCATOR, not the gate: a page that addresses two different controls with the same placeholder+label text still fails the unique-form/count-1 gates (fail-closed preserved).
- `getByRole('textbox', { name })` (accessible-name placeholder fallback) was considered and NOT taken: it changes the kind of the locator (role-kind) rather than extending the label-kind binding; the #303 exploration semantics are the reference (AC-1/AC-5).
