# M1-EXIT-23-12 evidence summary

Branch: `feat/m1-exit-23-12`
Issue: refs #109 (regenerate the ADR §23.12 failed-run-preserves-prior-bundle proof through
the now-safe pipeline; remeasure #27 against ADR §23). `#27` stays open.

Tested working tree: rebased `feat/m1-exit-23-12` at `21edb35` onto `cc38462` (`origin/main`),
with the `packages/bundle-promoter/README.md` rebase conflict resolved (both the current-main
trace-artifact-gate paragraph and the #109 real-world-proof paragraph retained).

Environment: Linux x86_64 · Node `v24.19.0` · pnpm `11.17.0` · Playwright `1.62.1` / Chromium
`151.0.7922.34` · per-run `mkdtemp` sqlite databases · ephemeral app ports via `freePort` ·
`ARXIC_MAILPIT_SMTP` / `ARXIC_MAILPIT_API` unset (each run gets its own Mailpit Testcontainer
on random ports).

## Command

```text
ARXIC_EVIDENCE_DIR="$PWD/docs/evidence/M1-EXIT-23-12" \
  pnpm exec vitest run packages/bundle-promoter/src/__tests__/promotion-real-world.test.ts
```

## Focused result (2026-08-10)

```text
Test Files  1 passed (1)
     Tests  2 passed (2)
  Duration  ~14–17s
```

Both fixture apps are driven by one generic `describe.each(FIXTURE_APPS)` body. There is no
application-name branch in the proof or in `@arxic/bundle-promoter`; per-app facts remain data
in `@arxic/real-world-testkit`.

| Fixture app           | Compile | Clean Chromium run 1 | Clean Chromium run 2 | Coherent projection (`#112`) | Initial promotion (B1) | Blocked subsequent promotion                                  | Prior public bytes byte-identical |
| --------------------- | ------- | -------------------- | -------------------- | ---------------------------- | ---------------------- | ------------------------------------------------------------- | --------------------------------- |
| `reference-auth-app`  | pass    | pass (`verified`)    | pass (`verified`)    | pass (id+status agree)       | pass (receipt)         | `blocked` `ARXIC-PROMOTION-ATOMIC-REPLACE-FAILED`, no receipt | pass                              |
| `vulnerable-auth-app` | pass    | pass (`verified`)    | pass (`verified`)    | pass (id+status agree)       | pass (receipt)         | `blocked` `ARXIC-PROMOTION-ATOMIC-REPLACE-FAILED`, no receipt | pass                              |

Flow per app: compile (`@arxic/playwright-compiler`) → two-pass real-Chromium verify
(`@arxic/verifier`, `runs === [{passed:true},{passed:true}]`, artifacts include `screenshot` +
`trace` + `trace-sanitization-report`) → action-owned coherent projection
(`projectVerifiedBundle`, #112) → atomic promotion of B1 → a subsequent candidate that carries
the **same accepted artifacts** (so it clears the integrity, trace `#111`, and screenshot
privacy `#115` gates) but different frozen bytes is forced to fail at the atomic-replace step
by turning `<public>.lkg` into a directory → the public path is then reread independently and
asserted byte-identical to the captured B1 bytes (`readFile(publicPath) === freezeBundle(B1)`).

## Full local suite + gates (2026-08-10)

The supervising agent re-ran the whole gate set on this head before the final local commit; the
branch was not pushed or merged:

```text
env -u ARXIC_MAILPIT_SMTP -u ARXIC_MAILPIT_API pnpm test
  => exit 0 · Test Files 94 passed (94) · Tests 765 passed (765) · Duration 318.40s

pnpm typecheck && pnpm -r typecheck && pnpm lint && pnpm format && pnpm format:check \
  && node scripts/license-gate.mjs
  => exit 0  (recursive typecheck scope 25/26 packages;
              format:check final line: "All matched files use Prettier code style!";
              license gate: 782 total / 780 allowed / 2 excepted / 0 rejected)
```

The focused `promotion-real-world` suite was re-run in the same pass and is still 2/2 (both apps).
These are local results; CI has not run on this head (not pushed/merged), so the final `#27` gate
verdict remains the integrator's call.

## Retained safe artifacts (policy-compliant — `#111` + `#115`)

No raw Playwright trace and no unredacted screenshot is retained. Every retained artifact is
gated:

- Screenshots — `masked-page` PNGs (1280×720) captured under the action-owned
  `ScreenshotPrivacyPolicy` (`mode: masked-page`, `masks: [{role: main}]`), each carrying an
  adjacent `.png.privacy.json` attestation (`@arxic/verifier` attester, binding + policy +
  correlation SHA-256). Example: `reference-auth-app/.../001-step-1-login-page-home.png` (4367
  bytes) + `.privacy.json`.
- Traces — sanitized Playwright action timelines (`.zip`) each carrying an adjacent
  `.zip.sanitization.json` sidecar from `@arxic/playwright-trace-sanitizer`. Example: source
  61928 bytes → 6447-byte sanitized timeline, 34 retained actions, `residualScan.passed`. The
  four retained timelines are intentionally byte-identical after the app-invariant sanitizing
  projection; each sidecar binds its timeline to the distinct source trace SHA-256.

```text
docs/evidence/M1-EXIT-23-12/{reference-auth-app,vulnerable-auth-app}/verification/run-{1,2}/
  *-*.png                       # masked-page screenshot
  *-*.png.privacy.json          # #115 attestation
  trace-001.zip                 # sanitized action timeline (#111)
  trace-001.zip.sanitization.json
docs/evidence/M1-EXIT-23-12/{reference-auth-app,vulnerable-auth-app}/promotion-outcome.json
  # §23.12 proof snapshot: promoted vs subsequent checksum (they differ), the single
  # blocked ARXIC-PROMOTION-ATOMIC-REPLACE-FAILED diagnostic (EISDIR on the LKG rename),
  # and the clean final promotion-directory listing (bundle + .lkg, no residue).
```

The test itself pins the §23.12 property load-bearingly: `failed.receipt === undefined`, exactly
one `ARXIC-PROMOTION-ATOMIC-REPLACE-FAILED` diagnostic whose message references `${publicPath}.lkg`
(pinning the failure to the LKG-snapshot rename, not an earlier gate), the `.lkg` directory still
present, `readFile(publicPath) === promotedBytes`, the promotion directory listing is exactly
`[<bundle>, <bundle>.lkg]`, and `promotedBytes === freezeBundle(B1)`. It also asserts the verifier
captured exactly two of each artifact kind (`screenshot`, `screenshot-privacy-report`, `trace`,
`trace-sanitization-report`) across the two clean runs, and that `#112` coherence
(`manifest.workflow === {id, status:'verified'}`) survives the promoter's JSON round-trip on the
shipped bytes — not only in memory.

### Note on the masked screenshots (deliberate choice)

The retained screenshots are `masked-page` captures with `masks: [{role: main}]`, so on these
fixtures the meaningful page region is blacked out (the reference login PNG is ~2 colours; the
Express one ~6). This is privacy-correct and is the policy shape #115 asks the action owner to
supply; their proof value here is the attestation chain (binding + policy + correlation SHA-256)
plus the test assertions, not pixel content. A human visual inspection of retained screenshots is
the standing #115 residual (an LLM cannot prove arbitrary pixels secret-free). An `approved-region`
policy on a heading (as `projection-real-world.test.ts` uses) would yield more inspectable pixels
and is an option for a future evidence pass; it is not needed for §23.12.

## ADR §23 — 14 criteria × 2 apps (draft; proof-pointer referenced)

Convention: **MET** = evidenced by a real-world suite/CI in the merged tree; **PARTIAL** = MET
with a carried caveat (a proof leg is generic-only, unexercised for the app, or absent from the
bundle output); **UNMET** = no end-to-end proof. **No cell below is a `verified` truth state
(ADR §2); this is a draft measurement, not a gate verdict.** This pass ran the full local suite
plus every repo gate green (see "Full local suite + gates" above); criteria other than §23.12 are
carried from the #110 measurement (`docs/SYNC.md:187`) and the
merges that followed (#108 via PR #113, #111, #112, #114 via PR #120, #115). CI has not run on
this head (changes not pushed/merged), so the final `#27` gate verdict remains the integrator's
call. ADR §23 criteria list: `docs/adr/001-arxic-architecture.md:738-753`.

| #   | Criterion (ADR §23)                                     | reference-auth-app                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | vulnerable-auth-app (Express)                                                                                                                                                                                                                                                                                                                                                                          |
| --- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Deterministic manifest and evidence graph               | MET — deterministic frozen B1 bytes asserted (`promotion-real-world.test.ts:121-125`); `@arxic/evidence-graph` determinism.                                                                                                                                                                                                                                                                                                                                                                                                                             | MET — same `describe.each(FIXTURE_APPS)` body (`:30`); the same frozen-byte assertion runs for this app (`:121-125`).                                                                                                                                                                                                                                                                                  |
| 2   | Evidence-linked or explicit unsupported candidates      | MET — reconciler blocked/unsupported reporting (`reconciler/src/reconcile.ts:141-178`); two-app proof (`reconciler/src/__tests__/real-world.test.ts:115-142`).                                                                                                                                                                                                                                                                                                                                                                                          | MET — same reconciler; Express additionally exercises blocked/contradicted CSRF rows (`reconciler/src/__tests__/real-world.test.ts:128-138`).                                                                                                                                                                                                                                                          |
| 3   | Source-only findings stay hypothesized                  | MET — schema rejects `verified` w/o runtime evidence (`contracts/src/workflow.ts:146-154`, test `workflow.test.ts:101-107`); inference stays `hypothesized` in a real run (`orchestrator-langgraph/src/__tests__/inference-real-world.test.ts:122-158,160-196`).                                                                                                                                                                                                                                                                                        | PARTIAL — the schema rule is generic (`workflow.ts:146-154`), but no real-world inference run exercises Express (real-world inference proof is reference/Next.js only, `inference-real-world.test.ts:27,46-70`); generic applicability is inference the integrator must confirm by observation.                                                                                                        |
| 4   | Runtime-only findings stay observed                     | MET — reconciler emits runtime-only→`observed` (`reconcile.ts:230-249`); two-app proof shows the runtime-only row for this app (`reconciler/src/__tests__/real-world.test.ts:139-141`); entry nav resolved from observed URL (`playwright-compiler/src/spec-generator.ts:16-39`).                                                                                                                                                                                                                                                                       | PARTIAL — compiler observed-URL entry nav IS evidenced for Express (`playwright-compiler/src/generality.real-world.test.ts:50-70`), but the reconciler runtime-only→`observed` half is vacuous for Express (no runtime-only routes; `observed`/`runtime-only` rows asserted absent at `reconciler/src/__tests__/real-world.test.ts:122-124`), so that mechanism is unexercised end-to-end for Express. |
| 5   | Verified auth workflows are independent bundles         | MET — `describe.each(FIXTURE_APPS)` (`:30`); independent atomic bundle promoted via `BundlePromoterAdapter` (`:118-125`).                                                                                                                                                                                                                                                                                                                                                                                                                               | MET — same body for this app (`:30,118-125`).                                                                                                                                                                                                                                                                                                                                                          |
| 6   | Password-reset uses real inbox evidence                 | MET — real Mailpit inbox + reset-token extraction (`fixture-mailpit/src/real-world.test.ts:83-126`); reset candidates gated by the inbox fixture (`auth-domain-pack/src/candidates.ts:67-85`).                                                                                                                                                                                                                                                                                                                                                          | MET (blocked counts) — no provisioned inbox/reset route (`real-world-testkit/src/index.ts:273-278`) → reset candidates correctly `blocked` with `ARXIC-AUTH-FIXTURE-UNAVAILABLE` (`auth-domain-pack/src/candidates.ts:67-85`; `auth-domain-pack/src/real-world.test.ts:54-63`); #110 measurement convention recorded at `docs/SYNC.md:187`.                                                            |
| 7   | TOTP/recovery uses real test fixture behavior           | MET — real otplib TOTP (`fixture-mailpit/src/real-world.test.ts:83-126`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | MET (blocked counts) — `totp.supported: false` (`real-world-testkit/src/index.ts:273-278`) → TOTP candidate correctly `blocked` as capability-unsupported (`auth-domain-pack/src/candidates.ts:118-122`; `auth-domain-pack/src/real-world.test.ts:72-74`); #110 measurement convention recorded at `docs/SYNC.md:187`.                                                                                 |
| 8   | Suites pass twice from clean fixtures                   | MET — `runs === [{passed:true},{passed:true}]` (`promotion-real-world.test.ts:68-86`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | MET — same assertion for this app (`:68-86`).                                                                                                                                                                                                                                                                                                                                                          |
| 9   | Required artifacts are hash-verified                    | MET — staged SHA-256 manifest entries are constructed at `promotion-real-world.test.ts:94-102`, exact required artifact counts are asserted at `:77-86`, and successful promotion at `:118-125` demonstrates the integrity/trace/screenshot gates accepted them; gate implementations: `bundle-promoter/src/trace-artifact-gate.ts:41-43,129-149` and `playwright-screenshot-privacy/src/attestation.ts:433-451,493-509`.                                                                                                                               | MET — the same artifact assertions and successful gated promotion run for this app (`:30,77-86,94-125`).                                                                                                                                                                                                                                                                                               |
| 10  | Gates reject secrets, unsafe origins, unsafe directives | MET — compile-policy (`playwright-compiler/src/index.test.ts:45-55,57-68,127-141`); surface default-deny (`crawlee-adapter/src/__tests__/sad-paths.test.ts:41-53,75-92`); merged #108 Service-Worker containment via PR #113 (`crawlee-adapter/src/adapter.ts:302-315` sets `serviceWorkers:'block'`; real hostile-server containment `crawlee-adapter/src/__tests__/service-workers.real-world.test.ts:91-119`); redaction (`bundle-promoter/src/__tests__/assembly.test.ts:13-40`; `orchestrator-langgraph/src/__tests__/sad-paths.test.ts:188-215`). | MET — the same app-agnostic security gates apply; Service-Worker containment is proven against a purpose-built hostile HTTP fixture (`service-workers.real-world.test.ts:17-59,91-119`), not against either auth fixture app.                                                                                                                                                                          |
| 11  | Missing behaviors appear as blocked                     | MET — reconciler blocked reporting (`reconcile.ts:141-178`); verifier blocked classification (`verifier/src/classify.ts:69-119`); sad paths (`m0-pipeline/src/__tests__/sad-paths.test.ts:109-139`; `orchestrator-langgraph/src/__tests__/sad-paths.test.ts:125-136`).                                                                                                                                                                                                                                                                                  | MET — same blocked-classification machinery; Express CSRF candidate lands `blocked`/`contradicted` (`reconciler/src/__tests__/real-world.test.ts:128-138`).                                                                                                                                                                                                                                            |
| 12  | Failed runs preserve prior promoted bundle              | MET (this slice) — blocked subsequent promotion, no receipt, exact prior bytes (`promotion-real-world.test.ts:132-154`).                                                                                                                                                                                                                                                                                                                                                                                                                                | MET (this slice) — same body for this app (`:30,132-154`).                                                                                                                                                                                                                                                                                                                                             |
| 13  | Output includes licenses, provenance, versions, SBOM    | PARTIAL — bundle ships `provenance.json`, `NOTICE`, versions, `checksums.sha256` (`bundle-promoter/src/bundle-assembler.ts:82-93,160-177`); license gate green (`scripts/license-gate.mjs:33-47,60-70`); **but the CycloneDX SBOM is a CI-only artifact (`.github/workflows/ci.yml:83-91`) and is NOT written into the promoted bundle** (`bundle-assembler.ts:82-93,160-177` emits no `sbom.cdx.json`).                                                                                                                                                | PARTIAL — same bundle-output shape; the SBOM-in-bundle gap is app-agnostic.                                                                                                                                                                                                                                                                                                                            |
| 14  | Major upgrades pass adapter-contract suites             | MET — contract-gate suites exist across adapter packages (e.g. `ast-grep-adapter/src/__tests__/contract-gate.test.ts:8-20`); #114 Dependabot remediation merged as PR #120 (commit `f20f930`; Next 15→16, nodemailer 7→9, …) with CI PASS running the full suite + contract gates: https://github.com/anthonykewl20/arxic/actions/runs/31366406414/job/93385623727 .                                                                                                                                                                                    | MET — that CI run covered both fixture apps and every contract gate.                                                                                                                                                                                                                                                                                                                                   |

Net change versus the #110 measurement (`docs/SYNC.md:187`):
§23.12 moves from UNMET-for-Express to evidenced for **both** apps by this slice. §23.10's #110
caveat (Service-Worker path not covered) is addressed by merged #108 (PR #113; real containment
test `crawlee-adapter/src/__tests__/service-workers.real-world.test.ts:91-119`). §23.14's #110
soft note ("gates exist/pass, not that a major upgrade passed them") is strengthened by PR #120, a
real major-version upgrade that passed CI including the full suite + contract gates (URL in row
14). Honest downgrades this pass versus the carried table: §23.3 and §23.4 are PARTIAL for Express
(the real-world inference proof and the reconciler runtime-only→`observed` half are exercised for
reference-auth-app only; for Express they are generic/vacuous), and §23.13 is PARTIAL for **both**
apps because the CycloneDX SBOM is a CI artifact, not part of the promoted bundle output
(`bundle-promoter/src/bundle-assembler.ts:82-93,160-177` writes no `sbom.cdx.json`). Criteria 6
and 7 stay MET for Express on the explicit rule that a correctly `blocked` absent-inbox /
absent-TOTP path counts as MET (`auth-domain-pack/src/candidates.ts:67-85,118-122`;
`auth-domain-pack/src/real-world.test.ts:54-63,72-74`).

One further non-blocking observation (independent review, not in scope for #109): the subsequent
candidate mutates the human-readable `plan` field, which desynchronizes `bundle.plan` from the
staged `plan.md` artifact whose hash is recorded in `manifest.fileHashes`; no promoter gate binds
the two today, so the incoherent B2 clears the gates and reaches atomic-replace (which is what
makes this test work, mirroring `real-world.test.ts`). A faithful B2 would re-project a second
compile; filing a `plan` ↔ `plan.md` binding gap is left to the integrator.

**This is a draft measurement, not a gate verdict; no cell is a `verified` truth state (ADR §2).**
`#27` stays open; the integrator owns the final M1-EXIT decision after CI runs on the merged head
and after reviewing the retained human-inspection residual from #115 (an LLM cannot prove
arbitrary screenshot pixels secret-free).
