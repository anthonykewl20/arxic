# Midscene — Provenance

| Field | Value |
|---|---|
| Upstream repo | https://github.com/web-infra-dev/midscene |
| Pinned ref | HEAD (no ADR pin) |
| License | MIT |
| Consumed as | reference / optional adapter |
| ADR section | §6 |
| Local location | gears/midscene/ |

## What Arxic borrows
- Optional fallback for visual/semantic flows when normal DOM-based assertions are insufficient.
- Integration hints for canvas/non-DOM or inaccessible widgets.

## Notes / constraints
- Consumption is deferred and optional; findings remain observed only until Playwright assertion verification confirms behavior.
- Fetched artifacts are limited to `LICENSE`, `README.md`, and top-level docs index.
