# Releases

This project follows [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html).

## Pre-1.0 policy

Before `1.0.0`, versions use `0.MINOR.PATCH`:

- Milestone exits are **minor** releases.
- Slice-level fixes are **patch** releases.
- Breaking changes are allowed pre-1.0 when required by validation.

### Single source of truth

`VERSION` is the source of truth for current version. `package.json` version
must mirror `VERSION` exactly for each release.

## Release history source

Git tags are the release history. Update `RELEASES.md` with the first two
milestone exits:

- `0.1.0` ships at `M0-EXIT (#14)`
- `0.2.0` ships at `M1-EXIT (#27)`

## Release checklist

1. Ensure `CHANGELOG.md` `## [Unreleased]` is complete.
2. Decide the next bump from the unreleased section verbs.
3. Update `VERSION` and `package.json` versions identically.
4. Rename `## [Unreleased]` to `## [x.y.z] - YYYY-MM-DD` and add a fresh
   `## [Unreleased]` at top.
5. Commit with `chore(release): x.y.z`.
6. Tag `vx.y.z`.
7. Push tag and let the release workflow publish a GitHub Release.

## How to pick the next bump from changelog verbs

- **added / changed / removed / fixed / security** at user-observable level
  suggest an API or behavior-impacting release.
- If the change is a backward compatible behavior-level expansion, bump minor.
- If it is a compatibility break at the same pre-1.0 cadence, bump major.
- If it is implementation-only maintenance, bump patch.

This process stays in sync by requiring `VERSION` and `package.json` updates in
every release and every user-visible slice.
