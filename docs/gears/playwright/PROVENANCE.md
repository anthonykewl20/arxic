# Playwright — Provenance

| Field | Value |
|---|---|
| Upstream repo | https://github.com/microsoft/playwright |
| Pinned ref | 1720c55cfaddfb01a5bb4c9ddf43e42053811a25 |
| License | Apache-2.0 |
| Consumed as | npm process boundary + reference-only for adapter behavior |
| ADR section | §7.3 |
| Local location | gears/playwright/ |

## What Arxic borrows
- Planning/generation/test seam references for adapter handshakes and expected tool behavior.
- MCP-oriented test entry and planner/generator patterns for reference verification.

## Exact seams
- `src/packages/playwright/src/mcp/test/plannerTools.ts` — planner test seam reference.
- `src/packages/playwright/src/mcp/test/generatorTools.ts` — generator tool behavior reference.
- `src/packages/playwright/src/mcp/test/testTools.ts` — runtime test tool contract reference.
- `src/packages/playwright/src/mcp/test/testContext.ts` — test context model reference.
- `src/packages/playwright/src/mcp/test/testBackend.ts` — adapter/back-end test contract reference.
- `src/packages/playwright/src/mcp/test/seed.ts` — seed and startup behavior reference.
- `src/packages/playwright/src/agents/playwright-test-healer.agent.md` — healer policy reference.
- `src/packages/playwright/src/agents/playwright-test-generator.agent.md` — generator policy reference.
- `src/packages/playwright/src/agents/playwright-test-planner.agent.md` — planner policy reference.

## Notes / constraints
- Arxic only imports via public API/CLI; all files here are audit references.
- `LICENSE-MIT` was not present at the pinned path.
- Healer override is enforced: `test.fixme`, `test.skip`, `test.only`, assertion weakening, weakened assertions, and success-by-quarantine are never accepted.
