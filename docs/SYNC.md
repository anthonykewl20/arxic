# Arxic — SYNC (living progress bookmark)

> **Read this first when resuming a session. Update it before closing one.**
> This is the peg. It tells you where we are, where we stopped, and where we pick up.
> The public architecture record is [`001-arxic-architecture.md`](./adr/001-arxic-architecture.md) (summary; the detailed internal ADR is private). The issues board is at <https://github.com/anthonykewl20/arxic/issues>.

---

## 🔖 RESUME HERE

**Status:** Workspace bootstrapped. M0 + M1 issues filed. Nothing implemented yet — about to start **Milestone 0**.

**Next action:** Begin [#1 (M0-00) Monorepo & tooling bootstrap](https://github.com/anthonykewl20/arxic/issues/1) — finish per-package tsconfigs, real ESLint config, CI workflow, then confirm the open decisions below. In parallel start the contract-freeze issues (#2–#6) and **bring [#13 (M0-12) fixture apps](https://github.com/anthonykewl20/arxic/issues/13) forward** — they are the real-world-proof surface every spike (#8–#12) and M1 slice must run against.

**Last session:** 2026-08-04 — scaffolded §18 layout, filed 27 issues (M0=14, M1=13), added the ADR §8 architecture diagram; then made the repo release-ready (complete MIT licensing, versioning via `VERSION`/`RELEASES.md`/always-synced `CHANGELOG.md`, maturity docs, functional tooling, CI + release workflows, Dependabot, issue/PR templates, GitHub settings + security alerts, `main` branch protection). CI is green.

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
| Tooling | pnpm workspaces (Node ≥22 via corepack `packageManager` pnpm 11), TS strict, ESLint flat-config, Prettier; gates `pnpm lint/typecheck/format:check/test` are CI-green |
| Versioning | `VERSION` (0.0.0) is single source of truth → `package.json`; `RELEASES.md` (SemVer; 0.1.0=M0-EXIT #14, 0.2.0=M1-EXIT #27); `CHANGELOG.md` updated EVERY slice |
| Repo & CI | GitHub: squash-only merges + delete-branch-on-merge, Dependabot + security alerts ON, `main` protected (PR flow). CI `ci.yml` (required check `ci`); issue/PR templates; `CODEOWNERS`=@anthonykewl20 |
| Maturity docs | `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `SUPPORT.md`, `GOVERNANCE.md` |

---

## Milestone tracker

### Milestone 0 — Contracts & Spikes  (issue milestone "Milestone 0 - Contracts and Spikes")
_Goal: freeze contracts; prove each gear behind an adapter; atomic promotion; threat model. Exit: one manually-supplied login candidate compiles, verifies twice, and promotes with evidence (ADR §22)._

| # | Issue | Status |
|---|---|---|
| #1 | [M0-00] Monorepo & tooling bootstrap | ☐ next |
| #2 | [M0-01] Freeze contract: EvidenceRef | ☐ |
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
| #27 | [M1-EXIT] Gate: two apps replay, no app-specific code | ☐ |

_Milestones 2 (hardening) & 3 (service mode) are NOT yet filed — deferred until contracts stabilize (ADR §22)._

---

## Decisions (resolved)

- **License:** **MIT** — confirmed (`LICENSE`, `package.json`). Third-party notices in `NOTICE`.
- **Package manager:** **pnpm** workspaces via corepack (`packageManager` field). Node **≥22** (pnpm 11 requirement).
- **Git flow (active):** `main` is **protected** — all changes via PR (squash merge), CI check `ci` required, linear history, no force-push. Solo owner: self-merge allowed (0 required reviews).
- **Branching strategy:** **trunk-based** (confirmed) — no `dev`/`release` branch; short-lived `feat/`·`fix/`·`docs/` branches → PR → `main`; releases cut from `main` via tags. See `CONTRIBUTING.md` → Branching model.

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

---

_**Slice completion ritual is MANDATORY (charter §8).** When you finish ANY slice: run the gates, prove real-world (non-synthetic), then sync ALL docs — flip the tracker here, move 🔖 RESUME HERE, add a session-log line, staleness-sweep (`rg` the slice id + TODOs), link + close the GitHub issue, and commit + **push to `main`**. Unsaved = undone. Stale docs are a defect._
