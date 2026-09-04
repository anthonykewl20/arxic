#!/usr/bin/env node
/**
 * DG-12 (#256) G-3 / C-4 — criterion 2: evidence-grounded intents cover at
 * least the threshold (ADR-008 default 80%) of inventory rows.
 *
 *   node scripts/dg12-grounded-ratio.mjs docs/evidence/DG-12/<app> --threshold 80
 *
 * A row counts as grounded iff it carries >=1 intent citing evidence
 * (`evidenceRefIds` non-empty); the DG-07 builder's fail-closed resolvability
 * gate already guarantees those refs resolve to source evidence (criterion 4),
 * which this script never re-adjudicates. Threshold tuning AFTER measurement
 * is prohibited by the frozen contract — the threshold used here must match
 * the owner's pre-measurement record.
 */
import { groundedRatioForRun, loadAppRuns, loadLedger, runGate } from './dg12-lib.mjs';

function parseThreshold(argv) {
  const index = argv.indexOf('--threshold');
  const raw = index === -1 ? '80' : argv[index + 1];
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0 || value > 100) {
    console.error(`--threshold must be a percentage in (0, 100]; received ${raw}`);
    process.exit(2);
  }
  return value / 100;
}

const appDirectory = process.argv[2];
if (!appDirectory) {
  console.error(
    'usage: node scripts/dg12-grounded-ratio.mjs docs/evidence/DG-12/<app> [--threshold 80]',
  );
  process.exit(2);
}
const threshold = parseThreshold(process.argv.slice(2));

await runGate(async () => {
  const runs = await loadAppRuns(appDirectory);
  let allPass = true;
  for (const { runId, runDirectory } of runs) {
    const { ledger } = await loadLedger(runDirectory);
    const ratio = groundedRatioForRun(ledger.rows);
    const percent = (ratio.ratio * 100).toFixed(2);
    // CCR (2026-09-04, #256 DECISION): the PASS line reads grounded/EXTRACTED
    // (the extractable denominator); the all-rows ratio below is the SP-3
    // disclosure; non-extracted rows must all carry reasons (fail closed).
    const pass =
      ratio.extractedCount > 0 &&
      ratio.nonExtractedWithoutReason.length === 0 &&
      ratio.ratio >= threshold;
    const ceilingPercent = (ratio.structuralCeilingRatio * 100).toFixed(2);
    console.log(
      `grounded ${runId}: ${ratio.grounded}/${ratio.extractedCount} rows grounded (extractable denominator) = ${percent}% ` +
        `(threshold ${(threshold * 100).toFixed(0)}%) -> ${pass ? 'pass' : 'FAIL'}`,
    );
    const allRowsPercent = (
      ratio.denominator === 0 ? 0 : (ratio.grounded / ratio.denominator) * 100
    ).toFixed(2);
    console.log(
      `  all-rows disclosure ${runId}: ${ratio.grounded}/${ratio.denominator} rows grounded = ${allRowsPercent}% ` +
        `(criterion 1 still requires 100% disposition coverage over ALL rows)`,
    );
    if (ratio.extractedCount === 0) {
      console.error(
        `  NO EXTRACTED ROWS: ${runId} has zero extracted rows — the ratio is undefined and can never read as a pass`,
      );
    }
    if (ratio.nonExtractedWithoutReason.length > 0) {
      console.error(
        `  NON-EXTRACTED WITHOUT REASON: ${ratio.nonExtractedWithoutReason.slice(0, 40).join(', ')}` +
          (ratio.nonExtractedWithoutReason.length > 40
            ? ` …and ${ratio.nonExtractedWithoutReason.length - 40} more`
            : ''),
      );
    }
    console.log(
      `  structural ceiling ${runId}: ${ratio.extractedCount}/${ratio.denominator} rows are ` +
        `'extracted' = ${ceilingPercent}% is the MAXIMUM ATTAINABLE ratio by construction ` +
        `(non-extracted rows can never carry a grounded intent); this is a loose upper bound — ` +
        `some extracted rows may be ungroundable for their own reasons (e.g. wildcard routes, ` +
        `source-scan-diagnostic rows), which this script does not classify, so the true ` +
        `attainable ceiling can be lower than this number, never higher`,
    );
    if (!pass) {
      console.error(`  UNGROUNDED rows: ${ratio.ungroundedKeys.slice(0, 40).join(', ')}`);
      if (ratio.ungroundedKeys.length > 40)
        console.error(`  …and ${ratio.ungroundedKeys.length - 40} more`);
    }
    allPass = allPass && pass;
  }
  return allPass;
});
