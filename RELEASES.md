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

Git tags are the release history.

- `0.1.0` — `M0-EXIT (#14)`: milestone completed; not separately tagged (the project moved straight through to M1).
- `0.2.0` — `M1-EXIT (#27)` — **2026-08-10**: both fixture apps measure 14/14 MET against ADR §23. The full M1 security/integrity chain landed CI-green (#111 trace sanitization, #115 screenshot privacy, #112 bundle integrity, #108 Service Worker containment, #114 Dependabot remediation, #109 §23.12 proof). `VERSION`/`package.json` = `0.2.0`. (Tag `v0.2.0` is a maintainer step.)
- `0.3.0` — first externally-usable release — 2026-08-13: the CLI is installable (`npm i -g arxic`) and drives the full pipeline to a promoted verified bundle; M2 hardening (worker transport+protocol, redaction gate, intent follow-ups). `VERSION`/`package.json` = `0.3.0`. (Tag `v0.3.0` + `npm publish` are maintainer steps — require `NPM_TOKEN`.)
- `0.3.1` — production-hardening batches 1+2 — 2026-08-14: credential-egress containment, worker artifact quotas + source-integrity hashing, attestation trust hardening, symlink-safe source collection, stage-11 healing deferral (ADR-007 Accepted), orchestrator run-reuse input fingerprints, trusted per-transition verification receipts with default-on network/console gating, and a stable out-of-tree CLI run root. `VERSION`/`package.json` = `0.3.1`. (Tag `v0.3.1` is a maintainer step; `v0.3.0` tag + npm publish still pending `NPM_TOKEN`.)

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
- pre-1.0, backward-incompatible or feature changes bump MINOR (`0.x.0`).
- fixes and patch-only changes bump PATCH.
- MAJOR (`1.0.0`) is reserved for the first stable release.

This follows SemVer §4's pre-1.0 convention.

This process stays in sync by requiring `VERSION` and `package.json` updates in
every release and every user-visible slice.
