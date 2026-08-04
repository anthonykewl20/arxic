# AGENTS.md — Arxic

Loaded automatically by opencode (and other agent CLIs) for every agent working in this repo. It complements your global operating contract with repo-specific rules. **Read [`docs/SYNC.md`](./docs/SYNC.md) first** (the living bookmark), and the [engineering charter](./docs/engineering-charter.md).

## Apply these skills (automatic + on-demand)

- **code-structure** — AUTOMATIC on every implementation/refactor. Actions (orchestration: why/when, state transitions, auth/policy, **failure classification**) vs Service layer (reusable mechanics: how, provider/SDK, structured returns). Never duplicate operational logic across flows. (`.opencode/skills/code-structure`; charter §1.)
- **evidence-driven-testing** — AUTOMATIC for any UI/behavior verification. Produce annotated proof and attach it to the PR + tracker issue. In Arxic the recording-equivalent is the **Playwright trace + named screenshots** (ADR §15); attach those + a pass/fail-per-test summary. Never claim a UI behavior works without attached evidence. (`.opencode/skills/evidence-driven-testing`; charter §6.)
- **global-agent-guardrails** — AUTOMATIC via the repo plugin `.opencode/plugins/command-guard.ts` (blocks catastrophic shell commands; fail-open; force-push intentionally allowed). On-demand, invoke the skill to wire/tune the guard machine-wide. (`.opencode/skills/global-agent-guardrails`.)
- **remind** — ON-DEMAND only (`/remind`): rewrite the last response simpler/shorter with a TLDR. Manual; never auto-invoked. (`.opencode/command/remind.md`.)

## Repo rules (non-negotiable)

- **Source of truth:** `docs/adr/001-arxic-architecture.md` (public summary) + `docs/engineering-charter.md` + `docs/SYNC.md`. Update SYNC last.
- **Truth states (ADR §2):** hypothesized / observed / **verified** / contradicted / blocked. An LLM may **never** assign `verified`.
- **Engineering method (charter §3–§6):** TDD red-first vertical slices; **sad-path-first**; **real-world (non-synthetic) proof** against the reference apps + real engines ("works on my mock" is banned); Actions/Service layering.
- **Slice-completion ritual (charter §8):** gates green → flip the SYNC tracker → add a `CHANGELOG.md` entry → `VERSION == package.json` → staleness sweep → close the issue → push. **Stale docs are a defect.**
- **Git flow:** the repo is **PRIVATE during pre-1.0**, so GitHub branch protection is **off** (free tier) → merge **only when the `ci` check is green** (`gh pr checks <N> --watch` → `pass`); rebase stale dependency-bump branches first. Trunk-based: short-lived branch → PR → squash-merge to `main`. No direct pushes/force-push (force-push is allowed only for authorized history hygiene).
- **Secrecy:** the detailed internal ADR + upstream reference trees are **LOCAL-ONLY** (outside the repo). Never commit them or reference them in tracked files.
- **Catastrophic commands** are blocked by the command-guard plugin; do not attempt to circumvent it.

## Start here

`docs/SYNC.md` → 🔖 **RESUME HERE**.
