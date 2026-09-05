# Arxic user documentation

> **Version: 0.1.0**

This is the current user-documentation snapshot for Arxic 0.1.0. The current
documented version points here; a minor or major release creates a matching
documentation snapshot, and release changes update the affected user guides.
See the [release policy](./RELEASE_POLICY.md) and
[release history](../RELEASES.md) for the versioning rules.

## Start here

| Guide                                              | Version | Use it for                                                                                |
| -------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------- |
| [Quickstart](./quickstart.md)                      | 0.1.0   | Install the CLI, prepare an attested local target, make a configuration file, and run it. |
| [CLI reference](./cli-reference.md)                | 0.1.0   | Commands, flags, environment variables, exits, and run records.                           |
| [Configuration reference](./configuration.md)      | 0.1.0   | Every accepted `arxic.yaml` field, its validation rules, and a complete example.          |
| [Attestation guide](./attestation-for-your-app.md) | 0.1.0   | Add the required target attestation endpoint to an application you may test.              |
| [Worker deployment](./operator/worker-deploy.md)   | 0.1.0   | Build and deploy the worker image in lockstep with the CLI.                               |

- [Independent bundle replay](./bundle-replay.md) — copied Playwright bundle execution and screenshot-policy setup.
- [Release audit](./reviews/release-0.1.0-398.md) — fixes, evidence and current release gates.

## Other documentation

- [Release policy](./RELEASE_POLICY.md) — public-surface, support, and
  deprecation commitments.
- [Screenshot inspection release gate](./release-gates/screenshot-inspection.md)
  — required human inspection for retained promoted screenshots.
- [Architecture decision records](./adr/README.md) — public architectural
  summaries rather than user-operation instructions.
- [Change history](../CHANGELOG.md) and [release history](../RELEASES.md).

The engineering charter, SYNC tracker, slice notes, and evidence directories
are repository-maintenance material, not user guides.
