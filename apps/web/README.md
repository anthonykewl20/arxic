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

The visual lane compares configured viewports against approved pixels. Stable
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

Each new viewport capture retains `checkpoint-N.assessment.json`, identified by
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
