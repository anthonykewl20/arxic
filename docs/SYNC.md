# Arxic — SYNC (living progress bookmark)

> **Read this first when resuming a session. Update it before closing one.**
> This is the peg. It tells you where we are, where we stopped, and where we pick up.
> The public architecture record is [`001-arxic-architecture.md`](./adr/001-arxic-architecture.md) (summary; the detailed internal ADR is private). The issues board is at <https://github.com/anthonykewl20/arxic/issues>.

---

## 🔖 RESUME HERE

**Status:** **Milestone 1 IN PROGRESS (2/15).** #16 (M1-02) ships `@arxic/crawlee-adapter`, a real Crawlee 3.18 `PlaywrightCrawler` (Playwright pinned 1.62.1) behind the frozen `SurfaceDiscoverer` contract that performs bounded **breadth** surface discovery (ADR §8.3) within `origin`/`maxUrls`/`maxDepth` budgets. ADR §7.4 prohibitions are fail-closed policy at both inventory and network layers: destructive forms observed but never submitted (`ARXIC-SURFACE-002` `blocked`) and same-origin non-safe HTTP methods aborted via request interception so page-JS mutations cannot run (`ARXIC-SURFACE-008` `blocked`), cross-origin browser requests/WebSockets aborted (`ARXIC-SURFACE-001` `blocked`), mutable personas serialized through a per-identity mutex (`ARXIC-SURFACE-004` `blocked`), frontier bounds enforced (`ARXIC-SURFACE-003` `blocked`), and transient HTTP retries give up bounded as `observed` never `verified` (`ARXIC-SURFACE-005`). Runtime `EvidenceRef`s are withheld without a valid same-origin attested build digest (`ARXIC-SURFACE-007` `blocked`). Real-world proof runs the real crawler against the real `reference-auth-app` in real Chromium within budgets; the mutation budget (sqlite tables) is byte-for-byte unchanged after the crawl. The frozen §10 contracts are unchanged; adapter-local `SurfaceMap`/`RouteSurface`/`NavigationEdge` bridge to the frozen `EvidenceEvent`.

