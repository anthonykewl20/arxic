# Arxic web workbench

Self-hosted project management, source discovery, visual baseline comparison,
AI E2E execution, UTC schedules and administrator audit history.

From the repository root, configure `ARXIC_ADMIN_TOKEN` and `ARXIC_WEB_ROOTS`,
then run `pnpm web`. See [setup and server deployment](../../docs/web-workbench.md)
and the [full product specification](../../docs/web-product-spec.md).

Actions in `server.ts`/`workbench.ts` own authorization, state and baseline
decisions. Storage/process/browser helpers provide mechanics. `job.ts` reuses
the existing source/inventory and CLI execution seams. Jobs are serialized and
isolated by process lifetime; the host is a single trusted administrative domain.

Discovery adds JS/TS/JSX/TSX component, control, action, condition, state, test, configuration
and feature-flag declarations plus Markdown/text requirement declarations.
The dashboard filters and searches these hypotheses, shows source revision,
line ranges and hashes, and exposes unsupported/changed/dirty/unsafe files.
The full JSON preserves every enumerated file and every gap. Declaration
counts are not runtime or business acceptance coverage. See the setup guide
for exact supported syntax, scan limits and omissions.

File-based AI execution supports `scope.inventoryRowIds` for current source
consumer rows. Stale selections block before model inference; unselected rows
stay visible in the complete ledger. Each engine run still attempts at most one
candidate. Guided dashboard campaigns create one serialized job per selected source row,
preserve the full denominator and survive restart. Unsupported/unselected rows
and uncompiled hypotheses remain visible. Recurring campaigns and broader state
coverage remain tracked in #402.

The visual lane compares configured browser/theme/viewport combinations against independently approved baselines. Chromium, Firefox and WebKit with light/dark are selectable; missing engines remain blocked. Older projects use Chromium/light. Stable
retained captures support inspected-image AI review with model/secret-reference/
budget/criterion controls, proposed regions, reproduction and model provenance.
Findings remain hypotheses. Optional redirect-based sign-in keeps session state in memory; comprehensive business-state exploration remains under #402.

**Connect project** is a two-step wizard: choose a workspace folder or a public
GitHub URL (cloned server-side), then confirm detected settings. Pages are a
manual list or bounded source/link discovery. Masked screenshots and sanitized action timelines are retained; continuous unmasked video is refused. **Connect agent** lists provider accounts with connection state, the
server command to run and a verify step. The UI uses one token file with
Light/Dark/System themes, one shadcn component set and one JS + one CSS bundle.

