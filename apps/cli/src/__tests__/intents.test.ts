import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanTextForSecrets } from '@arxic/bundle-promoter';
import { parseArgs } from '../args';
import { runCli } from '../index';
import {
  buildIntentLedger,
  stageIntentLedger,
  validateIntentLedger,
} from '../../../../packages/intent/src/ledger';

/**
 * DG-07 (#251): the read-only `arxic intents PATH [--json]` command — parser
 * surface, rendering (run dir both lanes + assembled bundle dir), zero-write
 * proof, and the refusal sad paths SP-2/SP-3/SP-5 plus the real-scanner SP-4.
 */

const COMMIT = '0123456789abcdef0123456789abcdef01234567';
const BLOB = 'b'.repeat(64);
const FORGOT_INVENTORY_ID_PREFIX = 'inv:page:POST:';

describe('parseArgs: intents command', () => {
  it('parses a path and the --json flag', () => {
    expect(parseArgs(['intents', '/runs/abc'])).toEqual({
      ok: true,
      command: { kind: 'intents', path: '/runs/abc' },
    });
    expect(parseArgs(['intents', '/runs/abc', '--json'])).toEqual({
      ok: true,
      command: { kind: 'intents', path: '/runs/abc', json: true },
    });
  });

  it('rejects a missing path, extra positionals, and unknown flags fail-closed', () => {
    expect(parseArgs(['intents'])).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'ARXIC-CLI-USAGE', severity: 'blocked' }],
    });
    expect(parseArgs(['intents', '/a', '/b'])).toMatchObject({ ok: false });
    expect(parseArgs(['intents', '/a', '--yaml'])).toMatchObject({ ok: false });
  });

  it('keeps the run command and top-level flags untouched (additive surface)', () => {
    expect(parseArgs(['run', '--config', 'x'])).toEqual({
      ok: true,
      command: { kind: 'run', config: 'x' },
    });
    expect(parseArgs(['--version'])).toEqual({ ok: true, command: { kind: 'version' } });
    expect(parseArgs(['launch'])).toMatchObject({ ok: false });
  });
});

