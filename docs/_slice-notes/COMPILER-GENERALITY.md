# COMPILER-GENERALITY — staged doc updates (charter §10.2)

Issues: #86, #87, #89 · PR: pending · Disposition: mixed (`observed` and `blocked`)

> ⚠️ **CROSS-SLICE DEPENDENCY — read before merging (#88 / integrator).** #87 is observation-driven, so the vulnerable-auth-app login candidate now `verify`s where it was previously `contradicted` (the old `contradicted` was a false negative: the compiler hardcoded a `/login` goto the Express app does not serve). This **does not touch `packages/auth-domain-pack`** (owned by parallel slice #88), but it **invalidates the stale expectation at `packages/auth-domain-pack/src/real-world.test.ts:74`** (`expect(...login.outcome).toBe('contradicted')`) and the `verified ?? 0 → 0` count at line 77. Until #88 updates the vulnerable-app branch to expect `verified` (and adjusts logout/password-change if they also flip), this slice's `pnpm test` / CI is red on that one test by design. **Merge order:** land #88's expectation update (rebased onto this slice's compiler behaviour) before/with this PR, or have #88 update lines 74–77. Do **not** "fix" it by weakening #87. The reference-auth-app auth-domain-pack path is unaffected (no regression).

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```text
| #86 | [COMPILER-GENERALITY] Disambiguate single-input submits on multi-form pages | ☑ done |
| #87 | [COMPILER-GENERALITY] Use runtime observations for entry routes and URL assertions | ☑ done |
| #89 | [COMPILER-GENERALITY] Scope non-semantic locator rationale | ☑ done |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```text
| 2026-08-07 | **#86/#87/#89 (COMPILER-GENERALITY) compiler generality fixes implemented.** The compiler policy now approves only the reviewed `page.locator('form')` shape; entry navigation uses the observed runtime URL while later transitions retain state-derived routes; `url:` assertions match the exact origin/path while permitting query strings or fragments; submit form scope includes the existing semantic submit-button matcher and an exact-count guard. Real Playwright 1.62.1 Chromium against the vulnerable Express app observed both Email-labelled forms and blocked their residual two-form ambiguity clearly; both fixture apps remained compiler-discoverable. Dispositions: observed and blocked; no deterministic verifier assigned `verified`. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### fixed`

```text
- COMPILER-GENERALITY compiler generality fixes (#86, #87, #89): narrowed reviewed non-semantic locator rationale to the exact form-scope shape, reproduced entry surfaces from runtime evidence, made `url:` assertions exact by origin/path but tolerant of query/fragment suffixes, and added semantic submit-button filtering plus an exact form-count guard. Real Chromium observed the vulnerable Express multi-form surface and both fixture-app compiler proofs remained green.
```

## 4. `VERSION` bump required?

Yes → patch bump selected by the integrator, because generated navigation, assertions, and form targeting are user-observable compiler behavior.

## 5. Evidence pointers

- Real-world proof: `packages/playwright-compiler/src/generality.real-world.test.ts` — real Playwright 1.62.1 Chromium ran against the vulnerable Express fixture, observed two Email-labelled submit forms, and exercised the residual-ambiguity count failure; the same app's runtime `/` observation drove a workflow whose entry state would otherwise derive `/login`.
- Regression proof: `packages/playwright-compiler/src/real-world.test.ts` — the real Playwright CLI discovered generated suites for both the reference Next.js app and vulnerable Express app.
- Artifacts: generated specs in per-run temporary directories; no retained screenshot or trace artifact was added by this compile/locator-mechanic proof.
- Gates: typecheck ☑ · lint ☑ · format ☑ · license ☑ (CI). CI `Test`: **503/504 passed** — the single failure is the cross-slice `auth-domain-pack/src/real-world.test.ts:74` (see handoff above). `m0-pipeline` (13/13, incl. capstone) and all other real-world suites are green in CI. Compiler package: 27 unit + 4 real-world = 31 passing. (A `m0-pipeline` 5s-default timeout seen only under local full-suite load was verified identical on clean `main` and did not reproduce in CI.)

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                                                   | Expected disposition                                                   | Test                                                               |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------ |
| A reviewed form locator appears beside an unrelated CSS, XPath, `page.$`, or bare locator | `blocked`                                                              | `index.test.ts` — unrationed/other locator policy cases            |
| `page.locator('form')` has no reviewed rationale                                          | `blocked`                                                              | `index.test.ts` — missing form-scope rationale case                |
| Two real forms share the Email label and broad submit-button match                        | `blocked` by generated exact-count guard                               | `generality.real-world.test.ts` — residual single-input ambiguity  |
| Runtime entry URL differs from the state-derived path                                     | `observed`                                                             | `generality.real-world.test.ts` — observed entry URL compile proof |
| Current URL has a query or fragment suffix on the expected origin/path                    | `observed` generated assertion semantics; wrong routes remain excluded | `index.test.ts` — independently asserted anchored regex literals   |

The #86 limitation is intentional and explicit: the Workflow IR has no submit-button accessible name. If two forms share both the input label and a button matching the broad submit regex, the generated `toHaveCount(1)` guard surfaces a clear failure; the compiler does not silently choose one or claim to resolve the ambiguity.