Provider/model controls use operator-owned named HTTP or host-agent connections,
provider-owned refreshing catalogs and editable custom IDs. Built-in connections
support native account CLIs and compatible subscription/API endpoints. All seven dashboard sections use React and shadcn/ui. Catalog failure timestamps remain visible. Selected credentials and
explicit HTTP rates resolve per job; host profiles require model forwarding.
See [provider setup](../../docs/web-workbench.md#provider-connections-and-model-ids).

[Subscription/catalog proof](../../docs/evidence/WEB-402-SUBSCRIPTIONS/summary.md)
retains native account results, browser artifacts and failed probes. This does
not establish the complete paid-provider or visual-defect matrix.

## Layout assessment artifacts

Each new viewport capture retains an assessment JSON named for its checkpoint (environment-prefixed for multi-environment runs), identified by
`assessmentFile` and `assessmentSha256` in the run API. Fetch it through the
authenticated `/api/runs/<run-id>/artifacts/<assessmentFile>` endpoint. The
artifact contains a bounded numeric-only layout projection and per-check verdicts
bound to the screenshot hash. Retrieval rejects altered assessment bytes.
Document overflow is measured without AI; other detector families remain
unverified. Before/after layout must match around the final screenshot as well
as the existing consecutive-PNG stability check. This does not establish atomic
scene capture or complete DOM/a11y coverage. See the
[full oracle contract](../../docs/visual-oracle.md) and
[reference-app proof](../../docs/evidence/WEB-402-ORACLE/summary.md).

Test runs searches all stored history with project/type/status filters and pagination. Navigation and run-search URLs survive refresh and Back. Capture details expose numeric checks and explicit unverified coverage with download/retry. The responsive, theme, keyboard and populated-flow audit is documented in [dashboard proof](../../docs/evidence/WEB-402-DASHBOARD-UX/summary.md).

Visual measurements now include solid-paint text contrast with numeric ratios and screenshot regions. Unsupported paint and privacy-masked text remain unverified; see the [contrast profile](../../docs/visual-oracle.md#solid-text-contrast-profile).

The selected-reset real-app regression delays the first replay submission and independently requires three successful submissions and inbox counts 1, 2, 3. This guards against a run finishing while an asynchronous action is still pending; provider responses remain controlled test-boundary data.

Guided AI execution now supports **Show workflow screenshots in run results**:
choose an exact semantic region (or a masked page), add sensitive-field masks and
confirm capture consent. The run's **Workflow checkpoints** gallery shows exported
verifier-attested images, dimensions, timestamps and original privacy provenance.
Both image and provenance reads reject changed bytes. Missing/unvalidated evidence
is explicitly unavailable. Workflow images are separate from visual baselines and
do not imply complete state coverage or a full UI audit. See the
[workflow checkpoint guide](../../docs/web-workbench.md#workflow-checkpoints).

Run-history errors are handled by the latest refresh, including background polls.
A poll that supersedes a manual search cannot leave the loading indicator stuck;
the history panel exposes Retry and hides stale results until recovery.

Viewport measurements support screenshot picking, keyboard element-number search,
pagination, parent navigation and preserved check references. Original visual PNGs
and assessments use bounded, hash-checked regular-file retrieval. Invalid geometry
or unavailable images disable inspection with recovery guidance. See the
[element inspection guide](../../docs/web-workbench.md#inspect-captured-elements);
capture-local numeric IDs do not establish semantic locators or full state coverage.

Administration includes opt-in evidence retention with whole-history previews,
explicit deletion consent, bounded idle cleanup and persisted recovery outcomes.
Manual, automatic and restart deletion share reference protections. Policy/actions
live in `retention.ts`; `retention-store.ts` supplies shared SQLite projections.
See [retention setup and limits](../../docs/web-workbench.md#schedules-and-history).

Capture results label the comparison at capture time separately from current
baseline approval. Historical image references and results remain unchanged after
approval or replacement; unavailable baseline/difference images explain why.

## Find captures in a run

**Captured pages** combines path search with browser, theme, viewport and historical
comparison filters. The matching/total count stays explicit and **Clear capture
filters** restores the complete list. Each page renders at most six captures;
keyboard pagination returns focus to the gallery heading. Selections survive polling
and reset when changing runs. Legacy captures use the documented Chromium/light
default. Filtering never changes run coverage, comparison history, approval targets
or image/measurement identities. The environment outcomes remain outside the filters.

Dashboard test drivers now support explicit Chromium, Firefox and WebKit selection, independently of target capture engines. The [installed dashboard test command](../../docs/web-workbench.md#dashboard-browser-verification) records engine provenance. [Dashboard proof](../../docs/evidence/WEB-443-BROWSERS/summary.md) documents the UX fixes, measured checks and remaining coverage boundaries; PR #444 passed installed CI and is merged.

Dashboard readability checks exercise user text spacing and 200% mounted text enlargement across real discovery and capture journeys. Navigation and text buttons grow with content; headings and folder metadata wrap across system fonts, and the model catalog supports keyboard scrolling. See [readability scope](../../docs/web-workbench.md#dashboard-readability-verification) for exact checks and limits.

[Readability evidence](../../docs/evidence/WEB-445-READABILITY/summary.md) retains the three-engine source results, measured defects, corrected screenshots and explicit limits. Successful sign-in preserves bookmarked run selection while clearing unsent session drafts and consent. PR #446 tracks required installed CI and the explicit 1/65536 CSS pixel text measurement resolution; general early-reload diagnostics remain in #447. Full release acceptance is pending.

The [WebKit navigation investigation](../../docs/evidence/WEB-447-NAVIGATION/summary.md) provides an explicit probe command; no production error waiver is enabled.
