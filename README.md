# Arxic

![CI](https://github.com/anthonykewl20/arxic/actions/workflows/ci.yml/badge.svg)
![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)
![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen)
![Status](https://img.shields.io/badge/status-0.1.0%20release%20validation-blue)

Evidence-driven behavioral intent compiler that produces independently replayable
Playwright workflow bundles with explicit evidence, provenance, and verifiable
coverage.

Status: pre-1.0.0. The CLI and both local and worker executors are implemented;
domain-general intent extraction is implemented. The v0.1.0 release audit and
remaining release gates are recorded in [the audit report](docs/reviews/release-0.1.0-398.md).

## Install and quickstart

```bash
npm i -g arxic
npx arxic@latest --version
```

Then follow the [end-to-end quickstart](docs/quickstart.md) for prerequisites,
an attested local target, `arxic.yaml`, and the expected no-model outcome. The
[user documentation index](docs/README.md) links to the CLI and configuration
references. Local execution is the default; `--executor worker` requires Docker
and a lockstep worker image.

## What is Arxic?

Arxic is an evidence-discovery + verification compiler for behavioral capabilities.
It discovers capabilities from pinned source, then runs a safe test deployment and
verifies discoverable behavior with replayable Playwright runs before promotion.
Its primary output is an evidence-grounded Intent Ledger: every inventoried
surface has an explicit disposition. Replayable UI workflows are accompanying
artifacts; non-UI and unsupported surfaces remain visible in the ledger.
It does not compile user-specified requirements.

ADR §2 defines five truth states: hypothesized, observed, verified, contradicted,
and blocked. The core feasibility principle is blunt: passing one test is not
enough. An LLM may never assign `verified`; only deterministic replay verification can.

## How it works

1. Discover source and runtime evidence for candidate behaviors.
2. Reconcile evidence into a bounded coverage matrix.
3. Compile evidence-backed workflows into staged Playwright bundles.
4. Replay and verify them with policy-constrained runs and required gates (ADR §8/§9/§15).
5. Promote only when evidence, policy, coverage, and replay gates pass.

Arxic assembles proven open-source engines at their public seams — Playwright,
Crawlee, ast-grep, LangGraph.js, Graphology, AJV, Testcontainers, Mailpit, and
otplib. For the canonical architecture, see `docs/adr/001-arxic-architecture.md` section 8
and the pipeline in section 9.

## Repo map

- `docs/` - user guides, operator docs, ADRs, and engineering records
- `CHANGELOG.md` and `RELEASES.md` - root-level release and version policy
- `packages/` - package implementations
- `apps/` - application-layer entry points
- `schemas/` - schema artifacts
- `rulepacks/` - behavioral rule packs
- `test-fixtures/` - concrete scenario fixtures

## Contributor quickstart

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm test
```

The installable CLI drives the local pipeline through verification; worker mode
requires Docker.

## Roadmap

Milestones are tracked on GitHub: https://github.com/anthonykewl20/arxic/milestones

- M0-EXIT (`#14`) - one manually-supplied login candidate compiles, verifies twice, and promotes with evidence
- M1-EXIT (`#27`) - complete: two structurally different reference apps produce independently replayable bundles without app-specific generator code
- Domain-general intent extraction (ADR-008) - accepted after the DG-12 campaigns
- v0.1.0 release preparation - audit fixes merged with retained CI proof; human release gate remains explicit

## Contributing

See `CONTRIBUTING.md` and `docs/engineering-charter.md`. Slice work is guided by
the TDD and evidence-first processes in the charter and follows the repository
PR ritual.

## Versioning

Arxic follows Semantic Versioning. Current release policy and checks are defined
in `RELEASES.md`; the public-surface, support, and deprecation policy is in
[`docs/RELEASE_POLICY.md`](docs/RELEASE_POLICY.md). All notable changes are
tracked in `CHANGELOG.md`.

## License

MIT. See `LICENSE` for terms. Third-party notices are tracked in `NOTICE`.
