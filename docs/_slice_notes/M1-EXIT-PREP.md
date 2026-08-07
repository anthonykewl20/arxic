# M1-EXIT PREP — driving `vulnerable-auth-app` through compile → verify

> Spike slice for **#27 [M1-EXIT]**. References #27; does **not** close it.
> Branch: `spike/m1-exit-second-app`. Status: **gaps-measured + key generality bug fixed**.
> This document is the headline deliverable: honest measurement first, fixes second.

## TL;DR

`vulnerable-auth-app` (Express + ejs + sqlite — server-rendered, single-page, all auth
forms on `/`, deliberately weak) has been driven end-to-end through the **existing generic**
compile → verify machinery alongside the existing `reference-auth-app` (Next.js). With **one
generic compiler fix** (form-scoped submit locators), the Express app's login now
**`verified`** in two clean real-Chromium passes, with **no application-specific generator
code** anywhere in `packages/**/src`. The two apps are structurally different and the same
generic compiler + verifier produce replayable, hash-checked bundles for both.

What did **not** verify, and correctly so: the **shared `authCandidates()` domain pack** is
over-fit to the reference app's routes (it hardcodes `login-page` → `/login`, `url:/`,
`/forgot-password`, `/change-password`). Driven unchanged against Express it yields
`contradicted`/`blocked` — an honest result that exposes a real domain-pack generality gap
(filed as an issue), **not** a compiler/verifier defect.

## How the two apps differ (the structural risk #27 targets)

| Aspect          | `reference-auth-app` (Next.js 15)                                                              | `vulnerable-auth-app` (Express 5)                                                      |
| --------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Rendering       | Client/server components, App Router                                                           | Server-rendered EJS                                                                    |
| Auth UI         | One form **per route** (`/login`, `/forgot-password`, `/change-password`, …)                   | **All four forms on `/`** (login, logout, forgot, reset)                               |
| Login success   | redirect to `/`                                                                                | redirect to `/?message=Logged%20in` (text "Logged in")                                 |
| Password change | `/change-password` route                                                                       | **None**                                                                               |
| TOTP / MFA      | `/mfa/enroll`                                                                                  | **None**                                                                               |
| CSRF            | HMAC sessions + csrf cookie                                                                    | **None** (deliberate weakness)                                                         |
| Rate limiting   | Yes                                                                                            | **None** (deliberate)                                                                  |
| Reset tokens    | Single-use                                                                                     | **Reusable, 7-day** (deliberate)                                                       |
| Fixture seams   | `/__arxic/seed`+`/__arxic/reset` (rewritten to `/api/__arxic/*`), `ARXIC_DB_PATH`, attestation | **Identical contract**: `/__arxic/seed`+`/__arxic/reset`, `ARXIC_DB_PATH`, attestation |

Key finding up front: the **fixture API contract is identical for both apps** (Next.js uses
`next.config.mjs` rewrites to expose `/__arxic/*`). The verifier's `reset.ts` is already
fully generic — **no gap there**.

## What was driven (real engines, real Chromium)

A new shared test helper (`packages/real-world-testkit`) boots either app generically
(`freePort()` + per-run temp sqlite via `ARXIC_DB_PATH` → `mkdtemp`; never the occupied
default port 3001; no Mailpit env). The three real-world suites are now parameterised over
both apps via `describe.each(FIXTURE_APPS)` — **no app-name branching inside
`packages/**/src`**; per-app facts live as data in the testkit.

| Stage                                                                             | reference-auth-app                                  | vulnerable-auth-app                                 |
| --------------------------------------------------------------------------------- | --------------------------------------------------- | --------------------------------------------------- |
| Compile (`PlaywrightCompiler`) — spec discoverable by real Playwright CLI         | ✅ pass                                             | ✅ pass                                             |
| Verify (`PlaywrightVerifier`) — two clean real-Chromium passes                    | ✅ `verified`                                       | ✅ `verified` (**after the fix below**)             |
| Verify locator-drift → `contradicted`                                             | ✅ `contradicted`                                   | (reference-only proof)                              |
| Bundle assembly (`assembleBundle`) + redaction gate + checksums/provenance/NOTICE | ✅ assembles, redaction passes, checksums validated | ✅ assembles, redaction passes, checksums validated |
| Auth domain pack (`authCandidates()`)                                             | 3 `verified`, 3 `blocked`                           | 3 `contradicted`, 3 `blocked` (honest — see gaps)   |

