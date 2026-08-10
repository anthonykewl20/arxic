# M2-LOCATOR-POLICY — staged doc updates (charter §10.2)

Issue: refs #116 · PR: TBD · Disposition: **WORK IN PROGRESS — NOT DONE.** Slice C implementation + fix round 1 are on this branch (101 files / 842 tests green). Independent re-review (reviewer-hy3) VERIFIED the 4 original blocking findings (B1–B4) fixed, then found **2 NEW blocking defects (F1, F2) introduced by the fix round** that are **UNRESOLVED**. Do not merge until F1/F2 land and a consensus review passes.

---

## 🔖 RESUME HERE (next session)

**Branch:** `feat/exploration-locator-policy` · **Worktree:** `/home/soultransit/devtony/arxic-wt/locator-policy` · committed + pushed as WIP.

**Done on this branch:** ADR-004 §6 locator policy — semantic+execution locator pairs, ARIA-role allowlist (B1), bounded fill-error redaction (B2), act-through-the-identity-checked-handle (B3), a11y ignored-wrapper flattening + redaction positive/negative controls (B4a), real login transition proof (B4b). Plus NB1–NB7 (fail-closed flag ordering, framenavigated, waitFor-attached, strict-mode→ambiguous, non-required→decision-string, exhaustive switch). Gates green (typecheck/typecheck:packages/lint/format/test 842).

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

## 1. `docs/SYNC.md` — tracker row (NOT YET FINAL — slice incomplete)

```
| #116 | [M2 design + impl] Intent-backed pseudocode (IntentSpec) — ADR-004 design landed; slices A + B landed; slice C (locator policy) IN PROGRESS on `feat/exploration-locator-policy` (fix round 2 pending: F1 credential-scrub + F2 trace-sanitizer ElementHandle allowlist); slices D–F pending | 🚧 in progress (2 of 6 slices + slice C partial) |
```

## 2. `docs/SYNC.md` — session-log row (NOT YET FINAL — do not append until done)

```
| 2026-08-1x | **#116 slice C (M2-LOCATOR-POLICY) <status TBD>.** <final summary after F1/F2 land>. Slice C of 6. Next: slice D. |
```

## 3. `CHANGELOG.md` — entry (NOT YET FINAL)

Awaiting F1/F2 resolution. Draft (update before merge):

```
- M2-LOCATOR-POLICY locator and transition policy (refs #116): <redraft to reflect value-based scrub + ElementHandle sanitizer entry>
```

## 4. `VERSION` bump required?

no — the adapter remains private and the types are an unfrozen M2 intermediate seam.

## 5. Evidence pointers (current; re-verify after F1/F2)

- Real-world proof: `packages/playwright-agent-adapter/src/__tests__/exploration-driver.test.ts` — Playwright 1.62.1 real Chromium; **currently** fills email+password, clicks Login, reaches `${origin}/` with `Logout`. After F1 the signed-in screenshot assertion changes (screenshots suppressed session-lifetime post-fill); the signed-in a11y snapshot must be asserted email-free.
- Gates (current): typecheck ☑ · typecheck:packages ☑ · lint ☑ · test 101 files / 842 ☑ · format:check ☑. Re-run after fix round 2.
- F2 changes the retained-trace content (ElementHandle actions reappear) — add/extend a trace-inspection assertion if practical.

## 6. Sad paths proved (current; extend after fix round 2)

| Trigger                                               | Expected disposition                                                 | Test                                          |
| ----------------------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------- |
| Semantic/execution locator >1 element                 | blocked / LOCATOR-AMBIGUOUS                                          | parameterized ambiguity tests                 |
| Semantic/execution locator 0 elements                 | blocked / LOCATOR-INACCESSIBLE                                       | parameterized inaccessible tests              |
| Both unique but different nodes                       | blocked / LOCATOR-MISMATCH                                           | mismatch test                                 |
| Role contains selector syntax (`>>`)                  | blocked / locator invalid; no action                                 | injected-role tests (**strengthen per F5**)   |
| Multiline fill value in error                         | blocked / STEP_FAILED; no substring persisted                        | multiline fill-error tests                    |
| Identity-checked node replaced pre-action             | blocked / STEP_FAILED; replacement untouched (**strengthen per F6**) | detached-handle Chromium test                 |
| Ignored CDP wrapper holds controls                    | tree retains descendants; values redacted (**re-point per F1**)      | a11y positive/negative controls               |
| Optional locator unresolved                           | observed-degraded decision; no blocked+approved                      | optional unresolved-locator orchestrator test |
| **Mirrored/echoed filled value (F1 — NEW, must add)** | value absent from a11y across navigation                             | mirroring-page negative control (red-first)   |
