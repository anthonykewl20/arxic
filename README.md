# Arxic

![CI](https://github.com/anthonykewl20/arxic/actions/workflows/ci.yml/badge.svg)
![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)
![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen)
![Status](https://img.shields.io/badge/status-web%20workbench%20preview-blue)

Self-hosted frontend testing workbench for source-intent discovery, AI-assisted
E2E, visual regression review, scheduled runs, and project administration.

The web workbench includes real source scanning with frontend declarations and coverage gaps, an existing AI/replay
engine with optional file-based source-row scope, dashboard-based model/persona/budget settings, Chromium screenshot comparisons, on-demand selected-workflow campaigns and a management dashboard. The full
product remains in development: authenticated visual states and comprehensive
frontend state/intent campaigns are tracked in [#402](https://github.com/anthonykewl20/arxic/issues/402).
Contributor setup and CI native-build details are in [CONTRIBUTING.md](CONTRIBUTING.md).
See the [product specification](docs/web-product-spec.md) for the exact coverage
boundary. Dashboard version labels use `v0.0.200`; canonical package versions are
`0.0.200`.

The dashboard reviews explicitly inspected and authorized screenshots with AI, preserving proposed regions, reproduction, independent criteria and model provenance. Findings remain hypotheses. HTTP and configured host agents receive bounded, hash-checked PNGs.

The dashboard uses React/shadcn for its navigation shell, overview, intent inventory, workflow selection, campaigns, run/capture review, model fields, schedules, administration and **Models & accounts** screen with provider-owned model discovery, native subscription-account bridges and [provider connections and custom model IDs](docs/web-workbench.md#provider-connections-and-model-ids) for guided AI execution and inspected-image review. Review and campaign submissions stay pending across navigation; session invalidation clears unsent consent and selections.

## Run the web app locally

```bash
pnpm install --frozen-lockfile
pnpm --filter @arxic/web exec playwright install chromium
export ARXIC_ADMIN_TOKEN="$(node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))")"
export ARXIC_WEB_ROOTS='["/absolute/path/to/your/projects"]'
pnpm web
```

Open `http://127.0.0.1:4310` and sign in with your configured token. Follow the
[web setup and deployment guide](docs/web-workbench.md) for projects, visual
baselines, AI configuration, scheduling and a server behind an HTTPS proxy.
Dependency hardening and trust boundaries are documented in [SECURITY.md](SECURITY.md).
The [CLI engine quickstart](docs/quickstart.md) covers the underlying pipeline,
attested targets and the expected no-model outcome. The
[user documentation index](docs/README.md) links to the CLI and configuration
references. Local execution is the default; `--executor worker` requires Docker
and a lockstep worker image.

## What is Arxic?

Arxic's execution engine is an evidence-discovery + verification compiler for behavioral capabilities.
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

The dashboard manages projects, queued runs, visual comparisons, baselines and
UTC schedules. The engine assembles open-source capabilities at their public seams — Playwright,
Crawlee, ast-grep, LangGraph.js, Graphology, AJV, Testcontainers, Mailpit, and
otplib. For the canonical architecture, see `docs/adr/001-arxic-architecture.md` section 8
and the pipeline in section 9. [ADR-009](docs/adr/009-web-workbench.md) records the
expanded web-product direction and the initial single-administrator architecture.

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
- Web workbench (ADR-009) - initial management/visual comparison implementation in #401; broader frontend state campaigns and visual coverage remain open in #402

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

Current scoped proof: [session and pending-request protection](docs/evidence/WEB-402-SESSIONS/summary.md), [React run and review controls](docs/evidence/WEB-402-RUN-REVIEW/summary.md), [subscription accounts and dynamic catalogs](docs/evidence/WEB-402-SUBSCRIPTIONS/summary.md), [provider/model controls](docs/evidence/WEB-402-MODELS/summary.md)
and [clean source installation/recovery](docs/evidence/WEB-402-INSTALL/summary.md).
