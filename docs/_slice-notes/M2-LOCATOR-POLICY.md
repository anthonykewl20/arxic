# M2-LOCATOR-POLICY — staged doc updates (charter §10.2)

Issue: refs #116 · PR: TBD · Disposition: **CODE COMPLETE on branch; PR + CI + post-merge doc fold pending.** Slice C + fix round 1 (B1–B4) + fix round 2 (F1–F11) + fix round 3 (consensus-review numeric-credential closure) all landed locally. Consensus review (reviewer-hy3 + reviewer-deepseek) ran on fix round 2: hy3 APPROVE, deepseek REQUEST CHANGES on a **reproduced numeric-AX-value credential leak** (P1). The reviewers disagreed on the same edge; deepseek's P1 was reproduced red-first by the main agent against real Chromium (`<input type="number">` filled with `123456` retained `"value":123456`), fix round 3 closed it type-agnostically, and the red-first test now passes. Awaiting deepseek confirmation + the integrator's PR/CI/doc-fold.

---

## 🔖 RESUME HERE (next session)

**Branch:** `feat/exploration-locator-policy` · **Worktree:** `/home/soultransit/devtony/arxic-wt/locator-policy` · committed + pushed as WIP.

**Done on this branch:** ADR-004 §6 locator policy — semantic+execution locator pairs, ARIA-role allowlist (B1), bounded fill-error redaction (B2), act-through-the-identity-checked-handle (B3), a11y ignored-wrapper flattening + redaction positive/negative controls (B4a), real login transition proof (B4b). Plus NB1–NB7 (fail-closed flag ordering, framenavigated, waitFor-attached, strict-mode→ambiguous, non-required→decision-string, exhaustive switch). Gates green (typecheck/typecheck:packages/lint/format/test 842).

**Fix round 2 landed locally (not yet final):** F1–F11 are implemented; F1/F2 red-first reproductions and all ordered local gates now pass. Consensus review remains pending, so the slice is still work in progress.

**Fix round 3 (consensus-review finding) — landed locally:** the fix-round-2 consensus review disagreed. reviewer-hy3 APPROVED; reviewer-deepseek REQUEST CHANGES with a P1 it **reproduced against real Chromium**: a numeric-typed AX `value` bypassed the F1 scrub (the containment check at `redactAccessibilityValues` was string-only), so a filled numeric credential leaked — `<input type="number">` filled with `123456` retained `"value":123456`. hy3 had seen the same edge but classified it as by-design/non-blocking ("realistic credentials aren't pure numbers"). **hy3's classification is wrong for arxic**: TOTP (one of the 6 auth-domain-pack candidates) is a 6-digit numeric credential. The main agent reproduced the P1 red-first (new test failed against the string-only scrub with `"value":123456` surviving), then closed it type-agnostically: the containment check now takes the string form of any `string|number` value, so numeric credentials are dropped while benign numerics (sliders, counters) are preserved unless they actually match a filled value. (deepseek's separate P3 — empty-string fill over-redacts quotes — was checked and is invalid: `JSON.stringify('').slice(1,-1)` is `''`, not `'"'`, and the existing `.filter((fragment) => fragment.length > 0)` already drops empty fragments, so no over-redaction occurs. No change made.) Gates after fix round 3: typecheck ☑ · typecheck:packages ☑ · lint ☑ · `exploration-driver.test.ts` 16/16 ☑ (incl. new numeric test + real signed-in proof) · format:check pending the final note edit.

**BLOCKING — must fix before merge (fix round 2, NOT started):**

