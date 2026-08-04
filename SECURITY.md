# Security Policy

Arxic executes untrusted repositories and reads potentially adversarial web
content. Security is core to the design (ADR §16), not an afterthought.

## Supported versions

Pre-1.0 development against the `main` branch only. There are no tagged releases
yet; fixes land on `main`.

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

## Hardening roadmap

Continued hardening (adversarial prompt-injection, origin-escape, secret-leakage,
and destructive-action tests) is tracked under Milestone 2 (ADR §22).
