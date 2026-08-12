# AGENTS.md — Arxic

Loaded automatically by opencode (and other agent CLIs) for every agent working in this repo. It complements your global operating contract with repo-specific rules. **Read [`docs/SYNC.md`](./docs/SYNC.md) first** (the living bookmark), and the [engineering charter](./docs/engineering-charter.md).

## Apply these skills (automatic + on-demand)

- **code-structure** — AUTOMATIC on every implementation/refactor. Actions (orchestration: why/when, state transitions, auth/policy, **failure classification**) vs Service layer (reusable mechanics: how, provider/SDK, structured returns). Never duplicate operational logic across flows. (`.opencode/skills/code-structure`; charter §1.)
- **evidence-driven-testing** — AUTOMATIC for any UI/behavior verification. Produce annotated proof and attach it to the PR + tracker issue. In Arxic the recording-equivalent is the **sanitized Playwright action timeline + adjacent sanitization provenance + named screenshots** (ADR §15); raw trace ZIPs must never be retained or attached. Attach the safe artifacts + a pass/fail-per-test summary. Never claim a UI behavior works without attached evidence. (`.opencode/skills/evidence-driven-testing`; charter §6.)
- **global-agent-guardrails** — AUTOMATIC via the repo plugin `.opencode/plugins/command-guard.ts` (blocks catastrophic shell commands; fail-open; force-push intentionally allowed). On-demand, invoke the skill to wire/tune the guard machine-wide. (`.opencode/skills/global-agent-guardrails`.)
- **remind** — ON-DEMAND only (`/remind`): rewrite the last response simpler/shorter with a TLDR. Manual; never auto-invoked. (`.opencode/command/remind.md`.)

## Repo rules (non-negotiable)

- **Source of truth:** `docs/adr/001-arxic-architecture.md` (public summary) + `docs/engineering-charter.md` + `docs/SYNC.md`. Update SYNC last.
- **Truth states (ADR §2):** hypothesized / observed / **verified** / contradicted / blocked. An LLM may **never** assign `verified`.
- **Engineering method (charter §3–§6):** TDD red-first vertical slices; **sad-path-first**; **real-world (non-synthetic) proof** against the reference apps + real engines ("works on my mock" is banned); Actions/Service layering.
- **Slice-completion ritual (charter §8):** gates green → flip the SYNC tracker → add a `CHANGELOG.md` entry → `VERSION == package.json` → staleness sweep → close the issue → push. **Stale docs are a defect.**
- **Git flow:** the repo went **PUBLIC on 2026-08-12** (was PRIVATE during pre-1.0; flipped public to unblock Actions billing — public repos get free unlimited `ubuntu-latest` minutes, private hit the 2,000 min/mo free-tier cap → spending-limit block). Trunk-based: short-lived branch → PR → squash-merge to `main`. **Merge only when the `ci` check is green** (`gh pr checks <N> --watch` → `pass`); rebase stale dependency-bump branches first. No direct pushes/force-push (force-push is allowed only for authorized history hygiene). **Follow-ups:** (a) re-enable `main` branch protection now that the repo is public (repo Settings); (b) **no self-hosted runners** — public repo, so fork PRs must never run arbitrary code on shared infra; use GitHub-hosted `ubuntu-latest` only.
- **Secrecy:** the detailed internal ADR + upstream reference trees are **LOCAL-ONLY** (outside the repo). Never commit them or reference them in tracked files.
- **Catastrophic commands** are blocked by the command-guard plugin; do not attempt to circumvent it.

## Parallel slices (charter §10) — applies whenever you are in a worktree under `../arxic-wt/`

If your `pwd` is a worktree (not `/home/soultransit/devtony/arxic`), other agents are building other slices at the same time. Read [`engineering-charter.md` §10](./docs/engineering-charter.md). The three rules that bite:

- **NEVER edit `docs/SYNC.md`, `CHANGELOG.md`, or `VERSION`.** They conflict on every branch. Write `docs/_slice-notes/<SLICE-ID>.md` from `docs/_slice-notes/_TEMPLATE.md` instead — that file IS your doc deliverable, and the integrator folds it in at merge. The rest of the §8 ritual (gates, real-world proof, staleness sweep, closing the loop) is unchanged.
- **Stay inside the files your slice owns.** Overlapping edits to a shared file are allowed only inside distinct functions. Do not refactor shared helpers, rename exports, or reformat a file another slice owns — extract into a new file and leave one call site behind.
- **Leave `ARXIC_MAILPIT_SMTP` / `ARXIC_MAILPIT_API` unset** so each run gets its own Mailpit Testcontainer on random ports. New real-world tests must allocate ephemeral ports (`freePort()`) and per-run temp sqlite (`ARXIC_DB_PATH` → `mkdtemp`), like the existing ones. A hardcoded port is a defect.

## Reporting discipline — learned the hard way in the first parallel batch

Every agent in that batch reported `STATUS: done` at least once before it was true, and four of five needed a fix round. These are the specific failures; do not repeat them.

- **"Done" means `gh pr checks <N>` printed `pass`.** Not "gates green locally". If CI has not run to completion against your current head, you are not done — say so.
- **Run `pnpm format:check` on the FULL repo AFTER writing your slice note, and paste its last line into your report.** Two agents ran it before authoring the note, reported `format ✓`, and shipped a prettier-dirty note. Never write a bare checkmark for format.
- **Format is CI step 10.** If it fails, `Test`, `License gate` and the fixture-app suites are **skipped** — so a red format makes every downstream gate claim in your report unverified, no matter what passed locally. Two slices merged with suites that had never once executed in CI.
- **`ls docs/_slice-notes/` before you write the note.** Copy the path from that output. Three agents wrote `_slice_notes` (underscore) from memory; CI now rejects it outright.
- **A test that passes locally and fails in CI is a bug until proven otherwise.** In this batch it was a real portability defect: the sandbox hardcoded `--user 1000:1000` and the dev host uid happened to be 1000, so `0700` fixture dirs were readable locally and unreadable on the runner. Reproduce the CI condition; do not re-run until green.
- **Never resolve a red assertion by loosening it without saying so, in the report and in the PR.** Widening a matcher can make the test stop checking the property it exists to check.
- **Never write `close #<n>`, `fixes #<n>`, or `resolves #<n>` in a PR title, a PR body, OR A COMMIT MESSAGE, unless you intend that issue to close — including when you negate it, and including when you are quoting the phrase to warn about it.** GitHub's closing-keyword parser is not negation-aware and runs over commit messages on the default branch as well as PR text. `does not close #27` contains `close #27` and closes it. This closed the M1-EXIT gate issue **three times**: once from a PR body, once from a PR body that said "do not close #27", and once from the commit message of the very commit that documented the trap. Use `refs #<n>`; if you must be explicit, write "#<n> stays open". To discuss the keyword itself, break it up (`clos&#8203;e #<n>`) or name the issue without the number.
- **Report what you did NOT do.** Deferrals, provisional types, and known-weak spots are more useful to the integrator than a clean-looking summary. The most valuable output of that batch was a spike's honest gap list.

## Start here

`docs/SYNC.md` → 🔖 **RESUME HERE**.