Hash-checked screenshots + traces are produced for every verified run (SHA-256 re-validated
independently in the tests). All `reference-auth-app` proofs remain green — a second app was
**added**, not swapped in.

## Gap list

Each gap is classified: **generality bug** (a real defect in generic machinery), **legitimately blocked** (a capability the app genuinely lacks → correct non-`verified` result), or **fixture gap**.

| #   | Gap                                                                                                                                                                                                                                                                                                                           | Classification                                                                                                                  | §23 criterion at risk                         | Disposition                                                                                                                                                                                                                               |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Compiler emitted **page-global** `getByLabel`/`getByRole`. On Express `/` (4 forms, two "Email" labels) this caused Playwright **strict-mode violations** → `contradicted`.                                                                                                                                                   | **Generality bug** (compiler)                                                                                                   | §23.5, §23.8                                  | **FIXED** — form-scoped submit locators (see below). Express login now `verified`.                                                                                                                                                        |
| 2   | `authCandidates()` is **over-fit to the reference app**: states imply routes (`login-page`→`/login`), assertions hardcode reference paths (`url:/`, `/forgot-password`, `/change-password`). On Express these 404 / mismatch → `contradicted`.                                                                                | **Generality bug** (domain pack) — but out of this spike's scope (proper fix = evidence-driven candidate inference = M1-14/#42) | §23.2, §23.3                                  | **Filed as issue** (see below). Measured honestly; not massaged to `verified`.                                                                                                                                                            |
| 3   | Compiler `url:` assertion is an **exact** `toHaveURL` match. Express login lands on `/?message=Logged%20in`, so a `url:/` assertion would fail. Sidestepped here by using a `text:` assertion for the Express workflow; the **exact-match url semantics remain a latent generality constraint** (query/fragment differences). | **Generality bug** (compiler, latent)                                                                                           | §23.8                                         | **Filed as issue**. Not blocking (workflow can use `text:` assertions).                                                                                                                                                                   |
| 4   | **Single-input submit actions** (e.g. an email-only form) remain ambiguous when ≥2 forms on the page share that label: the form-scoping chain narrows by label intersection, and one label can match multiple forms.                                                                                                          | **Generality bug** (compiler, latent)                                                                                           | §23.5                                         | **Filed as issue**. Not triggered by any current candidate (all such candidates are fixture-blocked); flagged by independent review.                                                                                                      |
| 5   | Compiler goto path is derived from the **state name** (`login-page`→`/login`); a runtime observation is **not** consulted to resolve the route. Single-page apps (Express) must therefore use a state that maps to `/`.                                                                                                       | **Generality constraint** (compiler, by-design today)                                                                           | §23.4                                         | **Filed as issue** (route resolution from runtime observations). Not blocking.                                                                                                                                                            |
| 6   | Password-reset and TOTP workflows are `blocked` for the Express app.                                                                                                                                                                                                                                                          | **Legitimately blocked**                                                                                                        | §23.6, §23.7, §23.11                          | Correct: reset needs the inbox fixture (Mailpit, intentionally not provisioned per slice rules); TOTP does not exist in the Express app. Surfaced as `blocked` with `ARXIC-AUTH-FIXTURE-UNAVAILABLE` / honest evidence — **not** dropped. |
| 7   | The Express app's deliberate weaknesses (enumerating login, reusable 7-day tokens, no CSRF, no rate limit, unsigned cookie) are exercised and **surface as honest runtime behavior** (e.g. login success text, token reuse) — they are **not** "fixed" and **not** hidden.                                                    | **Legitimately blocked / by-design** (fixture)                                                                                  | §23.10 (gates still reject unsafe directives) | No action — these are the point of the fixture. The compile-policy + verification gates treat them as data.                                                                                                                               |

## Fixes landed (generic, no app-name branching)

### Fix for gap #1 — form-scoped submit locators (`packages/playwright-compiler`)

`spec-generator.ts` now scopes every submit-action's label fills + button click to the
`<form>` containing **all** the labelled inputs being filled:

```ts
const form = page
  .locator('form')
  .filter({ has: page.getByLabel('Email') })
  .filter({ has: page.getByLabel('Password') });
await form.getByLabel('Email').fill(process.env['ARXIC_INPUT_PERSONA_EMAIL'] ?? '');
await form.getByLabel('Password').fill(process.env['ARXIC_INPUT_PERSONA_PASSWORD'] ?? '');
await form.getByRole('button', { name: /submit|log in|login|.../i }).click();
```

