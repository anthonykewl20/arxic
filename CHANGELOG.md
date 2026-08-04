# Changelog

All notable changes to Arxic are documented here. Every merged slice adds an
entry - this file is NEVER out of sync with main (see engineering-charter.md
section 8 and RELEASES.md).

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

<!-- Add new entries under [Unreleased]. One entry per merged slice. Use verbs: added/changed/deprecated/removed/fixed/security/internal. -->

### added

- M0 test foundation: vitest + AJV wired in; `pnpm test` now runs real tests (non-vacuous). Seed AJV contract-validation test in `packages/contracts/src/__tests__/` (the pattern for #2–#5). TypeScript switched to Bundler module resolution. `pnpm-workspace.yaml` approves the esbuild build.
- `SECURITY.md` disclosure SLA (ack ≤7d, assessment ≤14d, 90-day coordinated-disclosure window), contact path, explicit in/out-of-scope.
- ADR-002 (`docs/adr/002-evidenceref-resolution.md`): evidence references are opaque IDs resolved via `evidence/index.json`; defines "required transition" semantics and the SourceRevision schema home. Resolves the §10.2 vs §10.3 contract ambiguity.
- Filed 5 audit-driven issues (#40 ModelAdapter, #41 policy engine, #42 stage-4 inference, #43 stage-8 exploration, #44 attestation-acceptance); split #13; added §23.14 adapter-contract-suite acceptance to #6/#8/#10/#16/#19/#20; encoded ADR-002 scope in #2/#3; filled real-world-proof + layering in #1–#14. Totals now M0=17, M1=15 (32 total).

### changed

- Added a public summarized ADR `docs/adr/001-arxic-architecture.md` (architecture + contracts + truth states; the detailed assembly recipe is redacted). The detailed internal ADR is local-only; all public references point to the summary.
- `CONTRIBUTING.md` prerequisites corrected to Node.js 22+; how-it-works aligned to the evidence-discovery model.
- Confirmed **trunk-based** branching (no `dev`/`release` branch); documented in `CONTRIBUTING.md` and `docs/SYNC.md`.
- Repository is **PRIVATE during pre-1.0 development** (history still contains pre-mask content, visible only to the owner). A history purge will be performed before the repository is made public.

### removed

- Removed vendored upstream reference code from the repository — the product ships only Arxic-authored code (no upstream source is tracked). (Audit: pin drift / license hygiene.)
- Removed all internal references to the upstream reference collection from the public docs and configs.

### fixed

- `release.yml` now declares `permissions: contents: write` and guards against version mismatch (`tag == VERSION == package.json`) and a premature `0.0.0` release.
- CI now asserts `VERSION == package.json` and that `CHANGELOG.md` has an `[Unreleased]` section.
- Bumped `@types/node` to ^22; clarified `LICENSES/README.md`; `.gitignore` excludes `*.orig`.
- Public doc accuracy: README (5 truth states, correct milestone exits), ADR-001 marked Accepted + fixed broken table row, NOTICE/SECURITY/RELEASES/GOVERNANCE accuracy, schema READMEs tense, charter §8 PR-only wording + §1 layering note.

### internal

- Bootstrap workspace: monorepo layout (ADR §18), pnpm workspaces + tsconfig/eslint/prettier, MIT license + NOTICE.
- Canonical end-to-end architecture diagram in ADR §8.
- `docs/engineering-charter.md` (TDD red-first, Actions/Service layering, sad-path-first, real-world proof, slice-completion ritual).
- `docs/SYNC.md` living progress bookmark.
- GitHub milestones M0/M1, area labels, issue templates.
- Release-ready: CONTRIBUTING/CODE_OF_CONDUCT/SECURITY/SUPPORT/GOVERNANCE + expanded README.
- Versioning: `VERSION` + `RELEASES.md` + always-synced `CHANGELOG.md` (charter §8 + PR template require a CHANGELOG entry + VERSION sync per slice).
- CI + release workflows, Dependabot, CODEOWNERS.
- `.gitattributes` (eol=lf); Node >=22 (pnpm 11 requirement).
