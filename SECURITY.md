# Security Policy

Arxic executes untrusted repositories and reads potentially adversarial web
content. This is core to the design in ADR section 16 and part of the threat
model.

Supported versions: pre-1.0 development against `main` branch.

## Reporting a vulnerability

Please report security issues through GitHub Private Vulnerability Reporting or
use the repository Security Advisory flow. Do not open a public issue for security
reports.

## Response

We provide best-effort triage and remediation and will disclose fixes through
our normal release process.

## Scope

- Scope includes Arxic source code and workflows.
- Vulnerabilities in upstream engines (for example Playwright, Crawlee, Mailpit,
  otp, and other third-party systems) should be reported upstream.
- Vendored reference code under `gears/` is for bootstrap and is not shipped with
  releases.

## Trust boundaries

- Workers run in isolated non-root environments.
- Default-deny egress is expected for workers.
- Fixtures are leased and scoped per run.
- All external content is treated as data and validated before use.

## Hardening roadmap

See ADR section 16 and milestone M2 planning for continued hardening work.