This is robust for both single-form pages (reference — the filter trivially resolves to the
one form) and multi-form pages (Express — the label intersection uniquely selects the login
form). Semantic `getByLabel`/`getByRole` locators are retained **within** the form scope.

**Policy-gate note (ADR §13 / §23.10):** `page.locator('form')` is a CSS locator, which the
compile-policy gate (`compile-policy.ts`) rejects unless a reviewed rationale is supplied.
The generator declares that rationale through the gate's **existing, designed**
`nonSemanticLocatorDiagnostics` escape hatch, and the compiler passes it to
`enforceCompilePolicy`. The gate **still rejects arbitrary/unrationed CSS** locators
(the existing "blocks a CSS locator without rationale" unit test stays green); only this one
specific, safe, generator-emitted pattern is declared. This was reviewed and approved by two
independent reviewers (consensus: legitimate use of the designed mechanism, not a weakening
of the gate). A follow-up to **scope the rationale to the exact pattern** (rather than the
whole generated source) is filed as an issue.

**Behaviour-preserving for the reference path:** all reference proofs stay green (login,
logout, password-change, locator-drift → `contradicted`). The compiler unit tests (15/15)
stay green; the asserted substrings (`getByLabel("Email")`, `getByRole('button'`, screenshot
paths) are all still present in the form-scoped output.

## Filed issues (linked to #27)

Created in Milestone 1:

- **#86** — Compiler: disambiguate single-input submit actions on multi-form pages (gap #4).
- **#87** — Compiler: derive goto route + relax `url:` assertion semantics from runtime observations (gaps #3 + #5).
- **#88** — Auth domain pack: candidates are over-fit to reference-app routes; drive from evidence/M1-14 (gap #2).
- **#89** — Compiler: scope the non-semantic-locator rationale to the exact emitted pattern (governance follow-up to fix #1).

## §23 acceptance-criteria status (Express app, post-fix)

| #   | Criterion                                         | Status for Express                                                                                        |
| --- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 1   | Deterministic manifest + evidence graph           | ✅ (compile produces a deterministic, validated manifest + evidence index)                                |
| 2   | Evidence-linked or explicit unsupported candidate | ✅ (reset/totp explicit `blocked`; login verified with evidence)                                          |
| 3   | Source-only findings stay `hypothesized`          | ✅ (untouched by this slice)                                                                              |
| 4   | Runtime-only findings stay `observed`             | ⚠️ latent — goto route derived from state name, not runtime obs (gap #5)                                  |
| 5   | Verified auth workflows are independent bundles   | ✅ (Express login verifies → independent bundle)                                                          |
| 6   | Password-reset uses real inbox evidence           | ✅ correct `blocked` (no inbox provisioned)                                                               |
| 7   | TOTP uses real fixture behavior                   | ✅ correct `blocked` (no TOTP in app)                                                                     |
| 8   | Suites pass twice from clean fixtures             | ✅ (two clean Chromium passes for Express login)                                                          |
| 9   | Required artifacts hash-verified                  | ✅ (screenshots + traces SHA-256 re-validated)                                                            |
| 10  | Gates reject secrets/unsafe origins/directives    | ✅ (compile-policy + verification gates intact; rationale mechanism used as designed)                     |
| 11  | Missing behaviors appear as `blocked`             | ✅ (reset/totp/password-change via candidate set)                                                         |
| 12  | Failed runs preserve prior promoted bundle        | (out of this slice's scope — promoter path)                                                               |
| 13  | Output includes licenses/provenance/versions/SBOM | ✅ (bundle assembly produces NOTICE + provenance.json + checksums.sha256; redaction passes for both apps) |
| 14  | Major upgrades pass adapter-contract suites       | (out of this slice's scope)                                                                               |

## What this spike deliberately did NOT do

- Did **not** touch the orchestrator (`packages/orchestrator-langgraph`), CLI, worker,
  `docs/SYNC.md`, `CHANGELOG.md`, or `VERSION` (charter §10.2 / parallel-protocol constraints).
- Did **not** modify the reference-auth-app fixture (its proofs must stay green unchanged).
- Did **not** "fix" the vulnerable app's deliberate security weaknesses — they are the point.
- Did **not** fork `authCandidates()` per app (that would be the app-specific generator code
  #27 forbids); the over-fit is documented + filed instead.
- This is a spike — it **closes no issue** and **merges nothing** (merges are serialized by
  the integrator, charter §10.4).