describe('runCli: arxic intents', () => {
  it('renders the ledger from a local-lane run dir (human table) with zero writes', async () => {
    const runDirectory = await fixtureRunDir('local');
    const before = await directoryFingerprint(runDirectory);
    const output: string[] = [];
    const errors: string[] = [];
    const result = await runCli(['intents', runDirectory], {
      stdout: { write: (message) => void output.push(message) },
      stderr: { write: (message) => void errors.push(message) },
    });
    expect(result.exitCode).toBe(0);
    expect(errors.join('')).toBe('');
    const rendered = output.join('');
    expect(rendered).toContain('POST /forgot-password');
    expect(rendered).toContain('account-recovery');
    expect(rendered).toContain('verified');
    expect(rendered).toContain('attempted:passed');
    expect(rendered).toContain(FORGOT_INVENTORY_ID_PREFIX);
    expect(await directoryFingerprint(runDirectory)).toEqual(before);
  });

  it('renders machine JSON from an assembled bundle dir with --json, deterministically', async () => {
    const bundleDirectory = await fixtureBundleDir();
    const before = await directoryFingerprint(bundleDirectory);
    const first: string[] = [];
    const second: string[] = [];
    const resultOne = await runCli(['intents', bundleDirectory, '--json'], {
      stdout: { write: (message) => void first.push(message) },
    });
    const resultTwo = await runCli(['intents', bundleDirectory, '--json'], {
      stdout: { write: (message) => void second.push(message) },
    });
    expect(resultOne.exitCode).toBe(0);
    expect(resultTwo.exitCode).toBe(0);
    expect(first.join('')).toBe(second.join(''));
    const parsed = JSON.parse(first.join('')) as { schemaVersion: string };
    expect(parsed.schemaVersion).toBe('arxic-intent-ledger-v1');
    expect(validateIntentLedger(parsed)).toMatchObject({ ok: true });
    expect(await directoryFingerprint(bundleDirectory)).toEqual(before);
  });

  it('renders from a worker-imported run dir (nested checkpoints layout)', async () => {
    const runDirectory = await fixtureRunDir('worker');
    const output: string[] = [];
    const result = await runCli(['intents', runDirectory], {
      stdout: { write: (message) => void output.push(message) },
    });
    expect(result.exitCode).toBe(0);
    expect(output.join('')).toContain('POST /forgot-password');
  });

  it('refuses a run dir with no resolvable artifacts/13.json (SP-2)', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'arxic-intents-empty-'));
    const errors: string[] = [];
    const output: string[] = [];
    const result = await runCli(['intents', empty], {
      stdout: { write: (message) => void output.push(message) },
      stderr: { write: (message) => void errors.push(message) },
    });
    expect(result.exitCode).toBeGreaterThan(0);
    expect(errors.join('')).toContain('ARXIC-INTENT-LEDGER-INVENTORY-MISSING');
    expect(output.join('')).toBe('');
  });

  it('refuses a schema-invalid ledger and an unknown schemaVersion without partial output (SP-3)', async () => {
    const invalid = await fixtureRunDir('local');
    const ledger = JSON.parse(await readFile(join(invalid, 'intents.json'), 'utf8')) as object;
    delete (ledger as { rows?: unknown[] }).rows;
    await writeFile(join(invalid, 'intents.json'), JSON.stringify(ledger));

    const errors: string[] = [];
    const output: string[] = [];
    const result = await runCli(['intents', invalid], {
      stdout: { write: (message) => void output.push(message) },
      stderr: { write: (message) => void errors.push(message) },
    });
    expect(result.exitCode).toBeGreaterThan(0);
    expect(errors.join('')).toContain('ARXIC-INTENT-LEDGER-SCHEMA-INVALID');
    expect(output.join('')).toBe('');

    const unknown = await fixtureRunDir('local');
    const versioned = JSON.parse(await readFile(join(unknown, 'intents.json'), 'utf8')) as {
      schemaVersion: string;
    };
    versioned.schemaVersion = 'arxic-intent-ledger-v2';
    await writeFile(join(unknown, 'intents.json'), JSON.stringify(versioned));
    const versionErrors: string[] = [];
    const versionResult = await runCli(['intents', unknown], {
      stdout: { write: () => undefined },
      stderr: { write: (message) => void versionErrors.push(message) },
    });
    expect(versionResult.exitCode).toBeGreaterThan(0);
    expect(versionErrors.join('')).toContain('ARXIC-INTENT-LEDGER-VERSION-UNKNOWN');
  });

  it('refuses garbage PATH arguments with the usage shape, zero writes, no stack trace (SP-5)', async () => {
    const plainFile = join(await mkdtemp(join(tmpdir(), 'arxic-intents-file-')), 'plain.txt');
    await writeFile(plainFile, 'not a directory');
    for (const garbage of [
      plainFile,
      join(tmpdir(), `arxic-intents-nonexistent-${Date.now()}`),
      '',
    ]) {
      const errors: string[] = [];
      const result = await runCli(['intents', garbage], {
        stderr: { write: (message) => void errors.push(message) },
      });
      expect(result.exitCode).toBe(2);
      expect(errors.join('')).toContain('ARXIC-CLI-USAGE');
      expect(errors.join('')).not.toContain(' at ');
    }
  });

  it('blocks a ledger carrying a planted bearer token through the REAL redaction scanner (SP-4)', async () => {
    const runDirectory = await fixtureRunDir('local', { bearerInAction: true });
    const outcome = await stageIntentLedger({
      runDirectory,
      generatedAt: '2026-08-18T15:00:00.000Z',
      scan: scanTextForSecrets,
    });
    expect(outcome).toMatchObject({
      ok: false,
      diagnostics: [expect.objectContaining({ code: 'ARXIC-PROMOTION-REDACTION-FAILED' })],
    });
    // The pre-planted clean ledger was replaced by nothing: no intents.json may
    // exist after a failed staging attempt over the same run dir.
    await expect(readdir(runDirectory)).resolves.not.toContain('intents.json');
  });
});

// ---------------------------------------------------------------------------
// Fixtures: a run dir (either lane layout) with a real builder-produced ledger
// ---------------------------------------------------------------------------

function sourceRef(path: string, startLine: number, endLine: number) {
  return {
    kind: 'source',
    repo: 'file:///tmp/fixture-source',
    commit: COMMIT,
    path,
    startLine,
    endLine,
    blobSha256: BLOB,
    extractor: 'nextjs-file-conventions:route',
  };
}

function inventoryEnvelope() {
  return {
    kind: 'arxic-domain-inventory-stage-v1',
    schemaVersion: 1,
    inventory: {
      schemaVersion: 1,
      generatedAt: '2026-08-18T10:00:00.000Z',
      rows: [
        {
          key: 'POST /forgot-password',
          surfaceKind: 'page',
          method: 'POST',
          path: '/forgot-password',
          origin: 'source',
          sourceRefs: [sourceRef('app/forgot-password/actions.ts', 5, 44)],
          runtimeRefs: [],
          runtimeUrls: [],
          observedForms: [],
          disposition: 'extracted',
          reason: '',
          domain: 'authentication',
          verbs: ['request'],
          count: 1,
        },
      ],
      stats: {
        totalRows: 1,
        byDisposition: { extracted: 1, unsupported: 0, unsafe: 0, 'unextracted-with-reason': 0 },
      },
    },
    stableSha256: 'c'.repeat(64),
    providerIncludes: { resolutions: [], unresolved: [] },
    evidenceGraph: {
      nodes: 0,
      edges: 0,
      outputInfluencingEdges: 0,
      canonicalSha256: '0'.repeat(64),
    },
  };
}

