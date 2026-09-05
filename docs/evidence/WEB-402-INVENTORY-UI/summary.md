# Inventory presentation and source references — refs #402

React/shadcn now renders intent inventory, frontend declarations and workflow
selection. API/session/campaign actions remain shared with the existing dashboard.
Source discovery still reports hypotheses and gaps; deterministic workflow
outcomes remain server-owned.

## Reproduced failures

1. After a real Next/Mailpit campaign, the login source row lacked
   `app/login/page.tsx`. The browser assertion received only the surface/domain/
   outcome text. The intent ledger nests references under `row.evidence.sourceRefs`;
   projecting source and ledger rows separately restores line-anchored evidence.
2. Mobile screenshots showed the source table clipping its evidence column.
   A new cell-bounds assertion failed (`false` versus `true`). Labeled stacked
   surface rows correct the viewport containment without widening the assertion.
3. A separate authenticated API discovery completed while the inventory stayed
   open. The new discovery incorrectly retained two old checked inputs
   (`expected 2 to be 0`). The form now remounts for its discovery identity.
4. The initial remount fix assigned identical sibling keys to workflow and
   declaration components. Strict browser lookup exposed two campaign forms;
   the diagnostic rerun reproduced this. Distinct key prefixes fix that regression.
   The strict locator was retained; it was not changed to pick the first form.

## Limits

This migrates presentation and corrects specific evidence/selection defects.
The UI uses typed views over persisted server-produced inventory and ledger
artifacts; it adds no browser schema validator. It displays the latest inventory
or ledger per project, not a union of all prior campaign outcomes. Run details,
model controls, image review and richer project dialog controls remain migration
work. The broader #402 requirements and human release inspection remain open.

Final source-bound browser proof and PR-head CI are being collected.
