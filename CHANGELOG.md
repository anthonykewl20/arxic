# Changelog

All notable changes to Arxic are documented here. Every merged slice adds an
entry - this file is NEVER out of sync with main (see engineering-charter.md
section 8 and RELEASES.md).

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

<!-- Add new entries under [Unreleased]. One entry per merged slice. Use verbs: added/changed/deprecated/removed/fixed/security/internal. -->

### internal

- Bootstrap workspace: monorepo layout (ADR section 18), pnpm workspaces + tsconfig/eslint/prettier, MIT license + NOTICE.
- Collected 17 reference gears into `gears/` with PROVENANCE + LICENSE (ADR sections 6 and 27).
- Added canonical end-to-end architecture diagram to ADR section 8.
- Added `docs/engineering-charter.md` (TDD red-first, Actions/Service layering, sad-path-first, real-world proof, slice-completion ritual).
- Added `docs/SYNC.md` living progress bookmark.
- Added GitHub milestones M0 (14 issues) and M1 (13 issues), labels, and issue templates.
- Made repository release-ready: MIT license + NOTICE; CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, SUPPORT, GOVERNANCE; expanded public README.
- Versioning: `VERSION` single source of truth + `RELEASES.md` (SemVer; 0.1.0 at M0-EXIT, 0.2.0 at M1-EXIT) + always-synced `CHANGELOG.md`; engineering-charter §8 and the PR template now require a CHANGELOG entry + VERSION sync on every slice.
- CI (GitHub Actions: lint/typecheck/format/test), release workflow, Dependabot, issue templates, CODEOWNERS; functional eslint flat config + tsconfig with contracts entry.
- `.gitattributes` (eol=lf, `gears/` linguist-vendored); target Node >=22 (pnpm 11 requirement).
