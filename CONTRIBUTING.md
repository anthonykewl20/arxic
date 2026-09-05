# Contributing to Arxic

Welcome, and thanks for helping shape Arxic.

Arxic is a self-hosted frontend testing workbench backed by an evidence-driven behavioral compiler. Contributions are expected to
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

- Node.js 22.22+
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

## Native dependency builds in CI

CI uses the matching headers bundled with the full Node distribution installed
by `actions/setup-node`. `scripts/ci-native-headers.mjs` checks the header version
and required build files, then sets node-gyp's `nodedir` through its supported
package-config environment variable. This avoids a second header download during
native dependency installation; it does not skip builds or change runtime versions.
See [node-gyp configuration](https://github.com/nodejs/node-gyp#configuration).

## Branching model

**Strategy: trunk-based development** (confirmed decision). There is no long-lived `dev` or `release` branch.

- `main` is the single integration branch. The repository has been **public since 2026-08-12** (it was private earlier in pre-1.0). Branch protection is **enabled** with `strict: true`: the required `ci` check must pass, changes land through PRs, protection is enforced for admins, linear history is required, and force-pushes are disabled. **Merge only when `ci` is green** (`gh pr checks <N> --watch` → `pass`); do not push directly or delete `main`.
- All work lands via **short-lived branches** named by intent: `feat/<scope>`, `fix/<scope>`, `docs/<scope>`, `chore/<scope>`, `spike/<scope>`. Rebase stale dependency-bump branches onto `main` before evaluating CI.
- Open a PR against `main`; the `ci` check must pass before merge. Solo maintainers may self-merge (0 required reviews). Merge style: **squash**.
- `main` is always shippable. **Releases are cut from `main` via tags** (`v0.0.100`, `v0.0.200`, …; minor increments add 100) per `RELEASES.md` — never via a release branch.
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

## Issue workflow (mandatory)

These rules apply to every issue and must never be bypassed or ignored:

1. Start work by adding the `in-progress` label and posting a comment so others can see the issue is taken.
2. Create worktrees only inside the project at `.worktrees/<branch-or-slice-id>` and remove them after merge or abandonment.
3. Set clear, zero-ambiguity acceptance criteria requiring real-world, real-live-data validation and proof.
4. Post real issue comments for every meaningful change; do not bury history or information.
5. Close an issue only with real proof and validation; do not leave completed work open.
6. If work stops mid-flight, post an update and hand-off comment so the next contributor can continue.
7. Update `README` and every affected Markdown document before closure; no documentation may be stale.

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
