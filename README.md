# Arxic

![CI](https://github.com/anthonykewl20/arxic/actions/workflows/ci.yml/badge.svg)
![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)
![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen)
![Status](https://img.shields.io/badge/status-web%20workbench%20preview-blue)

Self-hosted frontend testing workbench for source-intent discovery, AI-assisted
E2E, visual regression review, scheduled runs, and project administration.

The web workbench includes real source scanning with frontend declarations and coverage gaps, an existing AI/replay
engine with optional file-based source-row scope, dashboard-based model/persona/budget settings, browser/theme/pixel-density screenshot comparisons, on-demand selected-workflow campaigns and a management dashboard. The full
product remains in development: authenticated visual states and comprehensive
frontend state/intent campaigns are tracked in [#402](https://github.com/anthonykewl20/arxic/issues/402).
Contributor setup and CI native-build details are in [CONTRIBUTING.md](CONTRIBUTING.md).
See the [product specification](docs/web-product-spec.md) for the exact coverage
boundary. Dashboard version labels use `v0.0.200`; canonical package versions are
`0.0.200`.

The [full visual-auditor contract](docs/visual-oracle.md) defines the requested discovery, state, geometry, typography, accessibility, heuristic and platform scope. Visual captures now retain numeric layout assessments with explicit unverified families; this is the evidence foundation, not complete visual-audit coverage.

The dashboard reviews explicitly inspected and authorized screenshots with AI, preserving proposed regions, reproduction, independent criteria and model provenance. Findings remain hypotheses. HTTP and configured host agents receive bounded, hash-checked PNGs.

Test runs now searches all stored history with project/type/status filters and bookmarkable URLs. Within a run, the capture gallery combines path/browser/theme/pixel-density/viewport/comparison filters and six-capture pagination. Capture details expose numeric measurements, solid-paint text contrast, screenshot regions and explicit coverage gaps. The dashboard includes responsive themes, keyboard navigation and [real-browser UX audit evidence](docs/evidence/WEB-402-DASHBOARD-UX/summary.md). Continuous unmasked video is unavailable; masked screenshots and sanitized action timelines provide recording evidence.

The dashboard uses React/shadcn for its navigation shell, overview, intent inventory, workflow selection, campaigns, run/capture review, model fields, schedules, administration and **Models & accounts** screen with provider-owned model discovery (including configured default HTTP connections), native subscription-account bridges and [provider connections and custom model IDs](docs/web-workbench.md#provider-connections-and-model-ids) for guided AI execution and inspected-image review. Review and campaign submissions stay pending across navigation; session invalidation clears unsent consent and selections.

## Run the web app locally

The built npm tarball also provides `arxic web` with prebuilt dashboard assets and
compiled background jobs. See [installed server setup](docs/web-workbench.md#installed-server-command).
The source-checkout commands are:

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

The [web-product progress review](docs/reviews/web-product-progress-402.md) maps the
implemented dashboard/provider work, retained proof and remaining release requirements.

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

Current scoped proof: [default-provider catalogs](docs/evidence/WEB-402-DEFAULT-CATALOG/summary.md), [session and pending-request protection](docs/evidence/WEB-402-SESSIONS/summary.md), [React run and review controls](docs/evidence/WEB-402-RUN-REVIEW/summary.md), [subscription accounts and dynamic catalogs](docs/evidence/WEB-402-SUBSCRIPTIONS/summary.md), [provider/model controls](docs/evidence/WEB-402-MODELS/summary.md)
and [clean source installation/recovery](docs/evidence/WEB-402-INSTALL/summary.md).

Latest scoped visual evidence: [solid text contrast and dashboard region inspection](docs/evidence/WEB-402-CONTRAST/summary.md).

Generated workflow replays wait for action-related network completion and stable page observations before assertions, screenshots and receipts. The same bounded settling service runs during exploration; see [the reset replay regression](docs/adr/009-web-workbench.md#2026-09-06-asynchronous-replay-completion).

Guided AI E2E can expose approved workflow checkpoint screenshots in the dashboard,
including states reached after authentication. Configure a semantic capture region
and privacy masks with explicit consent, then inspect the hash-checked checkpoint
gallery and provenance in Test runs. See the [workflow checkpoint guide](docs/web-workbench.md#workflow-checkpoints).

Visual checkpoints also support [captured-element inspection](docs/web-workbench.md#inspect-captured-elements):
filter by element type, pick a screenshot point or search capture-local element numbers, navigate measured
parents, and inspect bounds and overlapping checks. Invalid or image-unbound
evidence remains unavailable; numeric boxes are not semantic replay locators.

The web dashboard also supports opt-in [evidence retention](docs/web-workbench.md#schedules-and-history): preview expired runs, preserve baseline/review/campaign references, and recover interrupted cleanup. It is disabled by default.

Visual results distinguish the baseline used for a historical run from the currently approved baseline, preserving prior comparison evidence after approval changes.

Visual capture settings include a browser/theme matrix: Chromium, Firefox and
WebKit × light/dark × configured viewports, with environment-specific baselines,
explicit blocked environments and a shared capture budget. See the
[dashboard setup and scope](docs/web-workbench.md#browsertheme-capture-matrix).

Dashboard test drivers now support explicit Chromium, Firefox and WebKit selection, independently of target capture engines. The [installed dashboard test command](docs/web-workbench.md#dashboard-browser-verification) records engine provenance. [Dashboard proof](docs/evidence/WEB-443-BROWSERS/summary.md) documents the UX fixes, measured checks and remaining coverage boundaries; PR #444 passed installed CI and is merged.

Dashboard readability checks exercise user text spacing and 200% mounted text enlargement across real discovery and capture journeys. Navigation and text buttons grow with content; headings and folder metadata wrap across system fonts, and the model catalog supports keyboard scrolling. See [readability scope](docs/web-workbench.md#dashboard-readability-verification) for exact checks and limits.

[Readability evidence](docs/evidence/WEB-445-READABILITY/summary.md) retains the three-engine source results, measured defects, corrected screenshots and explicit limits. Successful sign-in preserves bookmarked run selection while clearing unsent session drafts and consent. PR #446 tracks required installed CI and the explicit 1/65536 CSS pixel text measurement resolution; general early-reload diagnostics remain in #447. Full release acceptance is pending.

Dashboard validation follow-up: source CI 34075361763 retained five of six required healthy-page gallery captures. Per-cell failure evidence is now retained; the original cause remains tracked in [#448](https://github.com/anthonykewl20/arxic/issues/448), and a later local pass does not discharge it.

Capture failures now carry a bounded failed-operation diagnostic and grouped browser/page recovery guidance. Navigation and missing required-mask refusals have real six-cell matrix and desktop/mobile proof; the original five-of-six CI capture loss remains unresolved in #448. No raw errors, retries or privacy waivers are added.

Blocked visual runs link directly to their current project capture settings. The real recovery journey checks saving a corrected required mask, successful rerun and preservation of the original blocked snapshot; it is included in the shared installed-dashboard contract.

A [real WebKit navigation diagnostic](docs/evidence/WEB-447-NAVIGATION/summary.md) records native/driver events and adversarial failure cases for #447; it does not suppress production errors.

Managed fixture declarations accept only `captured-mail-sink` (inbox), `test-otp`
(OTP), and `app-seed-api` or `boot-seeded-admin` (persona strategy). CLI validation and worker policy
refuse unknown or malformed names before execution, without echoing supplied
values. These optional declarations name built-in capabilities; they do not load
plugins, supply credentials, or establish fixture readiness. Omission and the
existing per-pass login declaration retain their behavior (refs #452).

Native 1×/2×/3× capture selection and density filtering merged in PR #455 after required CI 34091854414 passed. High-density Chromium uses full Chromium headless with an explicit renderer identity. That acceptance covers the scoped source and installed browser journeys; it is not full production-readiness proof.

Capture ordinals are reserved per attempted checkpoint, so a failed evidence destination does not block later healthy pages by reusing its filename. [Storage-failure proof](docs/evidence/WEB-458-WRITE-ISOLATION/summary.md) retains real red/green results and manual recovery with the original blocked snapshot unchanged. Installed acceptance includes seventeen dashboard files; #458 merged after exact-head CI passed (run 34095128927).

Literal HTML/HTM and EJS control discovery includes source lines and hashes, with explicit gaps for unevaluated template code. Declaration IDs distinguish repeated syntax on the same line, preventing stale rows after filtering a fresh scan. [Template discovery proof](docs/evidence/WEB-460-TEMPLATES/summary.md) records actual reference-page and dashboard checks; runtime business semantics remain unproved.

The intent inventory includes a matching-declaration link for each discovered project. Activate it by pointer or keyboard to focus the declaration heading without scrolling past the route table. Zero matches lead to the explicit empty result; source revision hashes wrap at narrow widths. Navigation acceptance includes 1440- and 320-pixel views.