**Next action:** [#17 (M1-03) LangGraph orchestrator (pipeline 0-12)](https://github.com/anthonykewl20/arxic/issues/17) — compose the frozen adapters (attestation → static inventory/evidence graph → breadth surface map → candidate inference → plan → compile → verify → promote) into the stage 0-12 pipeline; the orchestrator owns RunState + failure classification across the `observed`/`contradicted`/`blocked` dispositions now produced by #15 + #16.

**Last session:** 2026-08-05 (11) — **#16 (M1-02) Crawlee breadth surface map DONE**: `@arxic/crawlee-adapter` runs a real `PlaywrightCrawler` (Crawlee 3.18 + Playwright 1.62.1) behind the frozen `SurfaceDiscoverer` contract to enumerate routes/forms/controls/links/navigation-edges within `origin`/`maxUrls`/`maxDepth` budgets. §7.4 prohibitions are fail-closed: destructive forms never submitted, same-origin non-safe HTTP methods aborted at the network layer (`ARXIC-SURFACE-008`), cross-origin requests/WebSockets aborted, mutable personas serialized (per-identity mutex), frontier bounded, transient HTTP retries give up `observed` (never `verified`); runtime EvidenceRefs withheld without an attested build digest. Stable `ARXIC-SURFACE-001..008` diagnostics loop-close through the frozen validator; `navigationEdges` deduped + deterministically ordered so canonical serialization is byte-stable under concurrency. Real-world proof crawls the REAL `reference-auth-app` in real Chromium, proves `/`+`/login`+`/forgot-password` carry real runtime evidence, and proves the sqlite mutation budget is byte-for-byte unchanged. Frozen §10 contracts unchanged (adapter-local `SurfaceMap` bridges to `EvidenceEvent`). Gates green (typecheck/lint/format/test, 274 tests). **M1 2/15.** Next: #17 M1-03.

---

## At a glance

| Thing | Where |
|---|---|
| ADR (public summary) | `docs/adr/001-arxic-architecture.md` (§2 truth states, §8 diagram, §9 pipeline, §10 contracts, §22 milestones) — detailed internal ADR is private/local |
| Engineering charter | `docs/engineering-charter.md` — TDD red-first + Actions/Service layering + **mandatory sad-path-first**. Every slice follows this. |
| Contracts schemas | `schemas/{evidence,workflow,manifest,diagnostics}/` + adapter TS interfaces — **ALL contracts frozen** (#2–#6); `@arxic/contracts` is the capability boundary (ADR §10.5) |
| Packages | `packages/*` (16 adapters/engines, including the M0 capstone pipeline) — see ADR §18 |
| Apps | `apps/{cli,worker}/` (scaffolded) |
| Rule packs | `rulepacks/{nextjs,express}/` versioned auth AST rules **DONE (#9)**; `rulepacks/react` remains empty until #22 |
| Test fixture apps | `test-fixtures/{reference-auth-app (Next.js 15 + sqlite + Mailpit + otplib),vulnerable-auth-app (Express + sqlite)}/` — **DONE (#13)**: real booting apps, real Mailpit, attestation, seed API; the §6 real-world surface for spikes #8–#12 + M1 |
| Issues | <https://github.com/anthonykewl20/arxic/issues> — milestones "Milestone 0" / "Milestone 1" |
| Tooling | pnpm workspaces (Node ≥22 via corepack `packageManager` pnpm 11), TS strict, ESLint flat-config, Prettier; **per-workspace `tsconfig.json` + `typecheck` across all 19 package/app workspaces**; gates `pnpm lint/typecheck/typecheck:packages/format:check/test` are CI-green; **source-only — no build/emit in M0** (ADR-003) |
| Versioning | `VERSION` (0.0.0) is single source of truth → `package.json`; `RELEASES.md` (SemVer; 0.1.0=M0-EXIT #14, 0.2.0=M1-EXIT #27); `CHANGELOG.md` updated EVERY slice |
| Repo & CI | GitHub: squash-only merges + delete-branch-on-merge, Dependabot + security alerts ON, `main` protected (PR flow). CI `ci.yml` (required check `ci`): lint/typecheck/format/test + metadata guards + **license gate** (`scripts/license-gate.mjs`, rejects GPL/AGPL/SSPL) + **CycloneDX SBOM** artifact + fixture-app tests (real Mailpit); issue/PR templates; `CODEOWNERS`=@anthonykewl20 |
| Maturity docs | `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `SUPPORT.md`, `GOVERNANCE.md` |

---

## Milestone tracker

### Milestone 0 — Contracts & Spikes — COMPLETE (17/17)  (issue milestone "Milestone 0 - Contracts and Spikes")
_Goal: freeze contracts; prove each gear behind an adapter; atomic promotion; threat model. Exit: one manually-supplied login candidate compiles, verifies twice, and promotes with evidence (ADR §22)._

| # | Issue | Status |
|---|---|---|
| #1 | [M0-00] Monorepo & tooling bootstrap | ☑ done |
| #2 | [M0-01] Freeze contract: EvidenceRef | ☑ done |
| #3 | [M0-02] Freeze contract: Workflow v1 IR | ☑ done |
| #4 | [M0-03] Freeze contract: Diagnostics | ☑ done |
| #5 | [M0-04] Freeze contract: Bundle manifest | ☑ done |
| #6 | [M0-05] Freeze contract: Adapter interfaces | ☑ done |
| #7 | [M0-06] License gate + SBOM automation | ☑ done |
| #8 | [M0-07] Spike: Understand-Anything subset extraction | ☑ done |
| #9 | [M0-08] Spike: ast-grep rule fixtures (Next.js + Express) | ☑ done |
| #10 | [M0-09] Spike: PlaywrightAgentAdapter handshake + fallback | ☑ done |
| #11 | [M0-10] Spike: Atomic promotion + last-known-good | ☑ done |
| #12 | [M0-11] Threat model + target-attestation | ☑ done |
| #13 | [M0-12] Test-fixture apps scaffold | ☑ done |
| #40 | [M0-13] Spike: ModelAdapter | ☑ done |
| #41 | [M0-14] Policy engine: action classes + fail-closed | ☑ done |
| #44 | [M0-15] Arxic target-attestation accepts reference apps (depends #12, #13) | ☑ done |
| #14 | [M0-EXIT] Gate: login candidate verifies twice + promotes | ☑ done |

### Milestone 1 — Authentication Vertical Slice  (issue milestone "Milestone 1 - Authentication Vertical Slice")
_Goal: end-to-end evidence-driven auth bundles. Exit: two structurally different reference apps produce independently replayable bundles without app-specific generator code (ADR §22, §23)._

| # | Issue | Status |
|---|---|---|
| #15 | [M1-01] Static inventory + evidence graph | ☑ done |
| #16 | [M1-02] Crawlee breadth surface map | ☑ done |
| #17 | [M1-03] LangGraph orchestrator (pipeline 0-12) | ☐ |
| #18 | [M1-04] Candidate reconciliation + coverage matrix | ☐ |
| #19 | [M1-05] Fixture adapters (persona/inbox/otp) | ☐ |
| #20 | [M1-06] Playwright compiler: IR → plan + spec | ☐ |
| #21 | [M1-07] Verifier: runner, screenshots, traces, 2-pass | ☐ |
| #22 | [M1-08] Auth domain pack (login/logout/reset/change/TOTP) | ☐ |
| #23 | [M1-09] Coverage matrix + blocked reporting | ☐ |
| #24 | [M1-10] Bundle packaging (hashes/NOTICE/provenance) | ☐ |
| #25 | [M1-11] CLI app | ☐ |
| #26 | [M1-12] Worker (ephemeral isolated) | ☐ |
| #42 | [M1-14] Stage 4: LLM candidate inference (no promotion) | ☐ |
| #43 | [M1-15] Stage 8: intent exploration + human-approval | ☐ |
| #27 | [M1-EXIT] Gate: two apps replay, no app-specific code | ☐ |

_Milestones 2 (hardening) & 3 (service mode) are NOT yet filed — deferred until contracts stabilize (ADR §22)._

_Notes: pipeline **stage 11 (healing)** is intentionally deferred to M2 (only #10's healer-policy rejection and #43's exploration policy touch it today). M1 issue keys skip `M1-13` by design — the M1 gate is `M1-EXIT` = #27._

---

## Decisions (resolved)

- **License:** **MIT** — confirmed (`LICENSE`, `package.json`). Third-party notices in `NOTICE`.
- **Package manager:** **pnpm** workspaces via corepack (`packageManager` field). Node **≥22** (pnpm 11 requirement).
- **Build strategy (M0):** **source-only — no emit.** Packages consume each other via `main: src/index.ts` (raw `.ts`), checked by `tsc --noEmit` and compiled on demand by vitest. No `build`/`dist` in M0; emit deferred to when a package ships a published artifact (ADR-003).
- **Git flow (active — discipline-based):** The repo is **private**, so GitHub **branch protection is OFF** (free-tier limit for private repos). Trunk-based: short-lived branches → PR → squash-merge to `main`. **Discipline rule: merge ONLY after the `ci` check is green** (`gh pr checks <N> --watch` → `pass`); rebase stale Dependabot branches onto `main` before evaluating CI. No direct pushes/force-push; linear history. Re-enable branch protection when the repo goes public (post-purge) or upgrades to Pro.
- **Branching strategy:** **trunk-based** (confirmed) — no `dev`/`release` branch; short-lived `feat/`·`fix/`·`docs/` branches → PR → `main`; releases cut from `main` via tags. See `CONTRIBUTING.md` → Branching model.
- **Repo visibility:** **PRIVATE during pre-1.0** (recipe owner-only; history not purged — see reminder below). Side effect: no branch protection on the free tier → CI enforcement is discipline-based (above). A history purge (Support/recreate) is performed before going public; protection is re-enabled then.

---

## How we work (conventions)

- **Truth states (ADR §2):** hypothesized · observed · **verified** · contradicted · blocked. An LLM may never assign `verified` — only the deterministic verifier can.
- **Adapters, not forks:** every borrowed engine sits behind a contract (ADR §10.5). Return contracts, never upstream types.
- **Evidence everywhere:** output-influencing graph edges carry ≥1 `EvidenceRef` (ADR §8.4). No evidence → no `verified`.
- **Safety:** untrusted repo + adversarial web content are hostile. Default-deny egress, leased fixtures, content-is-data (prompt-injection defense), redact PII/secrets (ADR §16).
- **Never weaken to pass:** no skip/fixme/only, no assertion weakening, no success-by-quarantine (ADR §7.3, §13.1, §15).
- **Git flow:** `main` is protected — every change is a PR (squash merge), CI check `ci` must pass, linear history, no force-push. Follow `.github/pull_request_template.md` + charter §8 on every slice.
- **Engineering method:** see [`engineering-charter.md`](./engineering-charter.md). TDD red-first in vertical slices (mock only at system boundaries); Actions vs Service layering (§10.5 adapters = service capability blocks; RunState/pipeline = orchestration that owns failure classification). **Sad-path-first** — every slice enumerates sad/edge cases mapped to a truth state before happy path.
- **Real-world proof (dogfooded):** every slice must prove itself with real, non-synthetic user-level tests against the reference apps + real engines (real Chromium / real `sg` CLI / real Mailpit+otplib / real Tree-sitter). "Works on my mock" is banned. Hard dependency: **#13 (reference fixture apps) must land before spikes #8–#12 or any M1 slice can claim real-world proof.**

---

## Session log

| Date | What happened |
|---|---|
| 2026-08-04 | Built §18 monorepo layout; wrote root tooling (pnpm, tsconfig.base, eslint/prettier stubs, LICENSE/NOTICE/README); filed milestones + 12 area labels + 27 issues (M0 14, M1 13); saved canonical end-to-end architecture diagram into ADR §8. |
| 2026-08-04 (2) | Release readiness: complete MIT licensing; versioning (`VERSION` + `RELEASES.md` + always-synced `CHANGELOG.md` wired into charter §8 + PR template); maturity docs (CONTRIBUTING/CODE_OF_CONDUCT/SECURITY/SUPPORT/GOVERNANCE) + expanded README; functional tooling (eslint flat + tsconfig, contracts entry, pnpm-lock); GitHub CI + release workflows, Dependabot, issue templates, CODEOWNERS; repo settings (squash-only, delete-branch-on-merge) + security alerts; **CI green**; `main` branch protection (PR flow). |
| 2026-08-04 (3) | Pre-dev audit (3 reviewers) + remediation: PRs #36 (release perms), #37 (CI guards + hygiene), #38 (mask ADR + remove reference-collection docs), #39 (SECURITY SLA + ADR-002), #45 (sync). Removed vendored reference code from the tree; full ADR → local-only (outside the repo), public summary in `docs/adr/001-…`; ADR-002 (EvidenceRef = opaque IDs). **Repo set PRIVATE during pre-1.0** — GitHub PR refs still expose pre-mask history, so purge deferred to go-public. Filed #40–44; split #13; §23.14 acceptance in adapter issues; filled real-world/layering in #1–#14. Totals M0=17, M1=15. **CI green.** |
| 2026-08-04 (4) | **#1 (M0-00) tooling bootstrap DONE.** Per-package `tsconfig.json` + `typecheck` script across all 16 workspace packages; root `typecheck:packages` (`pnpm -r typecheck`); ESLint bans `it.only`/`skip`/`xit`/`xdescribe` (ADR §13.1); `.env.example`; structural test guards the per-package tooling contract. **ADR-003: M0 source-only (no emit).** Gates green (lint/typecheck/typecheck:packages/format/test). Starting contract freeze (#2). |
| 2026-08-04 (5) | **#2 (M0-01) EvidenceRef contract frozen.** `schemas/evidence/{evidence-ref,source-revision,evidence-index}.schema.json` (JSON Schema 2020-12) + AJV 2020-12 strict validators + hand-written TS types in `@arxic/contracts`. Discriminated union (ADR §10.2), `SourceRevision` (§10.1), `evidence/index.json` + id grammar (ADR-002). `startLine≤endLine` via AJV `$data` (schema-pure). Stable diagnostics `ARXIC-EVIDENCE-*`. Sad-path-first + tautology guard; 30 tests green. **Scope boundaries:** runtime network/console gating → #21; dirty-tree blob-link manufacturing → #8. |
| 2026-08-04 (6) | **#3 (M0-02) Workflow v1 IR frozen.** `schemas/workflow/workflow.schema.json` (2020-12) + AJV validator + TS types (`Workflow`/`WorkflowTransition`/`TruthState`). **`status:"verified"` rejected unless every required transition carries `run:` runtime evidence** (ADR §2/§15/ADR-002 — an LLM may never assign verified); transitions `required:true` by default; optional non-blocking; 5 truth states; confidence descriptive-only. Stable diagnostics `ARXIC-WORKFLOW-*`; ADR §10.3 literal + sad-paths + tautology guard; 46 tests green. |
| 2026-08-04 (7) | **#4 (M0-03) Diagnostics frozen.** `schemas/diagnostics/diagnostics.schema.json` (2020-12) + AJV + widened `Diagnostic`/`DiagnosticSeverity` types (ADR §10.4). `severity` enum = 4 non-`verified` truth states; `code` pattern `^ARXIC-[A-Z0-9][A-Z0-9-]*$`; `evidenceRefs` accept arbitrary refs (ADR `config:idp-provider`). **Loop-closing contract test dynamically iterates every exported `ARXIC-*` code and validates each.** Sad-paths + tautology guard; 55 tests green. 4/5 contracts frozen. |
| 2026-08-04 (8) | **#5 (M0-04) Bundle manifest frozen.** `schemas/manifest/manifest.schema.json` (2020-12) + AJV + `BundleManifest` types (ADR §14 + issue #5 field list). `blockers` inline the frozen Diagnostic shape; loop-closing test proves a manifest blocker validates via `validateDiagnostic` (#4). Sad-paths (missing digest/commit/hashes, gate-missing, denominator-invalid, bad lengths, blocker `severity:"verified"`, extra property) + tautology guard; 70 tests green. **All JSON-Schema contracts frozen.** Boundary: cross-field totals + denominator immutability → #23/#24. |
| 2026-08-04 (9) | **#6 (M0-05) Adapter interfaces frozen → 🎯 M0 goal 1 (contract freeze) COMPLETE.** 7 ADR §10.5 TS interfaces + minimal supporting types in `@arxic/contracts` (reusing #2–#5 frozen types). Compile-time `@ts-expect-error` test (`adapters.test-d.ts`) proves adapters can't leak upstream types (fail-closed at type level — gate reds if an interface widens). `VerificationResult.outcome` = 5 `TruthState`s (no 6th "flaky" — verifier-internal #21, derivable from `runs[]`). Boundary-double runtime test exercises all 7 interfaces. 72 tests green. **All 6 contracts frozen.** Next: #13 fixture apps (large slice, checkpoint). |
| 2026-08-04 (10) | **#13 (M0-12) Test-fixture apps DONE.** Two REAL structurally-different auth apps: `reference-auth-app` (Next.js 15 App Router + better-sqlite3 + bcryptjs + nodemailer→Mailpit + otplib) — full §12.1 (login/logout/forgot-reset/change-password/MFA enroll+challenge), HMAC sessions, CSRF, rate limit; `vulnerable-auth-app` (Express + ejs + sqlite) — login/logout/reset with documented weaknesses (enumerating login, reused + 7-day tokens, no CSRF, no rate limit, verbose errors). Both serve attestation `environmentClass:"local-test"` + seed/reset API. Real Mailpit via `docker-compose.yml`. **REAL boot tests green against real Mailpit** (reset email delivered + token extracted; reference MFA needs real otplib TOTP; vulnerable enumeration + token-reuse weaknesses proven). Per-app typecheck/lint/test excluded from root gate; CI `ci` job gates both apps with a Mailpit service. `pnpm-workspace.yaml allowBuilds` for native deps. **Spikes #8–#12 unblocked.** |
| 2026-08-04 (11) | **#7 (M0-06) License gate + SBOM DONE.** `scripts/license-gate.mjs` scans the real pnpm graph (440 pkgs) against an allowlist (permissive + weak-copyleft MPL/LGPL) and rejects GPL/AGPL/SSPL/Commons-Clause/BSL/EUPL/CC-BY-SA/PolyForm/Unknown. `license-exceptions.json` (`thirty-two` → MIT upstream). CI: license gate + CycloneDX SBOM artifact + `third_party/` vendored-code guard. TDD sad-paths (AGPL/GPL/SSPL rejected; **LGPL allowed — distinguished from GPL**) + real-graph assertion (0 rejected). 93 tests green. 8/17 M0 done. |
| 2026-08-05 | **#8 (M0-07) Understand-Anything subset extraction DONE.** `@arxic/source-ua-adapter` adapts the reviewed deterministic scanner/structure seams behind frozen `SourceIndexer`: full Git SHA, bytewise manifest + SHA-256, dirty provenance guard, fail-closed gaps, and real native Tree-sitter symbols/imports/calls/Next.js+Express routes. Canonical output is byte-identical pre-timestamp; ADR §23.14 contract gate + separate MIT grammar-license test. Real proof scans both fixture-app source trees. 106 tests green. 9/17 M0 done. |
| 2026-08-05 (2) | **#9 (M0-08) ast-grep rule fixtures DONE.** Real ast-grep 0.45 process scans versioned Next.js and Express packs; committed source refs and stable diagnostics validate through frozen contracts. Real fixture-app login route→handler→guard chains connect as advisory `hypothesized`; per-rule positive/negative fixtures and fail-closed sad paths cover the seam. 10/17 M0 done. |
| 2026-08-05 (3) | **#10 (M0-09) PlaywrightAgentAdapter handshake + fallback DONE.** Exactly pinned Playwright Test 1.62.1 MCP handshake and nine-tool schema gate fail closed on seam drift; healer policy rejects weakening and unsafe boundaries. Real agent and generated fallback both execute seeded login against the reference app in real Chromium; runtime disposition remains `observed`. 11/17 M0 done. |
| 2026-08-05 (4) | **#11 (M0-10) Atomic promotion + last-known-good DONE.** Deterministic canonical bundle bytes, frozen manifest validation, staged SHA-256 and byte-count checks, same-directory atomic rename, `.lkg` snapshots, and exclusive locking ship behind the frozen `BundlePromoter`; real filesystem failures and contention are `blocked` without corrupting public bytes. 12/17 M0 done. |
| 2026-08-05 (5) | **#12 (M0-11) Threat model + target-attestation DONE.** Real HTTP handshakes against both fixture apps allow exact local-test attestations; production-looking, origin, nonce, and unsigned-receipt failures are `blocked`, while only static recorded human approval permits the production-shaped proof target. Worker, prompt-injection, action, privacy, and Docker/Testcontainers isolation requirements are documented. 13/17 M0 done; #44 unblocked. |
| 2026-08-05 (6) | **#40 (M0-13) ModelAdapter DONE.** Credentials resolve-at-call-time Bearer-only, structured output is schema-bound + real-AJV-validated, invalid output retries then blocks with no promotion, schema-version drift fails closed, content-as-data injection is blocked without policy mutation, and run records carry only request id/schema version/token+provider metadata behind a redaction gate; stable `ARXIC-MODEL-*` diagnostics loop-close; real local OpenAI-compatible stub + real AJV prove it. 14/17 M0 done. |
| 2026-08-05 (7) | **#41 (M0-14) Policy engine DONE.** One-argument `authorize(PolicyAuthorization)` plus configured `PolicyEngine.decide` enforce six registered actions across the four frozen action classes; exact origin allowlists, caller-owned lease and budget state, sandbox presence, and exact recorded approvals fail closed with stable `ARXIC-POLICY-*` diagnostics. Canonical snapshots hash full inputs, and live reference-app attestation covers all five required decisions. 15/17 M0 done. |
| 2026-08-05 (8) | **#44 (M0-15) PREFLIGHT target-attestation acceptance DONE.** The existing real handshake now runs across target sets; both real reference apps are accepted as `local-test`; production-styled and missing or malformed attestations are refused with blocked diagnostics; deterministic canonical run artifacts record every decision; and artifact write failures fail closed. 16/17 M0 done. |
| 2026-08-05 (9) | **#14 (M0-EXIT) Milestone 0 capstone DONE.** The thin `@arxic/m0-pipeline` orchestrator composes target attestation, committed login source evidence, Workflow compilation, two clean-fixture real-Chromium verification passes, and atomic promotion. The deterministic verifier produced `verified`; promoted screenshots, trace, spec, NOTICE, provenance, manifest, and hashes were independently checked; an injected third-run source-evidence failure preserved the second last-known-good bundle. **17/17 M0 complete; 0.1.0 release pending.** Next: #15 M1-01. |
| 2026-08-05 (10) | **#15 (M1-01) Static inventory + evidence graph DONE.** `@arxic/evidence-graph` (Graphology) ingests real `SourceUaAdapter` (Tree-sitter) + real `AstGrepAdapter` (`sg`) outputs into a typed, content-addressed graph (ADR §8.4). Output-influencing edges require ≥1 EvidenceRef at compile time (non-empty tuple) + runtime (`ARXIC-GRAPH-001` `blocked`); conflicting node/edge structure surfaces `ARXIC-GRAPH-002`/`-003` `contradicted`. Canonical sorted JSON/JSONL is SHA-256-addressed and byte-identical across rebuilds (property + real-fixture determinism tests). Real-world proof connects both real fixture apps' `/login` route→handler→guard with ≥2 real source EvidenceRefs per edge. The frozen §10 contracts are unchanged (local `GraphIngestEvent` bridges the semantics gap). Gates green (typecheck/lint/format/test, 262 tests). Dispositions: `contradicted`, `blocked`. Final classification deferred to orchestrator (#17)/reconciler (#18). **M1 1/15.** Next: #16 M1-02. |
| 2026-08-05 (11) | **#16 (M1-02) Crawlee breadth surface map DONE.** `@arxic/crawlee-adapter` runs a real Crawlee 3.18 `PlaywrightCrawler` (Playwright 1.62.1) behind the frozen `SurfaceDiscoverer` contract to enumerate routes/forms/controls/links/navigation-edges within `origin`/`maxUrls`/`maxDepth` budgets. ADR §7.4 prohibitions are fail-closed policy: destructive forms observed but never submitted (`ARXIC-SURFACE-002`), cross-origin browser requests aborted via request interception + cross-origin WebSockets closed before connect (`ARXIC-SURFACE-001`), mutable personas serialized through a per-identity mutex (`ARXIC-SURFACE-004`), frontier bounds (`ARXIC-SURFACE-003`), transient HTTP 408/425/429/≥500 retries give up bounded as `observed` never `verified` (`ARXIC-SURFACE-005`). Runtime EvidenceRefs withheld without a valid attested build digest (`ARXIC-SURFACE-007`); invalid origins rejected (`ARXIC-SURFACE-006`). Stable `ARXIC-SURFACE-001..008` loop-close through the frozen validator; `navigationEdges` are deduped (shallowest depth) and deterministically ordered so `serializeSurfaceMap` is byte-stable under concurrency. Real-world proof crawls the REAL `reference-auth-app` in real Chromium within budgets — `/`, `/login`, `/forgot-password` carry real runtime evidence; sqlite mutation budget (`users`/`reset_tokens`/`sessions`/`mfa_challenges`) is byte-for-byte unchanged after the crawl. Default-deny mutation is enforced at both inventory and network layers (same-origin non-safe HTTP methods aborted, `ARXIC-SURFACE-008`). Frozen §10 contracts unchanged (adapter-local `SurfaceMap`/`RouteSurface`/`NavigationEdge` bridge to `EvidenceEvent`). Gates green (typecheck/lint/format/test, 274 tests). **M1 2/15.** Next: #17 M1-03. |

---

_**Slice completion ritual is MANDATORY (charter §8).** When you finish ANY slice: run the gates, prove real-world (non-synthetic), then sync ALL docs — flip the tracker here, move 🔖 RESUME HERE, add a session-log line, staleness-sweep (`rg` the slice id + TODOs), link + close the GitHub issue, and commit + **push to `main`**. Unsaved = undone. Stale docs are a defect._
