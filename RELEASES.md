# Releases

Package metadata uses npm-compatible SemVer syntax. The owner-defined pre-1.0
release cadence is a numeric counter, described below.

## Pre-1.0 policy (owner directive, 2026-09-05)

Release labels use **`v0.0.NNN`**:

- A **minor release adds 100**: `v0.0.100` → `v0.0.200`.
- A **patch fix adds 1**: `v0.0.100` → `v0.0.101`.
- Addition is literal: `v0.0.101` → `v0.0.201` for a minor release.
- Counter digits are padded to at least three places and never truncated or
  automatically reset. After `v0.0.900`, a minor increment is `v0.0.1000`.
- Changes to the first two numeric components require an explicit release-line
  decision; the bump commands do not guess one.

This supersedes the earlier pre-1.0 `0.MINOR.PATCH` milestone mapping. Existing
historical tags and evidence keep their original labels. Post-1.0 support and
public-surface commitments are recorded in [docs/RELEASE_POLICY.md](docs/RELEASE_POLICY.md).

### Single source of truth

`VERSION` and every non-fixture app/package manifest store the same **canonical
numeric version**, currently `0.0.100`. Public labels, CLI `--version`, dashboard
labels and Git tags use **`v0.0.100`**. Below counter 100, npm syntax remains
unpadded (`0.0.7`) and the label is `v0.0.007`; leading-zero numeric components
are invalid npm package versions.

`packages/contracts/src/version-policy.mjs` is shared by the CLI, dashboard and
release scripts. Use:

```sh
pnpm version:minor # adds 100 and aligns VERSION + all workspace manifests
pnpm version:patch # adds 1 and aligns VERSION + all workspace manifests
node scripts/version.mjs label # prints the current v-prefixed release label
```

Then update release docs/changelog and run provenance, package and behavior
gates. Fixture apps remain private at `0.0.0`.

### Current release target (2026-09-05)

**v0.0.100**, canonical `0.0.100`, is the initial web product release line.
The owner expanded the scope to a self-hosted web product (ADR-009, refs #401
and #402). The initial workbench is a development preview; the full product
exit remains open. This supersedes the earlier owner target of 0.1.0.
The older engine audit remains evidence for its recorded source tree, not an
approval for the expanded web app. No tag or npm publication is performed here.

### Versioning correction (2026-08-14)

- Owner directive: the production-release milestone is re-versioned 1.0.0 → 0.1.1 — this is not v1; the production line remains pre-1.0 `0.x`.
- Facts: the only tag ever published is `v0.2.0`; the `0.3.0` and `0.3.1` entries below were never tagged and never published to npm (no `arxic` npm package exists), and their content is subsumed into the `0.1` line.
- `VERSION`/`package.json` now read `0.1.1`; the production-hardening line ships as `0.1.1` (tag `v0.1.1` at milestone completion is a maintainer step).
- DECIDED (2026-08-15): accept non-monotonic tag history; `v0.2.0` remains published. Future releases continue from `v0.1.1` upward; `v0.1.2` … `v0.2.0-and-beyond` will supersede in time.

## Release history source

Git tags are the release history.

- `0.1.0` — `M0-EXIT (#14)`: milestone completed; not separately tagged (the project moved straight through to M1).
- `0.2.0` — `M1-EXIT (#27)` — **2026-08-10**: both fixture apps measure 14/14 MET against ADR §23. The full M1 security/integrity chain landed CI-green (#111 trace sanitization, #115 screenshot privacy, #112 bundle integrity, #108 Service Worker containment, #114 Dependabot remediation, #109 §23.12 proof). `VERSION`/`package.json` = `0.2.0`. (`v0.2.0` published; see Versioning correction.)
- `0.3.0` — first externally-usable release — 2026-08-13: the CLI is installable (`npm i -g arxic`) and drives the full pipeline to a promoted verified bundle; M2 hardening (worker transport+protocol, redaction gate, intent follow-ups). `VERSION`/`package.json` = `0.3.0`. (Tag `v0.3.0` + `npm publish` are maintainer steps — require `NPM_TOKEN`.) _(never tagged — subsumed into the 0.1 line; see Versioning correction above)_
- `0.3.1` — production-hardening batches 1+2 — 2026-08-14: credential-egress containment, worker artifact quotas + source-integrity hashing, attestation trust hardening, symlink-safe source collection, stage-11 healing deferral (ADR-007 Accepted), orchestrator run-reuse input fingerprints, trusted per-transition verification receipts with default-on network/console gating, and a stable out-of-tree CLI run root. `VERSION`/`package.json` = `0.3.1`. (Tag `v0.3.1` is a maintainer step; `v0.3.0` tag + npm publish still pending `NPM_TOKEN`.) _(never tagged — subsumed into the 0.1 line; see Versioning correction above)_
- `0.1.1` — re-versioned production-hardening line — 2026-08-14: covers everything formerly numbered 0.3.0/0.3.1 (never tagged) plus the remaining production-hardening slices (GitHub milestone "0.1.1 - Production Release", formerly numbered 1.0.0). `VERSION`/`package.json` = `0.1.1`. (Tag `v0.1.1` at milestone completion is a maintainer step; npm publish still pending `NPM_TOKEN`.)

## Release checklist

1. Ensure `CHANGELOG.md` `## [Unreleased]` is complete.
2. Decide the next bump from the unreleased section verbs.
3. Run `pnpm version:minor` (+100) or `pnpm version:patch` (+1); check that all workspace manifests match `VERSION`.
4. Rename `## [Unreleased]` to `## [x.y.z] - YYYY-MM-DD` and add a fresh
   `## [Unreleased]` at top.
5. Commit with `chore(release): x.y.z`.
6. Run `node scripts/human-flow-e2e.mjs`; this human-flow gate also runs automatically in `release.yml` before publishing.
7. Before the first automated publish, add an npm granular automation token as
   the repository `NPM_TOKEN` secret with publish access to `arxic`. The release
   workflow fails closed if it is absent. Migrate to npm trusted publishing when
   npm supports this repository's GitHub Actions OIDC identity.
8. Complete the human [screenshot inspection gate](docs/release-gates/screenshot-inspection.md) for every retained promoted screenshot and record its sign-off **before tagging or publishing**.
9. Tag the exact output of `node scripts/version.mjs label` and push the tag. Publication waits for the supported six-cell
   OS/Node matrix, the packed human-flow gate, and the release checks. The workflow
   checks the tag against `VERSION`, publishes with npm provenance, then creates
   the GitHub Release.

## Maintainer release readiness

Complete the [web product acceptance](docs/web-product-spec.md) in #402 before
calling the expanded web app release-ready. Use the
[v0.1.0 audit report](docs/reviews/release-0.1.0-398.md) for the earlier engine proof,
limitations, and CI status. Historical dry runs do not approve a new release.
The sequence is current-head checks and packed E2E → complete human screenshot
census/sign-off → configure publishing credentials → tag `v0.0.100`.
A workflow dispatch runs release validation without publishing.

## How to pick the next bump from changelog verbs

- **added / changed / removed / fixed / security** at user-observable level
  suggest an API or behavior-impacting release.
- pre-1.0, backward-incompatible or feature changes add 100 to the counter.
- fixes and patch-only changes add 1 to the counter.
- MAJOR (`1.0.0`) is reserved for the first stable release.

This is the owner-defined pre-1.0 cadence; it uses SemVer-compatible numeric syntax, with distinct increment semantics.

This process stays in sync by requiring `VERSION` and `package.json` updates in
every release and every user-visible slice.
