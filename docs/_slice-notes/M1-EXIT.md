# M1-EXIT — staged doc updates (charter §10.2)

Issue: #27 · PR: #110 · Disposition: mixed (27/28 measurements MET; 1 UNMET → blocks exit)

This is a **gate, not a slice**: it adds no capability. It measures the merged
tree (`fed2358`) against ADR §23's 14 acceptance criteria for **both** fixture
apps and reports the truth. Every MET below is backed by a real-world observation
(real Tree-sitter, real `sg`, real Crawlee/Chromium, real Playwright, real Docker,
real Mailpit/otplib) against the real fixture apps; a unit test alone is never cited
as §23 evidence. The full suite was run **twice from clean state**, both green
(81 files / 534 tests, exit 0, each run) — see §23.8.

**Verdict: M1 does NOT exit.** One criterion is unproven for the Express app:
§23.12 (failed run preserves prior promoted bundle) has never been exercised
end-to-end for `vulnerable-auth-app`. Filed as #109. Everything else is MET for both
apps; `reference-auth-app` is 14/14.

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
| #27 | [M1-EXIT] Gate: two apps replay, no app-specific code | ☐ gate measured (refs #27): reference 14/14 · vulnerable 13/14 MET; §23.12 unproven for Express → #109. Exit is the integrator's call. |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-08-08 | **#27 (M1-EXIT) gate MEASURED — does not pass yet (refs #27, does not close it).** The merged tree (`fed2358`) was measured against all 14 ADR §23 criteria for both fixture apps with no new product code. Full suite run twice from clean state, both green (81 files / 534 tests, exit 0). Result: `reference-auth-app` 14/14 MET; `vulnerable-auth-app` 13/14 MET. Re-measured the three #91 gaps: §23.4 is now MET for Express (the #87/#100 compiler fix resolves entry navigation from the observed runtime URL — `generality.real-world.test.ts` asserts `goto(origin + '/')` not `goto(origin + '/login')`, and the verifier verifies Express login in two clean Chromium passes); §23.14 is MET for both (the §23.14 adapter-contract gates exist for every adapter, pin exact versions — Playwright 1.62.1 rejects drift — and pass; ast-grep's exercises Express source); §23.12 stays UNMET for Express — failed-run-preserves-prior-bundle is proven for reference (`m0-pipeline`) and app-agnostically (`bundle-promoter`) but never exercised end-to-end for the Express app → filed #109 (test gap, not a defect). Criteria 6/7 are correctly `blocked` for Express (no provisioned inbox / no TOTP capability) and count as MET per #27 guidance. §23.10 MET for both, with the Service Worker path NOT covered (#108). No app-specific code in the M1 generator path; the only app-specific non-test source is the M0-era `m0-pipeline` (nextjs/reference nonce), not used by the two-app flow. `docs/_slice-notes/` was empty apart from README/_TEMPLATE before this note (§10.2 exit condition held). |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### internal`

```
- M1-EXIT gate measurement (#27, refs — does not close it): the merged tree was measured against all 14 ADR §23 acceptance criteria for both fixture apps with no new product code and no weakening of any test. `reference-auth-app` measures 14/14 MET; `vulnerable-auth-app` measures 13/14 MET. The full suite passed twice from clean fixtures (81 files / 534 tests each run). The three #91 de-risk gaps were re-measured: §23.4 (runtime-only stays observed / entry navigation) is now MET for Express via the #87/#100 compiler fix proven in `generality.real-world.test.ts` + the verifier real-world suite; §23.14 (adapter-contract suites) is MET for both — the §23.14 contract gates exist for every adapter, pin exact engine versions (Playwright 1.62.1 rejects drift), and pass, with ast-grep's gate exercising Express source; §23.12 (failed run preserves prior promoted bundle) remains UNMET for Express — proven for reference (`m0-pipeline`) and app-agnostically (`bundle-promoter`) but never exercised end-to-end for the Express app, filed as #109 (a test/measurement gap, not a product defect). Criteria 6 (reset inbox) and 7 (TOTP) are correctly `blocked` for Express and count as MET per the #27 guidance. §23.10 is MET for both with the Service Worker path explicitly not covered (#108). No application-specific code exists in the M1 generator path (`playwright-compiler`, `verifier`, `reconciler`, `auth-domain-pack`, `bundle-promoter`, `orchestrator-langgraph`, `crawlee-adapter`, `evidence-graph`); per-app facts live as data in `@arxic/real-world-testkit`.
```

## 4. `VERSION` bump required?

