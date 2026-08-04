# Contributing to Arxic

Welcome, and thanks for helping shape Arxic.

Arxic is an evidence-driven behavioral compiler. Contributions are expected to
produce replayable behavior artifacts and evidence, then verify that evidence in
independent runs.

## How Arxic works

It translates behavioral intents into independently replayable Playwright workflow
bundles using verified evidence and provenance, grounded in the architecture and
truth-state model in `docs/arxic-full-adr.md`.

See also `docs/engineering-charter.md` for project-specific process.

## Prerequisites

- Node.js 20+
- pnpm 11

## Getting started

```bash
pnpm install
pnpm -r typecheck
```

Optional:

```bash
pnpm lint
pnpm format:check
pnpm test
```

## Branching model

- `main` is protected.
- Use short-lived feature branches.
- Open pull requests against `main`.

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
