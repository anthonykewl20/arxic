# Releases

This project follows [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html).

## Pre-1.0 policy

Before `1.0.0`, versions use `0.MINOR.PATCH`:

- Milestone exits are **minor** releases.
- Slice-level fixes are **patch** releases.
- Breaking changes are allowed pre-1.0 when required by validation.

For the post-1.0 public-surface, support, and deprecation commitments, see
[`docs/RELEASE_POLICY.md`](docs/RELEASE_POLICY.md).

### Single source of truth

`VERSION` is the source of truth for current version. `package.json` version
must mirror `VERSION` exactly for each release.

### Versioning correction (2026-08-14)

- Owner directive: the production-release milestone is re-versioned 1.0.0 → 0.1.1 — this is not v1; the production line remains pre-1.0 `0.x`.
- Facts: the only tag ever published is `v0.2.0`; the `0.3.0` and `0.3.1` entries below were never tagged and never published to npm (no `arxic` npm package exists), and their content is subsumed into the `0.1` line.
- `VERSION`/`package.json` now read `0.1.1`; the production-hardening line ships as `0.1.1` (tag `v0.1.1` at milestone completion is a maintainer step).
- OPEN MAINTAINER DECISION: the published tag `v0.2.0` sorts above `0.1.1`; either delete the `v0.2.0` tag+release and renumber, or accept non-monotonic tag history. This correction deletes nothing.

## Release history source

Git tags are the release history.

- `0.1.0` — `M0-EXIT (#14)`: milestone completed; not separately tagged (the project moved straight through to M1).
- `0.2.0` — `M1-EXIT (#27)` — **2026-08-10**: both fixture apps measure 14/14 MET against ADR §23. The full M1 security/integrity chain landed CI-green (#111 trace sanitization, #115 screenshot privacy, #112 bundle integrity, #108 Service Worker containment, #114 Dependabot remediation, #109 §23.12 proof). `VERSION`/`package.json` = `0.2.0`. (Tag `v0.2.0` is a maintainer step.)
- `0.3.0` — first externally-usable release — 2026-08-13: the CLI is installable (`npm i -g arxic`) and drives the full pipeline to a promoted verified bundle; M2 hardening (worker transport+protocol, redaction gate, intent follow-ups). `VERSION`/`package.json` = `0.3.0`. (Tag `v0.3.0` + `npm publish` are maintainer steps — require `NPM_TOKEN`.) _(never tagged — subsumed into the 0.1 line; see Versioning correction above)_
- `0.3.1` — production-hardening batches 1+2 — 2026-08-14: credential-egress containment, worker artifact quotas + source-integrity hashing, attestation trust hardening, symlink-safe source collection, stage-11 healing deferral (ADR-007 Accepted), orchestrator run-reuse input fingerprints, trusted per-transition verification receipts with default-on network/console gating, and a stable out-of-tree CLI run root. `VERSION`/`package.json` = `0.3.1`. (Tag `v0.3.1` is a maintainer step; `v0.3.0` tag + npm publish still pending `NPM_TOKEN`.) _(never tagged — subsumed into the 0.1 line; see Versioning correction above)_
- `0.1.1` — re-versioned production-hardening line — 2026-08-14: covers everything formerly numbered 0.3.0/0.3.1 (never tagged) plus the remaining production-hardening slices (GitHub milestone "0.1.1 - Production Release", re-versioned from "1.0.0 - Production Release"). `VERSION`/`package.json` = `0.1.1`. (Tag `v0.1.1` at milestone completion is a maintainer step; npm publish still pending `NPM_TOKEN`.)

## Release checklist

1. Ensure `CHANGELOG.md` `## [Unreleased]` is complete.
2. Decide the next bump from the unreleased section verbs.
3. Update `VERSION` and `package.json` versions identically.
4. Rename `## [Unreleased]` to `## [x.y.z] - YYYY-MM-DD` and add a fresh
   `## [Unreleased]` at top.
5. Commit with `chore(release): x.y.z`.
6. Complete the human [screenshot inspection gate](docs/release-gates/screenshot-inspection.md) for every retained promoted screenshot and record its sign-off.
7. Before the first automated publish, add an npm granular automation token as
    the repository `NPM_TOKEN` secret with publish access to `arxic`. The release
    workflow fails closed if it is absent. Migrate to npm trusted publishing when
    npm supports this repository's GitHub Actions OIDC identity.
8. Run the Release workflow manually once to exercise its dry-run path; it runs
    all gates but does not publish or create a release.
9. Tag `vx.y.z` and push the tag. The tag workflow verifies it matches `VERSION`,
    publishes `arxic` with npm provenance, then creates the GitHub Release.

## How to pick the next bump from changelog verbs

- **added / changed / removed / fixed / security** at user-observable level
  suggest an API or behavior-impacting release.
- pre-1.0, backward-incompatible or feature changes bump MINOR (`0.x.0`).
- fixes and patch-only changes bump PATCH.
- MAJOR (`1.0.0`) is reserved for the first stable release.

This follows SemVer §4's pre-1.0 convention.

This process stays in sync by requiring `VERSION` and `package.json` updates in
every release and every user-visible slice.
