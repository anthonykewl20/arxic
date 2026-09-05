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

The visual lane compares anonymous viewports against approved pixels. Stable
retained captures support inspected-image AI review with model/secret-reference/
budget/criterion controls, proposed regions, reproduction and model provenance.
Findings remain hypotheses. Authenticated checkpoints and comprehensive
business-state exploration remain under #402.

Provider/model controls use operator-owned named HTTP or host-agent connections,
provider-specific suggestions and editable custom IDs. Selected credentials and
explicit HTTP rates resolve per job; host profiles require model forwarding.
See [provider setup](../../docs/web-workbench.md#provider-connections-and-model-ids).
