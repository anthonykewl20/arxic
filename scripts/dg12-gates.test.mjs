import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * DG-12 (#256) red-first gate-script tests: every assertion script is proven
 * against recorded machine artifacts BEFORE the campaign artifacts exist —
 * pass cases AND fail cases (the gate must be able to go red; a script that
 * cannot fail proves nothing). Fixtures here are synthetic MINIMAL artifacts
 * shaped exactly like the runner's recorded layout; the real campaigns'
 * artifacts will be consumed by the same loaders.
 */

const scriptDirectory = fileURLToPath(new URL('.', import.meta.url));
const temporaryRoots = [];

function inventoryRow(key, disposition = 'extracted') {
  return {
    key,
    surfaceKind: 'endpoint',
    method: 'GET',
    path: `/${key}`,
    sourceRefs: [
      {
        kind: 'source',
        repo: 'file:///tmp/app',
        commit: 'a'.repeat(40),
        path: `routes/${key}.ts`,
        startLine: 1,
        endLine: 2,
        blobSha256: 'b'.repeat(64),
        extractor: 'ts-route-scan',
      },
    ],
    disposition,
    reason: 'route with handler',
    domain: 'content',
    verbs: ['read'],
  };
}

function ledgerRow(
  key,
  { intents = [], replayStatus = 'not-attempted', disposition = 'extracted' } = {},
) {
  return {
    inventoryKey: key,
    domain: 'content',
    surface: { kind: 'endpoint', method: 'GET', path: `/${key}` },
    disposition,
    reason: 'route with handler',
    verbs: ['read'],
    evidence: {
      sourceRefs: [
        {
          kind: 'source',
          repo: 'file:///tmp/app',
          commit: 'a'.repeat(40),
          path: `routes/${key}.ts`,
          startLine: 1,
          endLine: 2,
          blobSha256: 'b'.repeat(64),
          extractor: 'ts-route-scan',
        },
      ],
      runtimeUrls: [`/${key}`],
      runtimeForms: [],
      runtimeObservationCount: 1,
    },
    oracleKinds: [],
    truthState: 'observed',
    replayStatus,
    intents,
  };
}

function groundedIntent(id) {
  return {
    proposalId: `prop:0123456789abc${String(id).slice(-3).padStart(3, '0')}`,
    domain: 'content',
    intent: `List ${id}`,
    action: 'read',
    persona: 'anonymous',
    fromState: 'start',
    toState: 'listed',
    evidenceRefIds: ['src:routes-a.ts:1-2'],
    oracleKinds: [],
    truthState: 'observed',
    replayStatus: 'attempted:passed',
    isCandidate: false,
  };
}

async function stageRun(root, runId, { rows, ledger, artifacts = {} }) {
  const runDirectory = join(root, 'runs', runId);
  const artifactsDirectory = join(runDirectory, 'artifacts');
  await mkdir(artifactsDirectory, { recursive: true });
  await writeFile(
    join(artifactsDirectory, '13.json'),
    JSON.stringify({ kind: 'arxic-domain-inventory-stage-v1', inventory: { rows } }),
  );
  if (ledger) {
    const ledgerJson = {
      schemaVersion: 'arxic-intent-ledger-v1',
      generatedAt: '2026-08-24T00:00:00.000Z',
      source: { repository: 'file:///tmp/app', commit: 'a'.repeat(40) },
      inventory: {
        totalRows: ledger.length,
        byDisposition: {
          extracted: ledger.length,
          unsupported: 0,
          unsafe: 0,
          'unextracted-with-reason': 0,
        },
      },
      rows: ledger,
    };
    await writeFile(join(root, 'runs', `${runId}.intents.json`), JSON.stringify(ledgerJson));
  }
  for (const [name, value] of Object.entries(artifacts)) {
    await writeFile(join(artifactsDirectory, name), JSON.stringify(value));
  }
  return runDirectory;
}

async function runScript(name, args) {
  const execute = (file, fileArgs) =>
    new Promise((resolve) => {
      execFile(file, fileArgs, { cwd: scriptDirectory }, (error, stdout, stderr) => {
        resolve({ code: error ? (error.code ?? 1) : 0, stdout, stderr });
      });
    });
  return execute(process.execPath, [join(scriptDirectory, name), ...args]);
}

async function temporaryRoot() {
  const root = await mkdtemp(join(tmpdir(), 'dg12-gates-'));
  temporaryRoots.push(root);
  return root;
}

beforeAll(() => {
  // ledger.ts import inside dg12-determinism resolves via tsx-registered TS?
  // The script imports the builder directly; vitest runs these through node,
  // so the determinism --rebuild cases are exercised only when tsx is on PATH
  // via pnpm exec. Here we assert the two-run half and the loaders.
});

afterAll(async () => {
  await Promise.all(temporaryRoots.map((root) => rm(root, { recursive: true, force: true })));
});

describe('dg12-coverage (G-2 / criterion 1)', () => {
  it('passes at a 100% join with dispositions', async () => {
    const root = await temporaryRoot();
    await stageRun(root, 'run-1', {
      rows: [inventoryRow('a'), inventoryRow('b')],
      ledger: [
        ledgerRow('a', { intents: [groundedIntent('p1')] }),
        ledgerRow('b', { disposition: 'unextracted-with-reason' }),
      ],
    });
    const result = await runScript('dg12-coverage.mjs', [root]);
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain('2/2 inventory rows in ledger');
    expect(result.stdout).toContain('100% join');
  });

  it('fails when a row is missing from the ledger', async () => {
    const root = await temporaryRoot();
    await stageRun(root, 'run-1', {
      rows: [inventoryRow('a'), inventoryRow('b'), inventoryRow('c')],
      ledger: [ledgerRow('a'), ledgerRow('b')],
    });
    const result = await runScript('dg12-coverage.mjs', [root]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('MISSING from ledger: c');
  });

  it('fails closed when no campaign runs are recorded', async () => {
    const root = await temporaryRoot();
    const result = await runScript('dg12-coverage.mjs', [root]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('records no campaign runs');
  });
});

describe('dg12-grounded-ratio (G-3 / criterion 2)', () => {
  it('passes at the 80% default threshold', async () => {
    const root = await temporaryRoot();
    await stageRun(root, 'run-1', {
      rows: [
        inventoryRow('a'),
        inventoryRow('b'),
        inventoryRow('c'),
        inventoryRow('d'),
        inventoryRow('e'),
      ],
      ledger: [
        ledgerRow('a', { intents: [groundedIntent('p1')] }),
        ledgerRow('b', { intents: [groundedIntent('p2')] }),
        ledgerRow('c', { intents: [groundedIntent('p3')] }),
        ledgerRow('d', { intents: [groundedIntent('p4')] }),
        ledgerRow('e'),
      ],
    });
    const result = await runScript('dg12-grounded-ratio.mjs', [root]);
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain('4/5 rows grounded = 80.00%');
  });

  it('fails below the threshold and names the ungrounded rows', async () => {
    const root = await temporaryRoot();
    await stageRun(root, 'run-1', {
      rows: [inventoryRow('a'), inventoryRow('b')],
      ledger: [ledgerRow('a', { intents: [groundedIntent('p1')] }), ledgerRow('b')],
    });
    const result = await runScript('dg12-grounded-ratio.mjs', [root]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('UNGROUNDED rows: b');
  });

  it('rejects an out-of-range threshold', async () => {
    const root = await temporaryRoot();
    const result = await runScript('dg12-grounded-ratio.mjs', [root, '--threshold', '0']);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('threshold must be a percentage');
  });
});

describe('dg12-replay-ratio (G-4 / criterion 3)', () => {
  it('passes at 90% across the two clean runs (9/10 verified)', async () => {
    const root = await temporaryRoot();
    const keys = Array.from({ length: 5 }, (_, index) => `r${index}`);
    const ledgerFor = (failingRow) =>
      keys.map((key) =>
        ledgerRow(key, {
          intents: [groundedIntent(`p-${key}`)],
          replayStatus: key === failingRow ? 'attempted:failed' : 'attempted:passed',
        }),
      );
    await stageRun(root, 'run-1', {
      rows: keys.map((key) => inventoryRow(key)),
      ledger: ledgerFor(null),
    });
    await stageRun(root, 'run-2', {
      rows: keys.map((key) => inventoryRow(key)),
      ledger: ledgerFor('r4'),
    });
    const result = await runScript('dg12-replay-ratio.mjs', [
      join(root, 'runs', 'run-1'),
      join(root, 'runs', 'run-2'),
    ]);
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain('9/10 = 90.00%');
    expect(result.stdout).toContain('(threshold 90%) -> pass');
  });

  it('fails below 90% and names non-passing replays', async () => {
    const root = await temporaryRoot();
    await stageRun(root, 'run-1', {
      rows: [inventoryRow('a')],
      ledger: [
        ledgerRow('a', { intents: [groundedIntent('p1')], replayStatus: 'attempted:passed' }),
      ],
    });
    await stageRun(root, 'run-2', {
      rows: [inventoryRow('a')],
      ledger: [
        ledgerRow('a', { intents: [groundedIntent('p1')], replayStatus: 'attempted:failed' }),
      ],
    });
    const result = await runScript('dg12-replay-ratio.mjs', [
      join(root, 'runs', 'run-1'),
      join(root, 'runs', 'run-2'),
    ]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('NON-PASSING replays');
  });

  it('fails when zero replays were attempted', async () => {
    const root = await temporaryRoot();
    await stageRun(root, 'run-1', {
      rows: [inventoryRow('a')],
      ledger: [ledgerRow('a', { intents: [groundedIntent('p1')] })],
    });
    await stageRun(root, 'run-2', {
      rows: [inventoryRow('a')],
      ledger: [ledgerRow('a', { intents: [groundedIntent('p1')] })],
    });
    const result = await runScript('dg12-replay-ratio.mjs', [
      join(root, 'runs', 'run-1'),
      join(root, 'runs', 'run-2'),
    ]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('ZERO attempted replays');
  });
});

describe('dg12-determinism (G-7 / criterion 6) — two-run comparison half', () => {
  it('records OBSERVED model-sampling attribution for differing runs', async () => {
    const root = await temporaryRoot();
    await stageRun(root, 'run-1', {
      rows: [inventoryRow('a')],
      ledger: [ledgerRow('a', { intents: [groundedIntent('p1')] })],
    });
    await stageRun(root, 'run-2', {
      rows: [inventoryRow('a')],
      ledger: [ledgerRow('a', { intents: [{ ...groundedIntent('p2'), intent: 'List p2' }] })],
    });
    const result = await runScript('dg12-determinism.mjs', [
      join(root, 'runs', 'run-1'),
      join(root, 'runs', 'run-2'),
    ]);
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain('OBSERVED model-sampling attribution');
  });
});

describe('dg12-fabrication-audit (G-5 / criterion 4)', () => {
  const fixtureDirectory = join(scriptDirectory, '..', 'test-fixtures', 'dg12-fabrication-audit');

  it('passes over a REAL recorded koel campaign run (docs/evidence/DG-12 shape, unmodified rows)', async () => {
    // Real machine artifacts extracted verbatim from an actual `arxic run`
    // campaign (koel, run 1): artifacts/13.json inventory rows + their
    // recorded intent-ledger rows, trimmed to a self-consistent subset (every
    // evidenceRefId an included intent cites resolves within the included
    // inventory rows' own sourceRefs — no row was dropped that another row's
    // evidence depends on). Not a mock: these are the builder's real output
    // bytes, subsetted, never hand-edited field-by-field.
    const inventory = JSON.parse(
      await readFile(join(fixtureDirectory, 'koel-run1-artifacts-13.json'), 'utf8'),
    );
    const ledger = JSON.parse(
      await readFile(join(fixtureDirectory, 'koel-run1-intents.json'), 'utf8'),
    );
    const root = await temporaryRoot();
    const runDirectory = join(root, 'runs', 'run-1');
    await mkdir(join(runDirectory, 'artifacts'), { recursive: true });
    await writeFile(join(runDirectory, 'artifacts', '13.json'), JSON.stringify(inventory));
    await writeFile(join(root, 'runs', 'run-1.intents.json'), JSON.stringify(ledger));

    const result = await runScript('dg12-fabrication-audit.mjs', [root]);
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain('0 dangling evidence ref(s)');
    expect(result.stdout).toContain('0 non-extracted row(s) carrying intents');
    expect(result.stdout).toContain('zero fabricated intents');
  });

  it('fails closed when a real recorded intent is mutated to cite a non-existent evidence ref', async () => {
    // Same real fixture, but with one intent's evidenceRefIds corrupted to a
    // ref that resolves nowhere in the (still-real, untouched) inventory —
    // the exact defect the DG-07 build-time gate exists to catch, reproduced
    // here to prove the AUDIT (not just the builder) catches it too on an
    // already-recorded ledger.
    const inventory = JSON.parse(
      await readFile(join(fixtureDirectory, 'koel-run1-artifacts-13.json'), 'utf8'),
    );
    const ledger = JSON.parse(
      await readFile(join(fixtureDirectory, 'koel-run1-intents.json'), 'utf8'),
    );
    const target = ledger.rows.find(
      (row) => row.inventoryKey === 'DELETE /api/albums/:param/songs/:param',
    );
    target.intents[0].evidenceRefIds = ['src:routes-api.base.php:9999-9999'];

    const root = await temporaryRoot();
    const runDirectory = join(root, 'runs', 'run-1');
    await mkdir(join(runDirectory, 'artifacts'), { recursive: true });
    await writeFile(join(runDirectory, 'artifacts', '13.json'), JSON.stringify(inventory));
    await writeFile(join(root, 'runs', 'run-1.intents.json'), JSON.stringify(ledger));

    const result = await runScript('dg12-fabrication-audit.mjs', [root]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('DANGLING EVIDENCE REFS');
    expect(result.stderr).toContain('src:routes-api.base.php:9999-9999');
  });

  it('fails closed when a non-extracted row is hand-edited to carry a fabricated intent', async () => {
    const root = await temporaryRoot();
    await stageRun(root, 'run-1', {
      rows: [inventoryRow('a'), inventoryRow('b', 'unsupported')],
      ledger: [
        ledgerRow('a', { intents: [groundedIntent('p1')] }),
        {
          ...ledgerRow('b', { disposition: 'unsupported' }),
          intents: [groundedIntent('p2')],
        },
      ],
    });
    const result = await runScript('dg12-fabrication-audit.mjs', [root]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('FABRICATED-ON-NON-EXTRACTED-ROW');
    expect(result.stderr).toContain('b');
  });

  it('fails closed when no campaign runs are recorded', async () => {
    const root = await temporaryRoot();
    const result = await runScript('dg12-fabrication-audit.mjs', [root]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('records no campaign runs');
  });
});

describe('dg12-sweep (G-2/G-3/G-4/G-5/G-7 composed)', () => {
  // groundedIntent() above hardcodes 'src:routes-a.ts:1-2' regardless of key
  // (fine for the coverage/grounded/replay/determinism siblings, which never
  // check evidence resolution) — the fabrication audit correctly flags that
  // as dangling for every key but 'a', so per-key evidence must line up with
  // inventoryRow(key)'s own sourceRefs (path `routes/${key}.ts:1-2`).
  function groundedIntentFor(key, id) {
    return { ...groundedIntent(id), evidenceRefIds: [`src:routes-${key}.ts:1-2`] };
  }

  it('reports PASS for every gate over two clean, qualifying runs', async () => {
    const root = await temporaryRoot();
    const keys = Array.from({ length: 5 }, (_, index) => `r${index}`);
    const ledgerFor = () =>
      keys.map((key) =>
        ledgerRow(key, {
          intents: [groundedIntentFor(key, `p-${key}`)],
          replayStatus: 'attempted:passed',
        }),
      );
    await stageRun(root, 'run-1', {
      rows: keys.map((key) => inventoryRow(key)),
      ledger: ledgerFor(),
    });
    await stageRun(root, 'run-2', {
      rows: keys.map((key) => inventoryRow(key)),
      ledger: ledgerFor(),
    });

    const result = await runScript('dg12-sweep.mjs', [root, 'run-1', 'run-2']);
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain('| G-2 | coverage | PASS |');
    expect(result.stdout).toContain('| G-3 | grounded ratio | PASS |');
    expect(result.stdout).toContain('| G-4 | replay ratio | PASS |');
    expect(result.stdout).toContain('| G-5 | fabrication audit | PASS |');
    expect(result.stdout).toContain('| G-7 | determinism (two-run comparison) | PASS |');
    expect(result.stdout).toContain('NOT COVERED by this sweep: G-1');
    expect(result.stdout).toContain('DG12 SWEEP: PASS');
  });

  it('reports FAIL for the specific gate that regresses and still exits non-zero overall', async () => {
    const root = await temporaryRoot();
    // Below the 80% grounded threshold, but coverage/fabrication still hold.
    await stageRun(root, 'run-1', {
      rows: [inventoryRow('a'), inventoryRow('b')],
      ledger: [ledgerRow('a', { intents: [groundedIntent('p1')] }), ledgerRow('b')],
    });
    await stageRun(root, 'run-2', {
      rows: [inventoryRow('a'), inventoryRow('b')],
      ledger: [ledgerRow('a', { intents: [groundedIntent('p1')] }), ledgerRow('b')],
    });

    const result = await runScript('dg12-sweep.mjs', [root, 'run-1', 'run-2']);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain('| G-2 | coverage | PASS |');
    expect(result.stdout).toContain('| G-3 | grounded ratio | FAIL |');
    expect(result.stdout).toContain('| G-5 | fabrication audit | PASS |');
    expect(result.stdout).toContain('DG12 SWEEP: FAIL');
  });
});
