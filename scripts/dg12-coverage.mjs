#!/usr/bin/env node
/**
 * DG-12 (#256) G-2 / C-3 — criterion 1: the intent ledger covers 100% of the
 * Domain Inventory denominator, every row carrying a disposition.
 *
 *   node scripts/dg12-coverage.mjs docs/evidence/DG-12/<app>
 *
 * Consumes recorded artifacts only (runs/<runId>/artifacts/13.json + the
 * recorded <runId>.intents.json ledger); deterministic on rerun; any missing
 * artifact, uncovered row, or row without a disposition → exit 1 (no manual
 * wave-through exists).
 */
import { join } from 'node:path';
import { coverageForRun, loadAppRuns, loadInventory, loadLedger, runGate } from './dg12-lib.mjs';

const appDirectory = process.argv[2];
if (!appDirectory) {
  console.error('usage: node scripts/dg12-coverage.mjs docs/evidence/DG-12/<app>');
  process.exit(2);
}

await runGate(async () => {
  const runs = await loadAppRuns(appDirectory);
  let allPass = true;
  for (const { runId, runDirectory } of runs) {
    const inventory = await loadInventory(runDirectory);
    const { ledger, source } = await loadLedger(runDirectory);
    const coverage = coverageForRun(inventory.rows, ledger.rows);
    console.log(
      `coverage ${runId}: ${coverage.covered}/${coverage.denominator} inventory rows in ledger ` +
        `(${source})`,
    );
    if (coverage.missingKeys.length > 0) {
      console.error(`  MISSING from ledger: ${coverage.missingKeys.join(', ')}`);
    }
    if (coverage.rowsWithoutDisposition.length > 0) {
      console.error(`  NO DISPOSITION: ${coverage.rowsWithoutDisposition.join(', ')}`);
    }
    if (coverage.denominator !== ledger.rows.length) {
      console.error(
        `  ROW-COUNT MISMATCH: inventory ${coverage.denominator} vs ledger ${ledger.rows.length}`,
      );
    }
    allPass = allPass && coverage.passes;
  }
  console.log(
    `coverage verdict over ${runs.length} recorded run(s): ${allPass ? '100% join with dispositions' : 'INCOMPLETE'}`,
  );
  return allPass;
});

void join;