function inferenceArtifact(bearerInAction: boolean) {
  const rowId = `inv:page:POST:${digestOf('POST /forgot-password')}`;
  return {
    requestId: 'intent-proposer-run-1',
    candidates: [{ id: 'prop:0123456789abcdef', title: 'request a password reset email' }],
    proposalRun: {
      proposals: [
        {
          id: 'prop:0123456789abcdef',
          domain: 'account-recovery',
          intent: 'request a password reset email',
          action: bearerInAction
            ? 'perform POST /forgot-password with bearer abcdefghijklmnopqrstuvwxyz1234'
            : 'perform POST /forgot-password',
          fromState: 'reset-not-requested',
          toState: 'reset-requested',
          persona: 'registered-user@example.test',
          inventoryRowIds: [rowId],
          evidenceRefIds: ['src:app-forgot-password-actions.ts:5-44'],
          rationale: 'grounded',
          truthState: 'hypothesized',
        },
      ],
      rows: [],
      estimatedCostUsd: 0.001,
      dedupe: { inBatchDropped: 0, crossBatchDropped: 0 },
    },
  };
}

function digestOf(key: string): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 12);
}

async function fixtureRunDir(
  lane: 'local' | 'worker',
  options: { bearerInAction?: boolean } = {},
): Promise<string> {
  const runId = 'fixture-run';
  const runDirectory = join(await mkdtemp(join(tmpdir(), `arxic-intents-${lane}-`)), runId);
  const artifacts =
    lane === 'local'
      ? join(runDirectory, 'artifacts')
      : join(runDirectory, 'artifacts', 'checkpoints', runId, 'artifacts');
  await mkdir(artifacts, { recursive: true });
  await writeFile(join(artifacts, '13.json'), JSON.stringify(inventoryEnvelope()));
  await writeFile(
    join(artifacts, '04.json'),
    JSON.stringify(inferenceArtifact(options.bearerInAction ?? false)),
  );
  await writeFile(
    join(artifacts, '09.json'),
    JSON.stringify({
      compiled: true,
      plan: '# plan',
      workflow: { id: 'prop:0123456789abcdef', domain: 'account-recovery' },
    }),
  );
  await writeFile(
    join(artifacts, '10.json'),
    JSON.stringify({
      outcome: 'verified',
      diagnostics: [],
      artifacts: [],
      runs: [{ passed: true }, { passed: true }],
      gates: [{ gate: 'verify', passed: true }],
    }),
  );
  const built = buildIntentLedger({
    inventory: inventoryEnvelope(),
    inference: inferenceArtifact(options.bearerInAction ?? false),
    compilation: {
      compiled: true,
      plan: '# plan',
      workflow: { id: 'prop:0123456789abcdef', domain: 'account-recovery' },
    },
    verification: {
      outcome: 'verified',
      diagnostics: [],
      artifacts: [],
      runs: [{ passed: true }, { passed: true }],
      gates: [],
    },
    generatedAt: '2026-08-18T12:00:00.000Z',
  });
  if (!built.ok) throw new Error('fixture ledger build failed');
  // The bearer fixture feeds SP-4 (staging must fail and write nothing), so it
  // deliberately ships WITHOUT a pre-written ledger.
  if (!options.bearerInAction) {
    await writeFile(join(runDirectory, 'intents.json'), JSON.stringify(built.value, null, 2));
  }
  return runDirectory;
}

async function fixtureBundleDir(): Promise<string> {
  const runDirectory = await fixtureRunDir('local');
  const bundleDirectory = join(await mkdtemp(join(tmpdir(), 'arxic-intents-bundle-')), 'bundle');
  await mkdir(bundleDirectory, { recursive: true });
  await writeFile(
    join(bundleDirectory, 'manifest.json'),
    JSON.stringify({ schemaVersion: 1, fileHashes: [] }),
  );
  const ledger = await readFile(join(runDirectory, 'intents.json'), 'utf8');
  await writeFile(join(bundleDirectory, 'intents.json'), ledger);
  return bundleDirectory;
}

async function directoryFingerprint(directory: string): Promise<Record<string, string>> {
  const entries = (await readdir(directory, { recursive: true })).sort();
  const fingerprint: Record<string, string> = {};
  for (const entry of entries) {
    const info = await stat(join(directory, entry));
    fingerprint[entry] = `${info.mtimeMs}:${info.size}`;
  }
  return fingerprint;
}
