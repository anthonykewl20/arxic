#!/usr/bin/env node
/**
 * DG-12 (#256) G-7 / C-7 — criterion 6 (amended 2026-08-20):
 *  (a) `--rebuild <run>`: the ledger builder run TWICE over the run's recorded
 *      stage artifacts must be byte-identical modulo `generatedAt`;
 *  (b) `<run-1> <run-2>`: the two clean runs' recorded ledgers are compared,
 *      with differences recorded as OBSERVED model-sampling attribution.
 *
 *   node scripts/dg12-determinism.mjs --rebuild docs/evidence/DG-12/<app>/runs/<run>
 *   node scripts/dg12-determinism.mjs <run-1> <run-2>
 *
 * A rebuild difference NOT attributable to input artifacts fails the exit
 * (builder-determinism defect → FINDING + new issue per the contract);
 * normalizing files to force a pass is prohibited.
 */
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { attributeLedgerDifferences, loadLedger, runGate, stableLedgerJson } from './dg12-lib.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);

async function rebuildLedger(runDirectory, generatedAt) {
  // Import the DG-07 builder (pure, no side effects) from the repo tree.
  const { buildIntentLedger } = await import(
    join(scriptDirectory, '..', 'packages', 'intent', 'src', 'ledger.ts')
  );
  const readArtifact = async (name) => {
    const bytes = await readFile(join(runDirectory, 'artifacts', name), 'utf8');
    return JSON.parse(bytes);
  };
  const outcome = buildIntentLedger({
    inventory: await readArtifact('13.json'),
    inference: await readArtifact('04.json'),
    compilation: await readArtifact('09.json'),
    verification: await readArtifact('10.json'),
    generatedAt,
  });
  if (!outcome.ok) {
    throw new Error(
      `ledger rebuild over ${runDirectory} failed closed: ` +
        outcome.diagnostics.map((d) => `${d.code} ${d.subject} ${d.message ?? ''}`).join('; '),
    );
  }
  return outcome.value;
}

await runGate(async () => {
  if (args[0] === '--rebuild') {
    const runDirectory = args[1];
    if (!runDirectory) {
      console.error('--rebuild requires a run directory');
      process.exit(2);
    }
    const first = await rebuildLedger(runDirectory, '2026-08-24T00:00:00.000Z');
    const second = await rebuildLedger(runDirectory, '2026-08-24T00:00:00.000Z');
    const bytes1 = stableLedgerJson(first);
    const bytes2 = stableLedgerJson(second);
    const recorded = await loadLedger(runDirectory);
    const recordedStable = stableLedgerJson(recorded.ledger);
    const rebuildStable = bytes1 === bytes2;
    const matchesRecorded = bytes1 === recordedStable;
    console.log(
      `determinism rebuild: two rebuilds byte-identical modulo generatedAt -> ${rebuildStable ? 'pass' : 'FAIL'}`,
    );
    console.log(
      `determinism rebuild: rebuild matches the recorded ledger -> ${matchesRecorded ? 'pass' : 'FAIL'}`,
    );
    if (!matchesRecorded) {
      console.error(
        '  REBUILD MISMATCH vs recorded ledger — a difference not attributable to input artifacts is a builder-determinism defect (FINDING + new issue); never normalize files to force a pass',
      );
    }
    return rebuildStable && matchesRecorded;
  }

  if (args.length === 2) {
    const [run1, run2] = args;
    const { ledger: ledger1 } = await loadLedger(run1);
    const { ledger: ledger2 } = await loadLedger(run2);
    const differences = attributeLedgerDifferences(ledger1, ledger2);
    const identical = stableLedgerJson(ledger1) === stableLedgerJson(ledger2);
    console.log(
      `determinism two-run comparison: ${differences.length} recorded difference(s) ` +
        `(byte-identical modulo timestamps: ${identical})`,
    );
    for (const difference of differences) console.log(`  ${difference}`);
    // Two-run differences are RECORDED as OBSERVED model-sampling attribution
    // (contract amendment) — they do not fail the gate; the --rebuild half is
    // the failing assertion for builder determinism.
    return true;
  }

  console.error('usage: node scripts/dg12-determinism.mjs --rebuild <run> | <run-1> <run-2>');
  process.exit(2);
});