no — `RELEASES.md` reserves `0.2.0` for M1-EXIT, but the gate does **not** pass
(§23.12 unproven for Express) and the bump is the integrator's call once the gate
actually passes. Measuring is a separate decision from releasing. `VERSION` stays
`0.0.0`.

## 5. Evidence pointers

- Real-world proof (both apps, parameterised via `describe.each(FIXTURE_APPS)` unless noted):
  - Determinism / evidence graph: `packages/evidence-graph/src/__tests__/real-world.test.ts`, `packages/source-ua-adapter/src/__tests__/real-world.test.ts`
  - Hypothesized / observed / blocked reconciliation: `packages/reconciler/src/__tests__/real-world.test.ts`, `packages/ast-grep-adapter/src/__tests__/real-world.test.ts`
  - Entry-navigation generality (#87): `packages/playwright-compiler/src/generality.real-world.test.ts`
  - Compile / verify / independent bundles / two clean passes / hash-verified artifacts: `packages/playwright-compiler/src/real-world.test.ts`, `packages/verifier/src/real-world.test.ts`
  - Assembly / licenses / provenance / redaction: `packages/bundle-promoter/src/__tests__/assembly-real-world.test.ts`
  - Reset inbox + TOTP fixtures: `packages/fixture-mailpit/src/real-world.test.ts` (reference), `packages/fixture-otplib/src/index.test.ts`
  - Domain-pack dispositions (blocked reporting): `packages/auth-domain-pack/src/real-world.test.ts`
  - Gates reject unsafe origin/directive: `packages/policy-engine/src/__tests__/real-world.test.ts`, `packages/crawlee-adapter/src/__tests__/real-world.test.ts` (reference)
  - Failed-run preservation (reference only): `packages/m0-pipeline/src/__tests__/real-world.test.ts`, `packages/bundle-promoter/src/__tests__/real-world.test.ts`
  - §23.14 adapter-contract gates: `packages/*/src/__tests__/contract-gate.test.ts`
- Full-suite reproducibility: two clean runs, `Test Files 81 passed (81)` / `Tests 534 passed (534)` / exit 0 each (see `docs/evidence/M1-EXIT/measurement-summary.md`).
- Gates: typecheck ☑ · lint ☑ · format ☑ · test (534 passing) ☑ · license gate (0 rejected) ☑
- App-specific-code audit: only `packages/m0-pipeline/src/pipeline.ts` (M0-era capstone; nextjs framework + reference attestation nonce), not part of the M1 two-app generator path.

## 6. Sad paths proved (each mapped to a truth state, charter §4)

The gate's sad paths are the criteria that did **not** reach MET and the honest
`blocked` dispositions it confirmed. Full §23 acceptance table (14 criteria × 2
apps) below — MET requires a real-world observation; a correct `blocked` counts as
MET per #27; UNMET is classified.

| #   | Criterion                                               | reference-auth-app | vulnerable-auth-app         | Evidence (test path + what ran)                                                                                                                                                                                                                                                                                                                           |
| --- | ------------------------------------------------------- | ------------------ | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Deterministic manifest and evidence graph               | MET                | MET                         | `evidence-graph/…/real-world.test.ts` (both): canonical graph byte-identical across rebuilds; `source-ua-adapter/…/real-world.test.ts`: repeated Tree-sitter extraction identical                                                                                                                                                                         |
| 2   | Evidence-linked or explicit unsupported candidates      | MET                | MET                         | `reconciler/…/real-world.test.ts` (both): login evidence-linked, `express.csrf`→`blocked` `ARXIC-RECON-UNSUPPORTED`; `auth-domain-pack/…/real-world.test.ts` (both)                                                                                                                                                                                       |
| 3   | Source-only findings stay hypothesized                  | MET                | MET                         | `ast-grep-adapter/…/real-world.test.ts` (both): real `sg` login chain `truthState:'hypothesized'`; reconciler: no verified transition coverage                                                                                                                                                                                                            |
| 4   | Runtime-only findings stay observed                     | MET                | MET                         | ref: reconciler runtime-only→`observed`. vuln: `playwright-compiler/generality.real-world.test.ts` (#87) asserts `goto` from observed runtime URL not state name + `verifier/…/real-world.test.ts` verifies Express login; Express has no runtime-only routes so the reconciler path is vacuous there                                                     |
| 5   | Verified auth workflows are independent bundles         | MET                | MET                         | `verifier/…/real-world.test.ts` (both): independent boot/compile/verify→`verified`; `bundle-promoter/…/assembly-real-world.test.ts` (both)                                                                                                                                                                                                                |
| 6   | Password-reset uses real inbox evidence                 | MET                | MET (correct `blocked`)     | ref: `fixture-mailpit/…/real-world.test.ts` real reset email via Mailpit, token extracted. vuln: reset `blocked` `ARXIC-AUTH-FIXTURE-UNAVAILABLE` (no provisioned inbox) — correct `blocked`, not a false `verified`                                                                                                                                      |
| 7   | TOTP/recovery uses real test fixture behavior           | MET                | MET (correct `blocked`)     | ref: `fixture-mailpit/…/real-world.test.ts` real otplib generate+validate; `fixture-otplib/index.test.ts`. vuln: no TOTP capability→`blocked` `ARXIC-AUTH-CAPABILITY-UNSUPPORTED` — correct `blocked`                                                                                                                                                     |
| 8   | Suites pass twice from clean fixtures                   | MET                | MET                         | `verifier/…/real-world.test.ts` (both): `runs=[{passed},{passed}]`, `resetAndSeedFixtures` before each run; `m0-pipeline` (ref) runs twice; full suite run twice from clean, both green                                                                                                                                                                   |
| 9   | Required artifacts are hash-verified                    | MET                | MET                         | `verifier/…/real-world.test.ts` (both): SHA-256 of every screenshot/trace matches; `bundle-promoter/…/assembly-real-world.test.ts` (both): every `checksums.sha256` recalculated                                                                                                                                                                          |
| 10  | Gates reject secrets, unsafe origins, unsafe directives | MET                | MET                         | `policy-engine/…/real-world.test.ts` (live attestation): evil origin→`ARXIC-POLICY-ORIGIN-DENIED`, unapproved destructive→`ARXIC-POLICY-DESTRUCTIVE-WITHOUT-APPROVAL`; `crawlee-adapter/…/real-world.test.ts`: destructive form→`ARXIC-SURFACE-002`, mutation state unchanged; compile-policy rejects secrets. **Service Worker path NOT covered (#108)** |
| 11  | Missing behaviors appear as blocked                     | MET                | MET                         | `auth-domain-pack/…/real-world.test.ts` (both): reset/TOTP/password-change `blocked` with diagnostics; reconciler (vuln) CSRF→`blocked`                                                                                                                                                                                                                   |
| 12  | Failed runs preserve prior promoted bundle              | MET                | **UNMET** (test gap → #109) | ref: `m0-pipeline/…/real-world.test.ts` dirty source→`blocked`, prior bundle intact. vuln: never exercised end-to-end; mechanism proven app-agnostically (`bundle-promoter`) but no Express failed-run test                                                                                                                                               |
| 13  | Output includes licenses, provenance, versions, SBOM    | MET                | MET                         | `bundle-promoter/…/assembly-real-world.test.ts` (both): `provenance.json` commit/appBuildDigest/generator version + `NOTICE` MIT; `scripts/license-gate.mjs` 0 rejected; CI CycloneDX SBOM                                                                                                                                                                |
| 14  | Major upgrades pass adapter-contract suites             | MET                | MET                         | `packages/*/…/contract-gate.test.ts` (explicit §23.14 gates): playwright-agent pins 1.62.1 + rejects drift, source-ua `AsyncIterable<EvidenceEvent>` shape, ast-grep uses Express source; all pass. No major upgrade performed — these gates are the forward-looking catch mechanism                                                                      |

**Totals:** reference-auth-app **14/14 MET** · vulnerable-auth-app **13/14 MET, 1 UNMET**.

**UNMET, classified:** §23.12 → **test/measurement gap** (not a generality bug, not
an absent capability, not a product defect) → filed **#109**. The promoter is
app-agnostic and the preservation mechanism is proven with real filesystem
operations and end-to-end for reference; what is missing is an Express end-to-end
failed-run test.

**§23.10 Service Worker path:** NOT covered — see #108. The crawler's cross-origin
and non-safe-method aborts are page-scoped `page.route`, and Service Worker traffic
bypasses them (`serviceWorkers:'block'` is never set). Neither fixture app registers
a Service Worker, so the bypass is latent, not exercised. §23.10 is marked MET on the
strength of the policy-engine + crawlee + compile-policy gates, with this caveat
disclosed rather than papered over.

**Does M1 exit? NO.** Blocker: §23.12 is unproven for `vulnerable-auth-app`. This is
a test gap (closeable by a generic `FIXTURE_APPS`-parameterised failed-run test), not
a product defect. All other 13 criteria are MET for both apps; reference is 14/14.
Whether the gap blocks exit, or the generic-mechanism proof is accepted, is the
integrator's call on this evidence.
