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
