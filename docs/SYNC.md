# Arxic — SYNC (living progress bookmark)

> **Read this first when resuming a session. Update it before closing one.**
> This is the peg. It tells you where we are, where we stopped, and where we pick up.
> The public architecture record is [`001-arxic-architecture.md`](./adr/001-arxic-architecture.md) (summary; the detailed internal ADR is private). The issues board is at <https://github.com/anthonykewl20/arxic/issues>.

---

## 🔖 RESUME HERE

**Status:** **#1 (M0-00) tooling bootstrap DONE.** Per-package `tsconfig.json` + `typecheck` across all 16 workspace packages; ESLint bans skip/only; `.env.example`; source-only per ADR-003. 32 issues filed (M0=17, M1=15). Starting **contract freeze** (#2 EvidenceRef).

**Next action:** [#2 (M0-01) Freeze EvidenceRef](https://github.com/anthonykewl20/arxic/issues/2) — `schemas/evidence/{evidence-ref,source-revision}.schema.json` + the `evidence/index.json` shape + AJV strict validators + TS types per ADR §10.2 + ADR-002. Sad-path-first (malformed refs → stable diagnostics; dirty tree → no manufactured blob links; tautology guard). In parallel **bring [#13 (M0-12) fixture apps](https://github.com/anthonykewl20/arxic/issues/13) forward** — they are the real-world-proof surface every spike (#8–#12) and M1 slice must run against. Pattern: the AJV seed test in `packages/contracts/src/__tests__/`.

**Last session:** 2026-08-04 — **#1 (M0-00) tooling bootstrap landed**: per-package `tsconfig.json` + `typecheck` across all 16 workspace packages; root `pnpm typecheck:packages` (`pnpm -r typecheck`); ESLint bans `it.only`/`skip`/`xit`/`xdescribe` (ADR §13.1); `.env.example`; structural test guards the tooling contract; **ADR-003 (M0 source-only, no emit)**. Gates green. Next: contract freeze #2 (EvidenceRef).

---

## At a glance

| Thing | Where |
|---|---|
| ADR (public summary) | `docs/adr/001-arxic-architecture.md` (§2 truth states, §8 diagram, §9 pipeline, §10 contracts, §22 milestones) — detailed internal ADR is private/local |
| Engineering charter | `docs/engineering-charter.md` — TDD red-first + Actions/Service layering + **mandatory sad-path-first**. Every slice follows this. |
| Contracts schemas | `schemas/{evidence,workflow,manifest,diagnostics}/` (empty — frozen in #2–#5) |
| Packages | `packages/*` (14 adapters/engines, scaffolded) — see ADR §18 |
| Apps | `apps/{cli,worker}/` (scaffolded) |
| Rule packs | `rulepacks/{nextjs,react,express}/` (empty — built in #9, #22) |
| Test fixture apps | `test-fixtures/{vulnerable-auth-app,reference-auth-app}/` (scaffolded in #13) |
| Issues | <https://github.com/anthonykewl20/arxic/issues> — milestones "Milestone 0" / "Milestone 1" |
| Tooling | pnpm workspaces (Node ≥22 via corepack `packageManager` pnpm 11), TS strict, ESLint flat-config, Prettier; **per-package `tsconfig.json` + `typecheck` across all 16 packages**; gates `pnpm lint/typecheck/typecheck:packages/format:check/test` are CI-green; **source-only — no build/emit in M0** (ADR-003) |
| Versioning | `VERSION` (0.0.0) is single source of truth → `package.json`; `RELEASES.md` (SemVer; 0.1.0=M0-EXIT #14, 0.2.0=M1-EXIT #27); `CHANGELOG.md` updated EVERY slice |
| Repo & CI | GitHub: squash-only merges + delete-branch-on-merge, Dependabot + security alerts ON, `main` protected (PR flow). CI `ci.yml` (required check `ci`); issue/PR templates; `CODEOWNERS`=@anthonykewl20 |
| Maturity docs | `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `SUPPORT.md`, `GOVERNANCE.md` |

---

## Milestone tracker

### Milestone 0 — Contracts & Spikes  (issue milestone "Milestone 0 - Contracts and Spikes")
_Goal: freeze contracts; prove each gear behind an adapter; atomic promotion; threat model. Exit: one manually-supplied login candidate compiles, verifies twice, and promotes with evidence (ADR §22)._

| # | Issue | Status |
|---|---|---|
| #1 | [M0-00] Monorepo & tooling bootstrap | ☑ done |
| #2 | [M0-01] Freeze contract: EvidenceRef | ☐ next |
| #3 | [M0-02] Freeze contract: Workflow v1 IR | ☐ |
| #4 | [M0-03] Freeze contract: Diagnostics | ☐ |
| #5 | [M0-04] Freeze contract: Bundle manifest | ☐ |
| #6 | [M0-05] Freeze contract: Adapter interfaces | ☐ |
| #7 | [M0-06] License gate + SBOM automation | ☐ |
| #8 | [M0-07] Spike: Understand-Anything subset extraction | ☐ |
| #9 | [M0-08] Spike: ast-grep rule fixtures (Next.js + Express) | ☐ |
| #10 | [M0-09] Spike: PlaywrightAgentAdapter handshake + fallback | ☐ |
| #11 | [M0-10] Spike: Atomic promotion + last-known-good | ☐ |
| #12 | [M0-11] Threat model + target-attestation | ☐ |
| #13 | [M0-12] Test-fixture apps scaffold | ☐ |
| #40 | [M0-13] Spike: ModelAdapter | ☐ |
| #41 | [M0-14] Policy engine: action classes + fail-closed | ☐ |
| #44 | [M0-15] Arxic target-attestation accepts reference apps (depends #12, #13) | ☐ |
| #14 | [M0-EXIT] Gate: login candidate verifies twice + promotes | ☐ (blocks M1) |

### Milestone 1 — Authentication Vertical Slice  (issue milestone "Milestone 1 - Authentication Vertical Slice")
_Goal: end-to-end evidence-driven auth bundles. Exit: two structurally different reference apps produce independently replayable bundles without app-specific generator code (ADR §22, §23)._

| # | Issue | Status |
|---|---|---|
| #15 | [M1-01] Static inventory + evidence graph | ☐ |
| #16 | [M1-02] Crawlee breadth surface map | ☐ |
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

---

_**Slice completion ritual is MANDATORY (charter §8).** When you finish ANY slice: run the gates, prove real-world (non-synthetic), then sync ALL docs — flip the tracker here, move 🔖 RESUME HERE, add a session-log line, staleness-sweep (`rg` the slice id + TODOs), link + close the GitHub issue, and commit + **push to `main`**. Unsaved = undone. Stale docs are a defect._
