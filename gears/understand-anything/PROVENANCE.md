# Understand Anything — Provenance

| Field | Value |
|---|---|
| Upstream repo | https://github.com/Egonex-AI/Understand-Anything |
| Pinned ref | fe8c5bc591716aafd79b4765549328f08ef5a52e |
| License | MIT |
| Consumed as | vendored subset behind SourceIndexer |
| ADR section | §7.1 |
| Local location | gears/understand-anything/ |

## What Arxic borrows
- Deterministic static scan primitives and normalized structure extraction.
- TypeScript extractor and language/framework registry hooks.
- Playwright-specific helper structure for batching and structure output.

## Exact seams
- `src/understand-anything-plugin/skills/understand/scan-project.mjs` — project discovery and scan orchestration.
- `src/understand-anything-plugin/skills/understand/extract-structure.mjs` — deterministic source structure extraction.
- `src/understand-anything-plugin/skills/understand/extract-structure-result.mjs` — normalized extraction output shape.
- `src/understand-anything-plugin/skills/understand/compute-batches.mjs` — bounded batching of extractor regions.
- `src/understand-anything-plugin/packages/core/src/plugins/tree-sitter-plugin.ts` — parser plugin seam.
- `src/understand-anything-plugin/packages/core/src/plugins/extractors/typescript-extractor.ts` — TypeScript extraction seam.
- `src/understand-anything-plugin/packages/core/src/languages/framework-registry.ts` — framework hint registry seam.

## Notes / constraints
- `src/understand-anything-plugin/agents/domain-analyzer.md` and `src/understand-anything-plugin/skills/understand-domain/extract-domain-context.py` are hypothesis producers only and are not used as verifiers.
- Tree-sitter grammar license compatibility is checked separately from the parent license.
- Missing candidate paths were originally requested as `packages/core/...`; discovered actual files are under `understand-anything-plugin/packages/core/...`.
