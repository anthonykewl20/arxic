#!/usr/bin/env node
/**
 * DG-12 (#256) machine-scriptable gate sweep — runs the script-asserted
 * subset of the exit-gate sweep for one app in order and reports a per-gate
 * pass/fail table.
 *
 *   node scripts/dg12-sweep.mjs docs/evidence/DG-12/<app> <run-1-id> <run-2-id> [--threshold 80]
 *
 * Covers exactly the gates that are ALREADY pure `node scripts/dg12-*.mjs`
 * commands over recorded artifacts, unmodified, run through execFile exactly
 * as a human would invoke them by hand:
 *   - G-2 coverage           (scripts/dg12-coverage.mjs)
 *   - G-3 grounded ratio     (scripts/dg12-grounded-ratio.mjs)
 *   - G-4 replay ratio       (scripts/dg12-replay-ratio.mjs, over run-1/run-2)
 *   - G-5 fabrication audit  (scripts/dg12-fabrication-audit.mjs)
 *   - G-7 determinism        (scripts/dg12-determinism.mjs, two-run comparison
 *                              half only; see NOT COVERED below)
 *
 * NOT COVERED, and deliberately not forced into this driver:
 *   - G-1 (campaign execution) is not a script — it IS the two real `arxic
 *     run` campaigns; there is nothing to sweep, it is the precondition for
 *     every other gate.
 *   - G-6 (real-model citation + `scanTextForSecrets` redaction sweep) lives
 *     in a different tool (packages/bundle-promoter, apps/cli) with a
 *     different input shape (the #255 run-record set, not a run directory
 *     pair) — bolting it onto this driver's `<app> <run-1> <run-2>` call
 *     signature would not compose cleanly, so it stays a separate command.
 *   - G-7's `--rebuild <run>` half (byte-identical rebuild of the ledger via
 *     the real DG-07 builder) is EXCLUDED from the sweep: it dynamically
 *     imports packages/intent/src/ledger.ts, which in this environment only
 *     resolves under a TS-aware runtime (`pnpm exec tsx`), not plain `node`
 *     — forcing it into a plain-`node` sweep would make the sweep itself
 *     environment-flaky. Run it separately per app:
 *       pnpm exec tsx scripts/dg12-determinism.mjs --rebuild <run-1>
 *   - G-8 (the ADR-008 flip PR) is contractually LAST, after every other
 *     gate passes on both ratified apps — never part of a per-app sweep.
 *
 * Exit code: 0 iff every gate in this sweep passes; 1 if any gate fails or
 * cannot be evaluated (missing/malformed recorded artifacts) — fail-closed,
 * matching every sibling dg12-*.mjs script.
 */
import { execFile } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));

function parseThreshold(argv) {
  const index = argv.indexOf('--threshold');
  if (index === -1) return [];
  return ['--threshold', argv[index + 1]];
}

const [appDirectory, run1Id, run2Id] = process.argv.slice(2);
if (!appDirectory || !run1Id || !run2Id) {
  console.error(
    'usage: node scripts/dg12-sweep.mjs docs/evidence/DG-12/<app> <run-1-id> <run-2-id> [--threshold 80]',
  );
  process.exit(2);
}
const thresholdArgs = parseThreshold(process.argv.slice(2));
const run1 = join(appDirectory, 'runs', run1Id);
const run2 = join(appDirectory, 'runs', run2Id);

function run(scriptName, args) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [join(scriptDirectory, scriptName), ...args],
      { cwd: join(scriptDirectory, '..'), maxBuffer: 64 * 1024 * 1024 },
      (error, stdout, stderr) => {
        resolve({ code: error ? (error.code ?? 1) : 0, stdout, stderr });
      },
    );
  });
}

const gates = [
  { id: 'G-2', name: 'coverage', script: 'dg12-coverage.mjs', args: [appDirectory] },
  {
    id: 'G-3',
    name: 'grounded ratio',
    script: 'dg12-grounded-ratio.mjs',
    args: [appDirectory, ...thresholdArgs],
  },
  { id: 'G-4', name: 'replay ratio', script: 'dg12-replay-ratio.mjs', args: [run1, run2] },
  {
    id: 'G-5',
    name: 'fabrication audit',
    script: 'dg12-fabrication-audit.mjs',
    args: [appDirectory],
  },
  {
    id: 'G-7',
    name: 'determinism (two-run comparison)',
    script: 'dg12-determinism.mjs',
    args: [run1, run2],
  },
];

const results = [];
for (const gate of gates) {
  const result = await run(gate.script, gate.args);
  results.push({ ...gate, ...result });
  process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
}

console.log('');
console.log(`DG-12 sweep — ${appDirectory} (${run1Id} / ${run2Id})`);
console.log('| gate | check | verdict |');
console.log('| --- | --- | --- |');
for (const result of results) {
  console.log(`| ${result.id} | ${result.name} | ${result.code === 0 ? 'PASS' : 'FAIL'} |`);
}
console.log(
  'NOT COVERED by this sweep: G-1 (campaign execution — precondition), G-6 (real-model ' +
    'citation + scanTextForSecrets redaction sweep — separate tool/inputs), G-7 --rebuild ' +
    '(run `pnpm exec tsx scripts/dg12-determinism.mjs --rebuild <run-1>` separately), G-8 ' +
    '(ADR-008 flip PR — strictly last).',
);

const allPass = results.every((result) => result.code === 0);
console.log(`DG12 SWEEP: ${allPass ? 'PASS' : 'FAIL'}`);
process.exitCode = allPass ? 0 : 1;
