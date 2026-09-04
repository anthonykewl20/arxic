# FIX-383-submit-binding — staged doc updates (charter §10.2)

Issue: #383 · PR: <fill at open> · Disposition: observed

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

No milestone tracker row exists for #383 (gate-finding fix, not a milestone
issue); the session-log row below is the tracker deliverable.

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-09-04 (3) | **#383 (FIX-383) compiled submit binding name-or-text DONE.** Root-caused by live reproduction (real koel @ dfec91ff + the campaign AttestationFront + real Chromium 151): the login submit control is a label-wrapped `<button type="submit">Log In</button>` whose accessible name is EMPTY in Chromium's a11y tree (aria snapshot `- button: Log In` — text content only), so the compiled `getByRole('button', { name: "Log In", exact: true })` could never bind — the form filter yielded 0 and both replays failed `expect(form).toHaveCount(1)` (runs 14/15's form-count-0, previously zero-attribution and misattributed as APP-DEFECT). Historical record corrected: run9's artifacts/10.json shows run9 died at the post-goto origin gate (`assets.lemonsqueezy.com`) BEFORE the form selector — the #362 issue's "run9 passed this exact selector" retelling was inferred, never observed (reproduced live with run9's extracted suite). Fix: the spec generator emits `submitControl(root, name)` (name-branch `.or(` exact-text branch, regex-escaped full-text match) for the inventory via-lane and `submitControlByPattern(root, pattern)` for the auth-lane submit list; union semantics keep named controls resolving once and refuse (strict mode) when the branches match DIFFERENT controls — no silent pick, no bare `.first()`, §13.1 policy unchanged (`root.locator('button')` is tag-scoped, not an unapproved CSS shape). Red-first: 3 new real-Chromium tests on the new test-support unnamed-submit app (the captured koel markup shape) all failed pre-fix; compiler suite 92/92, verifier+cli 254/254, orchestrator proposal-compile 16/16 green post-fix with three emission pins updated to the new intended emission (two in playwright-compiler index.test.ts, one in orchestrator-langgraph proposal-compile.test.ts — disclosed). LIVE KOEL PROOF: the exact run14 workflow shape (goto `/#/home`, fill Your email address/Your password, submit via "Log In") compiled through the fixed tree and PASSED against real koel through the campaign front (1 passed, 1.2s) with the ratified origin allow-list — the first koel replay pass ever recorded on the fixed lane. Next: the DG-12 campaigns (model key owner-gated). |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### fixed`

```
- FIX-383 compiled submit binding: name-or-text (#383): generated specs bind submit controls by accessible name OR exact text content (`submitControl`/`submitControlByPattern` helpers) — the captured koel login shape renders a label-wrapped submit whose accessible name is EMPTY in Chromium's a11y tree, so the name-only binding could never resolve it and every replay failed the unique-form assertion (form count 0, misattributed as app defect); union semantics keep named controls resolving once and refuse under strict mode when the branches match different controls. Proven red-first in real Chromium on the captured koel markup shape and live against real koel @ dfec91ff through the campaign attestation front (1 passed).
```

## 4. `VERSION` bump required?

yes in principle (generated spec content changes) — folds into the pending
0.1.1 (never tagged; per the 2026-08-14 re-versioning) — integrator decides
at fold time; no bump in this slice.

## 5. Evidence pointers

- Red-first + regression suite: `packages/playwright-compiler/src/__tests__/submit-binding-race.real-world.test.ts`
  (3 tests: unnamed-submit binding + flow verifies; ambiguous name/text pair
  refuses with strict-mode violation; union-not-sequence emission pin) — all
  three RED pre-fix, GREEN post-fix.
- Test-support app: `packages/playwright-compiler/src/test-support/unnamed-submit-app.ts`
  — the captured koel login markup (placeholders, aria-label="undefined"
  inputs, label-wrapped unnamed submit, role=button anchor), plain + ambiguous
  variants.
- LIVE KOEL PROOF (not a repo test; real third-party target): the run14
  workflow shape compiled through the fixed compiler and executed against
  REAL koel @ dfec91ff through the campaign AttestationFront with the
  ratified origin allow-list — `1 passed (1.2s)`; output pasted on the issue
  and the PR.
- Gates: lint ☑ · typecheck ☑ · typecheck:packages ☑ · format ☑ · compiler
  suite 92/92 ☑ · verifier+cli 254/254 ☑ · full repo suite in PR CI.

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                                        | Expected disposition                                                  | Test                                                                 |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Submit control with EMPTY accessible name (text-only; the captured koel shape) | name-or-text union resolves exactly one — flow verifies (observed)    | `submit-binding-race.real-world.test.ts` — unnamed submit binds      |
| Name-branch and text-branch match DIFFERENT controls                           | strict-mode violation — refusal, no silent pick (contradicted)        | `submit-binding-race.real-world.test.ts` — ambiguous variant refuses |
| Control both named and texted (named-submit apps)                              | union resolves the same element once — no regression (observed)       | existing form-flow/observation suites + the union emission pin       |
| Regex metacharacters in the control text                                       | escaped before the exact-text regex — no pattern injection (observed) | helper emission (regex-escape) + live koel run                       |
