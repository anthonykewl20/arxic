#!/usr/bin/env node
/**
 * DG-12 (#256) G-4 / C-5 — criterion 3: verified replays / attempted replays
 * at or above 90% across the TWO clean runs.
 *
 *   node scripts/dg12-replay-ratio.mjs docs/evidence/DG-12/<app>/runs/<run-1> \
 *                                       docs/evidence/DG-12/<app>/runs/<run-2>
 *
 * Consumes the recorded verifier output wholesale via the ledger rows (the
 * builder projects `replayStatus` from artifacts/10.json); no cherry-picking
 * which replays count — every attempted row counts, attempted == 0 cannot
 * read as 100%.
 */
import { loadLedger, replayRatioForLedgers, runGate } from './dg12-lib.mjs';

const args = process.argv.slice(2);
if (args.length !== 2) {
  console.error(
    'usage: node scripts/dg12-replay-ratio.mjs docs/evidence/DG-12/<app>/runs/<run-1> <run-2>',
  );
  process.exit(2);
}

await runGate(async () => {
  const [run1, run2] = args;
  const perRun = [];
  let rows = [];
  for (const runDirectory of [run1, run2]) {
    const { ledger } = await loadLedger(runDirectory);
    perRun.push(replayRatioForLedgers(ledger.rows));
    rows = rows.concat(ledger.rows);
  }
  const combined = replayRatioForLedgers(rows);
  const threshold = 0.9;
  const percent = (combined.ratio * 100).toFixed(2);
  const pass = combined.attempted > 0 && combined.ratio >= threshold;
  for (const [index, ratio] of perRun.entries()) {
    const runPercent = (ratio.ratio * 100).toFixed(2);
    console.log(
      `replay run-${index + 1}: ${ratio.passed}/${ratio.attempted} attempted replays verified = ${runPercent}%`,
    );
  }
  console.log(
    `replay combined over the two clean runs: ${combined.passed}/${combined.attempted} = ${percent}% ` +
      `(threshold 90%) -> ${pass ? 'pass' : 'FAIL'}`,
  );
  if (combined.attempted === 0) {
    console.error('  ZERO attempted replays recorded — the ratio is 0, never 100% by absence');
  }
  if (combined.failedKeys.length > 0) {
    console.error(`  NON-PASSING replays: ${combined.failedKeys.join(', ')}`);
  }
  return pass;
});
