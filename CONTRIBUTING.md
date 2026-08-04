# Contributing to Arxic

Welcome, and thanks for helping shape Arxic.

Arxic is an evidence-driven behavioral compiler. Contributions are expected to
produce replayable behavior artifacts and evidence, then verify that evidence in
independent runs.

## How Arxic works

Arxic is an evidence-driven compiler: it discovers behavioral capabilities from
pinned source and a safe test deployment, reconciles them into a coverage matrix,
and verifies them as independently replayable Playwright workflow bundles with
provenance. Five truth states (hypothesized / observed / verified / contradicted /
blocked) govern every outcome; an LLM may never assign `verified`. See
`docs/adr/001-arxic-architecture.md` and `docs/engineering-charter.md`.

## Prerequisites

- Node.js 22+
- pnpm 11 (via corepack; `packageManager` is pinned in `package.json`)

## Getting started

```bash
pnpm install
pnpm typecheck
```

Optional:

```bash
pnpm lint
pnpm format:check
pnpm test
```

## Branching model

**Strategy: trunk-based development** (confirmed decision). There is no long-lived `dev` or `release` branch.

- `main` is the single integration branch; it is **protected** (`enforce_admins` on) — no direct pushes, no force-push, no deletion; linear history required.
- All work lands via **short-lived branches** named by intent: `feat/<scope>`, `fix/<scope>`, `docs/<scope>`, `chore/<scope>`, `spike/<scope>`.
- Open a PR against `main`; the required CI check `ci` must pass (and the branch be up-to-date) before merge. Solo maintainers may self-merge (0 required reviews). Merge style: **squash**.
- `main` is always shippable. **Releases are cut from `main` via tags** (`v0.1.0`, `v0.2.0`, …) per `RELEASES.md` — never via a release branch.
- Conventional Commits are expected (`feat(contracts): …`, `fix(verifier): …`).

## Slice workflow (mandatory)

Every contribution maps to a tracked issue/slice and MUST follow
`docs/engineering-charter.md`:

- TDD red-first vertical slices.
- Sad paths first, then happy path.
- Real-world non-synthetic proof with reference apps and real engines.
- Explicit Actions/Service layering with clear seams.

Every PR must also satisfy the checklist in
`.github/pull_request_template.md`, including the mandatory slice-completion
ritual (`docs/SYNC.md` flip, `CHANGELOG.md` entry, `VERSION` sync, and staleness
sweep).

## Commit messages

Use Conventional Commits, for example:

- `feat(contracts): ...`
- `fix(verifier): ...`
- `chore(release): ...`

## License agreement

By contributing you accept that your contribution is provided under the MIT
license.

### DCO

Signed-off-by is recommended on commits:

`Signed-off-by: Full Name <email@example.com>`

## Community and policy

- `CODE_OF_CONDUCT.md`
- `SECURITY.md`
