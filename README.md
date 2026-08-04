# Arxic

![CI](https://github.com/anthonykewl20/arxic/actions/workflows/ci.yml/badge.svg)
![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)
![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen)
![Status](https://img.shields.io/badge/status-pre--MVP-blue)

Evidence-driven behavioral intent compiler that produces independently replayable
Playwright workflow bundles with explicit evidence, provenance, and verifiable
coverage.

Status: Proposed, pre-MVP (bootstrap complete; M0 in progress)

## What is Arxic?

Arxic turns behavioral requirements into replayable, evidence-backed Playwright
workflow bundles. It combines static, dynamic, and workflow-level checks so a
single slice outcome is documented with explicit evidence from each layer.

The core feasibility principle is blunt: passing one test is not enough. Arxic
classifies each result as verified, hypothesized, or blocked, and it keeps that
certainty visible through the entire pipeline.

## How it works

1. Slice-level behavior requirements are specified as composable intents.
2. Static and runtime engines from the `gears/` reference set are assembled to
   produce execution artifacts.
3. Outputs are converted into replayable Playwright bundles.
4. Promotion gates keep only evidence-backed results.

For the canonical architecture, see `docs/arxic-full-adr.md` section 8 and the
pipeline in section 9. Current gear set includes Crawlee, Playwright, Mailpit,
AST-grep, and related orchestrators.

## Repo map

- `docs/` - ADR, engineering charter, SYNC, RELEASES, CHANGELOG
- `gears/` - reference parts with provenance and license metadata
- `packages/` - package implementations
- `apps/` - application-layer entry points
- `schemas/` - schema artifacts
- `rulepacks/` - behavioral rule packs
- `test-fixtures/` - concrete scenario fixtures

## Quickstart

```bash
pnpm install
pnpm -r typecheck
pnpm lint
```

Note: the CLI and worker are not implemented yet; roadmap items are tracked in
the milestones and slices.

## Roadmap

Milestones are tracked on GitHub: https://github.com/anthonykewl20/arxic/milestones

- M0-EXIT (`#14`) - bootstrap and baseline architecture milestones
- M1-EXIT (`#27`) - contract stabilization and slice-to-slice verification

## Contributing

See `CONTRIBUTING.md` and `docs/engineering-charter.md`. Slice work is guided by
the TDD and evidence-first processes in the charter and follows the repository
PR ritual.

## Versioning

Arxic follows Semantic Versioning. Current release policy and checks are defined
in `RELEASES.md`, and all notable changes are tracked in `CHANGELOG.md`.

## License

MIT. See `LICENSE` for terms. Third-party notices are tracked in `NOTICE` and in
`gears/*/PROVENANCE.md`.
