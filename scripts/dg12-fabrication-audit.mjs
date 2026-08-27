#!/usr/bin/env node
/**
 * DG-12 (#256) G-5 / criterion 4 — fabrication audit: every intent recorded
 * in a run's ledger resolves to a real EvidenceRef in the stage-13 Domain
 * Inventory evidence index, and no non-`extracted` row carries an intent.
 *
 *   node scripts/dg12-fabrication-audit.mjs docs/evidence/DG-12/<app>
 *
 * The DG-07 ledger builder already enforces evidence resolvability at BUILD
 * time (`ARXIC-INTENT-LEDGER-EVIDENCE-UNRESOLVED`, fail-closed — a proposal
 * citing an EvidenceRef absent from the stage-13 evidence index blocks the
 * build; see packages/intent/src/ledger.ts `buildIntentLedger`). This script
 * does NOT trust that self-report: it INDEPENDENTLY re-derives the evidence
 * index from the recorded `artifacts/13.json` and checks every evidenceRefId
 * on every intent in the RECORDED ledger against it — a hand-edited or
 * corrupted ledger cannot silently read as "zero fabricated intents" just
 * because the build once succeeded (contract C-6/AC-5/G-5: "zero fabricated
 * intents; zero waved-through ref failures").
 *
 * The evidence-id grammar (`src:<sanitized-path>:<startLine>-<endLine>`) is
 * LOCKSTEP with `sourceEvidenceId` in packages/intent/src/ledger.ts:210-216
 * (part of the ledger schema contract, must not drift) and is reimplemented
 * here rather than imported, so this audit runs under plain `node` against
 * already-recorded JSON with no TypeScript/tsx runtime dependency.
 *
 * Fails closed: any dangling evidence ref, any intent recorded on a row
 * whose disposition is not `extracted`, or any missing/malformed artifact is
 * a FAIL — never a silent pass. Zero rows / zero runs is also a FAIL (an
 * empty audit can never read as "zero fabricated intents found").
 */
import {
  fabricationAuditForRun,
  loadAppRuns,
  loadInventory,
  loadLedger,
  runGate,
} from './dg12-lib.mjs';

const appDirectory = process.argv[2];
if (!appDirectory) {
  console.error('usage: node scripts/dg12-fabrication-audit.mjs docs/evidence/DG-12/<app>');
  process.exit(2);
}

await runGate(async () => {
  const runs = await loadAppRuns(appDirectory);
  let allPass = true;
  for (const { runId, runDirectory } of runs) {
    const inventory = await loadInventory(runDirectory);
    const { ledger } = await loadLedger(runDirectory);
    const audit = fabricationAuditForRun(inventory.rows, ledger.rows);
    console.log(
      `fabrication audit ${runId}: ${audit.intentCount} recorded intent(s) over ${ledger.rows.length} ledger row(s), ` +
        `${audit.danglingRefs.length} dangling evidence ref(s), ` +
        `${audit.fabricatedRowKeys.length} non-extracted row(s) carrying intents`,
    );
    if (audit.danglingRefs.length > 0) {
      console.error(
        `  DANGLING EVIDENCE REFS (waved-through ref failures): ${audit.danglingRefs.join(', ')}`,
      );
    }
    if (audit.fabricatedRowKeys.length > 0) {
      console.error(
        `  FABRICATED-ON-NON-EXTRACTED-ROW: ${audit.fabricatedRowKeys.join(', ')} carry intents despite a non-'extracted' disposition`,
      );
    }
    allPass = allPass && audit.passes;
  }
  console.log(
    `fabrication audit verdict over ${runs.length} recorded run(s): ${
      allPass ? 'zero fabricated intents' : 'FABRICATION FOUND'
    }`,
  );
  return allPass;
});
