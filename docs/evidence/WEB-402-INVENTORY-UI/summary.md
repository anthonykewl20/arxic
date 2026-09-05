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

## Final browser proof

Source revision: `f673f33a3d7dc9c3aec0bf78786d3ee1efb18e59`, rebased onto merged
PR #414. Full web area: **47 tests in 13 files pass, 232.63 s**. Root/package type
checks, lint and the license gate also pass locally. Full-repository format after
final documentation: `All matched files use Prettier code style!`. Required final PR-head CI and merge remain
pending; no release completion is claimed.

| User-level test | Result | Proof |
| --- | --- | --- |
| Invalid login/root/credentials, real source declarations and filtering, exact custom model persistence, baseline comparison, UTC schedule/audit, mobile fit and late logout responses | PASS | [Core timeline](core/timeline.json), [provenance](core/timeline.sanitization.json), 13 named PNGs |
| Missing guided setup blocks; two selected real workflows each pass two verifier replays; unselected/unsupported rows remain visible; source references fit mobile; new discovery clears old selection without duplicate forms | PASS | [Campaign timeline](campaign/timeline.json), [provenance](campaign/timeline.sanitization.json), six named PNGs |

The actual Next.js/Express reference apps, Chromium, source scanner, compiler and
Mailpit execute. Only the external model response is a boundary stub; fresh
subscription inference is not claimed for this UI slice. All 19 named PNGs were
agent-inspected, and their hashes plus both timeline hashes match adjacent privacy
and sanitization records: [inspection manifest](inspection.json). Screenshots use
capture-time masking and persona-free reference states. Raw traces and credential
caches are not retained. Human release inspection is not claimed.

The new assertions failed before their fixes and pass unchanged. No matcher was
widened, no strict locator changed to select the first duplicate, and no test was
skipped. The additional API rediscovery is a real authenticated request while the
browser remains on the inventory page.
