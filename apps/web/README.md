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

The initial visual lane captures configured anonymous viewports and compares
approved pixels. It does not perform AI semantic image review or exhaustive
business-state exploration. See tracker #402 for those release requirements.