- **F1 (critical) — credential leak into a11y snapshot + retained PNG.** `redactAccessibilityValues` is structural (drops the value-bearing node's subtree only) and `#pageContainsFilledValue` resets on any main-frame navigation (the NB2 `framenavigated` listener). Reproduced against the real reference app: the signed-in page renders "Logged in as review-user@example.test", so the typed email reaches the post-login a11y snapshot AND a raw full-page `page.screenshot({fullPage:true})` (not routed through `@arxic/playwright-screenshot-privacy`). A mirrored value (`oninput="echo.textContent=this.value"`) also leaks.
  - **Agreed fix:** replace `#pageContainsFilledValue: boolean` with `#filledValues: Set<string>`; `add(step.value)` on a successful fill; **do NOT clear on navigation** (values persist across nav — that's the bug). Recursive value-based scrub of the a11y tree: redact `name`/`description` substrings → `[REDACTED]`, drop a string `value` containing any filled value, keep children (recursively scrubbed — this replaces the lossy structural subtree-drop and catches Chrome's StaticText/InlineTextBox value duplication). Suppress screenshots while `#filledValues.size > 0` (session-lifetime after any fill). Clear only on `close()`. Re-point the negative control at a **mirroring** page; drop the `click login` carve-out; assert the signed-in a11y snapshot does NOT contain the email.
  - **Disclosure candidate if full fix is too large:** proper screenshot privacy requires routing through the #115 masked-page policy (a `screenshotPrivacyPolicy` driver option, like verifier/M0) — tracked as a follow-up that restores post-fill screenshot evidence safely.

- **F2 (high) — fill/click dropped from the retained sanitized trace.** The B3 fix acts through `ElementHandle.fill/click`, which records protocol class `ElementHandle`, but `packages/playwright-trace-sanitizer/src/trace-sanitizer.ts:102-104` `allowedActionPairs` only allowlists `Frame → {click,expect,fill,goto}`. So the sanitizer drops the two actions this slice governs. Reproduced: retained trace after fill+click contains only `context-options`/`newPage`/`goto`.
  - **Agreed fix:** add `['ElementHandle', new Set(['click','fill'])]` to `allowedActionPairs` (one-line additive change; safe — only exploration traces contain ElementHandle actions; verifier/M0 use Locators→Frame; params already stripped to `{}` so no value leak). This edits a shared package — note it in the slice note as a coordinated additive change.

**NON-BLOCKING — fold into fix round 2 (cheap, reviewer-detailed):**

- F3: pass `{ timeout: this.#options.timeoutMs }` to `executionHandle.fill/click` (currently unbounded 30s default).
- F4: `safeErrorMessage` must strip ANSI + drop `Call log:` + length-cap for **all** errors, not only `fill` steps (non-fill errors currently pass through raw, including ANSI).
- F5: the B1 injection test uses `name:'Save'` which makes the payload match nothing (`semantic-inaccessible`) pre-fix too — use a **nameless** `role:'button >> nth=0'` payload so it pins the bypass.
- F6: the B3 rerender test asserts only `ok:false`; strengthen to assert the error matches `/not attached to the DOM/i` and the replacement's value is still empty.
- F8: in `safeErrorMessage`, redact BEFORE the 200-char slice (a value straddling the boundary survives otherwise).
- F9: derive `ARIA_ROLES` from `Record<AriaRole, true>` so a Playwright upgrade that adds a role is a compile error, and remove the last `as AriaRole` cast at the validation boundary.
- F10: wrap `await resolution.executionHandle.dispose()` in `try/catch` so a cleanup rejection can't mask a successful step (matches the `close()` convention).
- F11: `ExplorationStepKind` (exploration-driver.ts:54) is now dead (unused after the `PlannedExplorationStep` discriminated union) — remove it.
- F7 (nit): the orchestrator "multiline fill failure" test feeds a pre-sanitized error, so it's tautological — add a comment that the Action inherits the Service's guarantee, or move the guarantee into the Action.

**After fix round 2:** re-run all gates (typecheck/typecheck:packages/lint/format:check/test — format LAST after editing this note), then a **consensus review (reviewer-hy3 + reviewer-deepseek)** on the final diff, then update sections 1–6 below to honest final form, commit, push, open PR (`refs #116`, no closing keywords).

**Validation ground truth already established this session:** B1 (`getByRole('button >> nth=2').count()===1` bypass) and B4 (raw CDP tree carries email but root has 0 non-ignored children) were reproduced against real Chromium by the main agent before delegating fixes. The reviewer's F1/F2 were reproduced live too. Trust the empirical reproductions over paraphrase.

---

## 1. `docs/SYNC.md` — tracker row (ready for integrator at merge)

```
| #116 | [M2 design + impl] Intent-backed pseudocode (IntentSpec) — ADR-004 design landed; slices A + B landed; slice C (locator policy) landed via PR <N> (consensus-reviewed: F1 credential-scrub incl. numeric AX values + F2 trace-sanitizer ElementHandle allowlist); slices D–F pending | 🚧 in progress (3 of 6 slices) |
```

## 2. `docs/SYNC.md` — session-log row (ready for integrator at merge)

```
| 2026-08-11 | **#116 slice C (M2-LOCATOR-POLICY) landed via PR <N> (CI <status>).** `@arxic/playwright-agent-adapter` `PlaywrightExplorationDriver` enforces ADR-004 §6 locator policy: a semantic locator (role/accessible name) and a stable execution locator must each resolve to exactly one live element and to the SAME element immediately before every normal non-force action; ambiguity/drift/inaccessible controls are diagnostics, not generated assertions. Identity-checked `ElementHandle` act-through (B3) with try/catch disposal (F10). F1 credential-scrub: filled values are tracked session-lifetime in a `Set<string>` (never cleared on navigation), and a recursive value-based scrub redacts the a11y snapshot — `name`/`description` substrings → `[REDACTED]`, any `string|number` `value` whose string form contains a filled value is dropped (children kept), so emails/passwords AND numeric credentials (TOTP/PIN) are removed while benign numerics survive; screenshots are suppressed session-lifetime after any fill (raw full-page screenshots are never routed through screenshot-privacy at this layer — tracked as a #115 follow-up). F2 added `ElementHandle → {click,fill}` to the trace-sanitizer allowlist so the slice's actions survive projection (additive; params already `{}`). Consensus review: reviewer-hy3 APPROVE, reviewer-deepseek REQUEST CHANGES on a reproduced numeric-AX-value leak that hy3 had classified non-blocking — deepseek correct (TOTP is numeric); main agent reproduced it red-first and closed it type-agnostically (fix round 3). Gates green (typecheck/typecheck:packages/lint/test <N> files / <T> tests/format:check). Slice C of 6. Next: slice D. |
```

## 3. `CHANGELOG.md` — entry (ready for integrator at merge)

```
- M2-LOCATOR-POLICY locator and transition policy: semantic+execution locator pairs resolve to the same live element before every non-force action; filled values (incl. numeric credentials) scrubbed session-lifetime from the a11y snapshot; ElementHandle trace actions retained (refs #116)
```

## 4. `VERSION` bump required?

no — the adapter remains private and the types are an unfrozen M2 intermediate seam.

## 5. Evidence pointers (fix round 2 + fix round 3)

- Real-world proof: `packages/playwright-agent-adapter/src/__tests__/exploration-driver.test.ts` — Playwright 1.62.1 real Chromium fills email+password through identity-checked handles, clicks Login, and reaches `${origin}/` with `Logout`; every post-fill observation (including the signed-in transition) excludes both credentials and has no retained screenshot.
- F1 negative control (string): the same file mirrors a successfully filled value into a separate paragraph and proves the recursive AX scrub removes the value while retaining the tree; the pre-existing-value positive control remains visible.
- **F1 negative control (numeric — fix round 3):** the same file fills `123456` into `<input type="number">` and asserts the numeric AX `value` is absent — red against the string-only scrub (`"value":123456` survived), green after the type-agnostic containment fix.
- F2 loop closure: `packages/playwright-trace-sanitizer/src/trace-sanitizer.test.ts` proves complete `ElementHandle.fill` and `ElementHandle.click` before/after pairs survive projection with parameters stripped.
- Gates (fix round 3): typecheck ☑ · typecheck:packages ☑ · lint ☑ · `exploration-driver.test.ts` 16/16 ☑ · full `pnpm test` 101 files / 845 tests ☑ · format:check ☑ (run LAST).

## 6. Sad paths proved (fix round 2 + fix round 3)

| Trigger                                                                           | Expected disposition                                                 | Test                                                                         |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Semantic/execution locator >1 element                                             | blocked / LOCATOR-AMBIGUOUS                                          | parameterized ambiguity tests                                                |
| Semantic/execution locator 0 elements                                             | blocked / LOCATOR-INACCESSIBLE                                       | parameterized inaccessible tests                                             |
| Both unique but different nodes                                                   | blocked / LOCATOR-MISMATCH                                           | mismatch test                                                                |
| Role contains selector syntax (`>>`)                                              | blocked / locator invalid before count or action                     | nameless injected-role test                                                  |
| Multiline fill value in error                                                     | blocked / STEP_FAILED; no substring persisted                        | multiline fill-error tests                                                   |
| Identity-checked node replaced pre-action                                         | blocked / STEP_FAILED with detached-handle error                     | detached-handle Chromium test                                                |
| Ignored CDP wrapper holds controls                                                | tree retains descendants; filled values scrubbed                     | a11y positive/negative controls                                              |
| Optional locator unresolved                                                       | observed-degraded decision; no blocked+approved                      | optional unresolved-locator orchestrator test                                |
| Mirrored/echoed filled value                                                      | value absent throughout the recursively scrubbed AX tree             | mirroring-page negative control (red-first)                                  |
| Navigation after successful credential fill                                       | values remain scrubbed and screenshots remain suppressed             | real signed-in transition proof                                              |
| ElementHandle fill/click trace actions                                            | complete pairs retained with empty params                            | sanitizer projection test (red-first)                                        |
| **Numeric AX value carries a filled credential (fix round 3 — consensus review)** | numeric `value` dropped when its string form contains a filled value | `<input type="number">` negative control (red-first, reproduced the P1 live) |

**Known fail-safe behavior (substring over-redaction):** because the containment check is substring-based, a short filled value that is a substring of an unrelated benign numeric (e.g. fill `5` while a slider sits at `50`) will also drop that numeric. This errs toward redaction (never a leak), matches the existing string-value semantics, and only occurs in a session where a fill has already happened — acceptable, recorded so it isn't mistaken for a bug. A future shared `buildSensitiveFragments` helper could deduplicate the scrub skeleton between `redactAccessibilityValues` and `safeErrorMessage` (non-blocking, out of scope for this security fix).
