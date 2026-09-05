# Security Policy

Arxic inspects repositories and potentially adversarial web content. Local and
dashboard execution requires trusted project folders and operator-configured host
tools; it is not a hostile-code or multi-tenant sandbox. Worker isolation and
evidence controls have the boundaries described below (ADR §16).

## Supported versions

Pre-1.0 fixes land on `main`. The current web workbench line is unreleased
`v0.0.200`. The historical `v0.2.0` engine release remains published; it does not
represent the expanded web product or its current security fixes.

## Reporting a vulnerability

**Please do not open a public issue.** Report privately via
[GitHub Private Vulnerability Reporting / Security Advisories](https://github.com/anthonykewl20/arxic/security/advisories/new).
Include: a description, impact, reproduction steps, and any affected
commit/version. Acknowledgment of valid reports is made in the advisory.

## Response SLA (best-effort)

| Stage                         | Target                                                 |
| ----------------------------- | ------------------------------------------------------ |
| Acknowledgment of report      | ≤ 7 days                                               |
| Initial assessment + severity | ≤ 14 days                                              |
| Coordinated disclosure window | ≤ 90 days from report (adjustable by mutual agreement) |
| Fix release                   | per severity, via the normal release process           |

These are best-effort targets for a pre-1.0, maintainer-run project.

## Scope

**In scope** — Arxic's own product code and generated workflows:

- worker isolation or sandbox escape;
- test-target attestation bypass (accepting an unapproved/production target);
- policy-engine bypass (origin, action-class, or fail-closed checks);
- secret / PII leakage into bundles, screenshots, traces, or reports;
- promotion-gate bypass or last-known-good corruption.

**Out of scope** — report these upstream, not here:

- vulnerabilities in upstream third-party engines Arxic consumes (they are not
  vendored in this repository);
- vulnerabilities in dependencies of the reference fixture test apps;
- findings that require already-privileged local execution of the tool itself.

## Trust boundaries (design intent)

- Workers run in isolated, non-root, ephemeral environments on a job-scoped network.
- Worker egress is default-deny (declared origins only).
- Fixtures are leased, scoped per run, and destroyed on completion.
- All external content (source, pages, mail, accessibility snapshots) is treated
  as data and validated; it cannot change system policy or authorize actions.
- An LLM may never assign `verified`; only deterministic replay verification can.
- Raw Playwright trace ZIPs are prohibited retained evidence. Only the shared sanitizer's independently inspected action timeline plus adjacent provenance may reach assembly or promotion; screenshots have a separate capture-time masking and visual-review boundary.

## Historical exposure decision

On 2026-08-12, the repository accepted the pre-public history exposure rather
than rewriting public history. The removed full internal ADR and
reference-collection script remain reachable in old commits; the recorded
rationale is that the exposure contained no credentials, the full-history
gitleaks result then had only false-positive SHA/digest matches, the public ADR
already disclosed the architecture, and rewriting every commit SHA was
disproportionate. See `docs/SYNC.md:156-158` for the recorded decision.

Do not purge history without a scoped recovery plan and explicit repository
owner authorization. Revisit this decision immediately if a genuinely sensitive
item (for example, a credential, private customer data, or material not meant
for public disclosure) is found in history. At each release re-evaluation, run
a fresh full-history secret scan and have the maintainer record the result
before reconfirming the decision.

## Dependency hardening

The [stream-json assessment](docs/reviews/stream-json-406.md) records the bounded
path-filter patch for GHSA-528h-pc64-c93x and Crawlee compatibility proof. The
lockfile pins the patch; version-only scanners may still report stock 1.9.1.
Use frozen-lockfile installs and retain the patch until a compatible fixed
upstream dependency replaces it.

## Current hardening work

Milestone 2 engine hardening is implemented; see the architecture record and
`docs/SYNC.md` for its historical gates. Expanded web-product controls and release
proof remain tracked in [#402](https://github.com/anthonykewl20/arxic/issues/402).
The existing worker boundary does not imply equivalent isolation for local or
host-agent execution.
