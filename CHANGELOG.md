# Changelog

All notable changes to Arxic are documented here. Every merged slice adds an
entry - this file is NEVER out of sync with main (see engineering-charter.md
section 8 and RELEASES.md).

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

<!-- Add new entries under [Unreleased]. One entry per merged slice. Use verbs: added/changed/deprecated/removed/fixed/security/internal. -->

### fixed

- `release.yml` now declares `permissions: contents: write` and guards against version mismatch (`tag == VERSION == package.json`) and a premature `0.0.0` release. (Audit: release workflow could not create a release.)
- CI now asserts `VERSION == package.json` and that `CHANGELOG.md` has an `[Unreleased]` section. (Audit: no mechanical enforcement of mandatory rituals.)
- Bumped `@types/node` to ^22 to match the Node ≥22 runtime.
- `LICENSES/README.md` clarified: reserved for future vendored-code license files.
- `.gitignore` now excludes `*.orig`.
- Public doc accuracy pass: README now names all five truth states and correct milestone exits; ADR-001 marked Accepted; fixed a broken ADR table row; NOTICE/SECURITY AGPL + shipping accuracy; RELEASES pre-1.0 bump rule corrected; GOVERNANCE ADR home; schema READMEs tense; charter §8 PR-only wording + §1 layering clarification.

### changed

- Added a public summarized ADR `docs/adr/001-arxic-architecture.md` (architecture + contracts + truth states; the detailed assembly recipe is redacted). The detailed internal ADR is now local-only and all public references point to the summarized ADR.
- `CONTRIBUTING.md` prerequisites corrected to Node.js 22+; how-it-works aligned to the evidence-discovery model.

### changed

- Removed vendored upstream reference code from the repository — the product ships only Arxic-authored code (no upstream source is tracked). (Audit: pin drift / license hygiene.)

### internal

- Bootstrap workspace: monorepo layout (ADR section 18), pnpm workspaces + tsconfig/eslint/prettier, MIT license + NOTICE.
- Added canonical end-to-end architecture diagram to ADR section 8.
- Added `docs/engineering-charter.md` (TDD red-first, Actions/Service layering, sad-path-first, real-world proof, slice-completion ritual).
- Added `docs/SYNC.md` living progress bookmark.
- Added GitHub milestones M0 (14 issues) and M1 (13 issues), labels, and issue templates.
- Made repository release-ready: MIT license + NOTICE; CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, SUPPORT, GOVERNANCE; expanded public README.
- Versioning: `VERSION` single source of truth + `RELEASES.md` (SemVer; 0.1.0 at M0-EXIT, 0.2.0 at M1-EXIT) + always-synced `CHANGELOG.md`; engineering-charter §8 and the PR template now require a CHANGELOG entry + VERSION sync on every slice.
- CI (GitHub Actions: lint/typecheck/format/test), release workflow, Dependabot, issue templates, CODEOWNERS; functional eslint flat config + tsconfig with contracts entry.
- `.gitattributes` (eol=lf); target Node >=22 (pnpm 11 requirement).

### removed

- Removed all internal references to the upstream reference collection from the public repository.
- Confirmed **trunk-based** branching strategy (no `dev`/`release` branch); documented in `CONTRIBUTING.md` and `docs/SYNC.md`.
