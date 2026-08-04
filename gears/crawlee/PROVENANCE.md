# Crawlee — Provenance

| Field | Value |
|---|---|
| Upstream repo | https://github.com/apify/crawlee |
| Pinned ref | 5401ab9770bd2e2e5629316c8b2a7690c39e8096 |
| License | Apache-2.0 |
| Consumed as | public npm API contracts (BREADTH DISCOVERY ONLY reference scope) |
| ADR section | §7.4 |
| Local location | gears/crawlee/ |

## What Arxic borrows
- Surface discovery flow controls for bounded request crawling.
- Storage and routing primitives used for discovery policies.

## Exact seams
- `src/packages/playwright-crawler/src/internals/playwright-crawler.ts` — bounded Playwright-backed crawling semantics.
- `src/packages/playwright-crawler/src/index.ts` — public crawler entrypoint shape.
- `src/packages/core/src/storages/request_queue.ts` — queue control contract.
- `src/packages/core/src/session_pool/session_pool.ts` — session policy control contract.
- `src/packages/core/src/router.ts` — route/handler policy seam.

## Notes / constraints
- Discoveries are observations only; they do not imply verified transitions.
- Arxic policies add constraints from ADR §7.4: no destructive submission without approved policy, no transition inference from page presence, no parallel mutable-identity workflows, and strict origin/budget boundaries.
