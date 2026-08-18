import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ARXIC_INTENT_LEDGER_EVIDENCE_UNRESOLVED,
  ARXIC_INTENT_LEDGER_INVENTORY_MISSING,
  ARXIC_INTENT_LEDGER_INPUT_INVALID,
  ARXIC_INTENT_LEDGER_MISSING,
  ARXIC_INTENT_LEDGER_SCHEMA_INVALID,
  ARXIC_INTENT_LEDGER_VERSION_UNKNOWN,
  INTENT_LEDGER_FILENAME,
  buildIntentLedger,
  normalizeLedgerBytes,
  resolveLedgerInputs,
  serializeIntentLedger,
  stageIntentLedger,
  validateIntentLedger,
  writeIntentLedger,
} from '../ledger';

/**
 * DG-07 (#251) unit proofs for the deterministic intent-ledger builder:
 * the 100% inventory join (C-7), fail-closed sad paths (SP-1, C-1), the
 * verified-only-from-verifier-output rule (C-5), byte determinism modulo
 * generatedAt, and the redaction-gated write (C-6a).
 */

const COMMIT = '0123456789abcdef0123456789abcdef01234567';
const BLOB = 'b'.repeat(64);

function sourceRef(path: string, startLine = 1, endLine = 9) {
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
          observedForms: [{ action: '/forgot-password', method: 'POST', destructive: false }],
          disposition: 'extracted',
          reason: '',
          domain: 'authentication',
          verbs: ['request'],
          count: 1,
        },
        {
          key: 'GET /login',
          surfaceKind: 'page',
          method: 'GET',
          path: '/login',
          origin: 'source',
          sourceRefs: [sourceRef('app/login/page.tsx', 1, 30)],
          runtimeRefs: [],
          runtimeUrls: [],
          observedForms: [],
          disposition: 'extracted',
          reason: '',
          domain: 'authentication',
          verbs: ['read'],
          count: 1,
        },
        {
          key: '* <unsupported-language:php>',
          surfaceKind: 'unknown',
          method: '*',
          path: '<unsupported-language:php>',
          origin: 'source',
          sourceRefs: [],
          runtimeRefs: [],
          runtimeUrls: [],
          observedForms: [],
          disposition: 'unextracted-with-reason',
          reason: 'no language pack for php',
          domain: 'unknown',
          verbs: [],
          count: 3,
        },
      ],
      stats: {
        totalRows: 3,
        byDisposition: {
          extracted: 2,
          unsupported: 0,
          unsafe: 0,
          'unextracted-with-reason': 1,
        },
      },
    },
    stableSha256: 'c'.repeat(64),
    providerIncludes: { resolutions: [], unresolved: [] },
    evidenceGraph: { nodes: 0, edges: 0, outputInfluencingEdges: 0, canonicalSha256: '0'.repeat(64) },
  };
}

function proposalArtifact(bearerAction = false) {
  const forgotEvidence = 'src:app-forgot-password-actions.ts:5-44';
  return {
    requestId: 'intent-proposer-run-1',
    candidates: [{ id: 'prop:0123456789abcdef', title: 'request a password reset email' }],
    proposalRun: {
      proposals: [
        {
          id: 'prop:0123456789abcdef',
          domain: 'account-recovery',
          intent: 'request a password reset email',
          action: bearerAction
            ? 'perform POST /forgot-password with bearer abcdefghijklmnopqrstuvwxyz1234'
            : 'perform POST /forgot-password',
          fromState: 'reset-not-requested',
          toState: 'reset-requested',
          persona: 'registered-user@example.test',
          inventoryRowIds: [`inv:page:POST:${digest('POST /forgot-password')}`],
          evidenceRefIds: [forgotEvidence],
          rationale: 'the /forgot-password form emails a reset link',
          truthState: 'hypothesized',
        },
      ],
      rows: [],
      estimatedCostUsd: 0.0021,
      dedupe: { inBatchDropped: 0, crossBatchDropped: 0 },
    },
  };
}

const compilationArtifact = {
  compiled: true,
  plan: '# plan',
  workflow: { id: 'prop:0123456789abcdef', domain: 'account-recovery' },
};

const verificationArtifact = {
  outcome: 'verified',
  diagnostics: [],
  artifacts: [],
  runs: [{ passed: true }, { passed: true }],
  gates: [{ gate: 'verify', passed: true }],
};

function digest(key: string): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 12);
}

function forgotRow(ledger: { rows: Array<{ inventoryKey: string; intents?: unknown[] }> }): {
  truthState: string;
  replayStatus: string;
  oracleKinds: string[];
  intents: Array<{ evidenceRefIds: string[] }>;
} {
  const row = ledger.rows.find((candidate) => candidate.inventoryKey === 'POST /forgot-password');
  if (!row) throw new Error('fixture lost the POST /forgot-password row');
  return row as unknown as ReturnType<typeof forgotRow>;
}

function buildFixtureInput(overrides: Record<string, unknown> = {}) {
  return {
    inventory: inventoryEnvelope(),
    inference: proposalArtifact(),
    compilation: compilationArtifact,
    verification: verificationArtifact,
    generatedAt: '2026-08-18T12:00:00.000Z',
    ...overrides,
  };
}

describe('intent ledger schema validation', () => {
  it('validates a real builder-produced ledger and rejects mutated copies with stable codes', () => {
    const built = buildIntentLedger(buildFixtureInput());
    expect(built.ok).toBe(true);
    const real = built.value!;
    expect(validateIntentLedger(real)).toMatchObject({ ok: true });

    // AC-1 mutation class 1: unknown top-level property (closed schema).
    const extraProperty = { ...real, fabricated: true };
    expect(validateIntentLedger(extraProperty)).toMatchObject({
      ok: false,
      diagnostics: [expect.objectContaining({ code: ARXIC_INTENT_LEDGER_SCHEMA_INVALID })],
    });

    // AC-1 mutation class 2: truth state outside the contracts enum.
    const badTruth = structuredClone(real);
    forgotRow(badTruth).truthState = 'confirmed';
    expect(validateIntentLedger(badTruth)).toMatchObject({
      ok: false,
      diagnostics: [expect.objectContaining({ code: ARXIC_INTENT_LEDGER_SCHEMA_INVALID })],
    });

    // AC-1 mutation class 3: replay status outside the D-4 enum.
    const badReplay = structuredClone(real);
    forgotRow(badReplay).replayStatus = 'attempted';
    expect(validateIntentLedger(badReplay)).toMatchObject({ ok: false });

    // AC-1 mutation class 4: oracle kind outside the ADR-004 kinds.
    const badOracle = structuredClone(real);
    forgotRow(badOracle).oracleKinds = ['model-output'];
    expect(validateIntentLedger(badOracle)).toMatchObject({ ok: false });

    // AC-1 mutation class 5: evidence id outside the src grammar.
    const badEvidence = structuredClone(real);
    forgotRow(badEvidence).intents[0]!.evidenceRefIds = ['run:not-a-source-ref'];
    expect(validateIntentLedger(badEvidence)).toMatchObject({ ok: false });

    // SP-3: unknown schemaVersion is its own stable diagnostic.
    const badVersion = structuredClone(real);
    badVersion.schemaVersion = 'arxic-intent-ledger-v2';
    expect(validateIntentLedger(badVersion)).toMatchObject({
      ok: false,
      diagnostics: [expect.objectContaining({ code: ARXIC_INTENT_LEDGER_VERSION_UNKNOWN })],
    });
  });
});

describe('intent ledger builder join and derivation', () => {
  it('joins 100% of the stage-13 inventory and keeps no-proposal rows with their disposition (C-7)', () => {
    const built = buildIntentLedger(buildFixtureInput());
    expect(built.ok).toBe(true);
    const ledger = built.value!;
    const envelope = inventoryEnvelope();
    const expectedKeys = envelope.inventory.rows.map((row) => row.key).sort();
    expect(ledger.rows.map((row) => row.inventoryKey)).toEqual(expectedKeys);
    expect(ledger.inventory.totalRows).toBe(3);
    expect(ledger.inventory.byDisposition['unextracted-with-reason']).toBe(1);

    const gapRow = ledger.rows.find((row) => row.inventoryKey === '* <unsupported-language:php>');
    expect(gapRow).toMatchObject({
      disposition: 'unextracted-with-reason',
      reason: 'no language pack for php',
      intents: [],
      truthState: 'observed',
      replayStatus: 'not-attempted',
    });
    expect(gapRow).not.toHaveProperty('inventoryRowId');

    const loginRow = ledger.rows.find((row) => row.inventoryKey === 'GET /login');
    expect(loginRow).toMatchObject({
      disposition: 'extracted',
      intents: [],
      truthState: 'observed',
    });
    expect(loginRow!.inventoryRowId).toBe(`inv:page:GET:${digest('GET /login')}`);
  });

  it('derives verified + attempted:passed ONLY from the deterministic verifier artifact (C-5, D-4)', () => {
    const verified = buildIntentLedger(buildFixtureInput()).value!;
    const forgot = verified.rows.find((row) => row.inventoryKey === 'POST /forgot-password')!;
    expect(forgot.intents[0]).toMatchObject({
      isCandidate: true,
      truthState: 'verified',
      replayStatus: 'attempted:passed',
    });
    expect(forgot.truthState).toBe('verified');
    expect(forgot.replayStatus).toBe('attempted:passed');
    // Non-candidate rows never carry attempted:* (D-4).
    expect(
      verified.rows.every((row) => row.intents.every((intent) => !intent.isCandidate || intent.replayStatus.startsWith('attempted:'))),
    ).toBe(true);

    const unverified = buildIntentLedger(
      buildFixtureInput({
        verification: { ...verificationArtifact, outcome: 'observed', runs: [{ passed: false }] },
      }),
    ).value!;
    expect(
      unverified.rows.find((row) => row.inventoryKey === 'POST /forgot-password')!.intents[0],
    ).toMatchObject({ truthState: 'hypothesized', replayStatus: 'attempted:failed' });

    const blocked = buildIntentLedger(
      buildFixtureInput({ verification: { ...verificationArtifact, outcome: 'blocked', runs: [] } }),
    ).value!;
    expect(
      blocked.rows.find((row) => row.inventoryKey === 'POST /forgot-password')!.intents[0],
    ).toMatchObject({ truthState: 'hypothesized', replayStatus: 'not-attempted' });

    const uncompiled = buildIntentLedger(
      buildFixtureInput({ compilation: { compiled: false, plan: 'none' } }),
    ).value!;
    expect(uncompiled.candidate).toBeUndefined();
    expect(
      uncompiled.rows.find((row) => row.inventoryKey === 'POST /forgot-password')!.intents[0],
    ).toMatchObject({ truthState: 'hypothesized', replayStatus: 'not-attempted', isCandidate: false });
  });

  it('fails closed when a proposal claims truthState verified (ADR-001 §2)', () => {
    const inference = proposalArtifact();
    inference.proposalRun!.proposals[0]!.truthState = 'verified';
    const outcome = buildIntentLedger(buildFixtureInput({ inference }));
    expect(outcome).toMatchObject({
      ok: false,
      diagnostics: [expect.objectContaining({ code: ARXIC_INTENT_LEDGER_INPUT_INVALID })],
    });
  });

  it('fails closed on a dangling EvidenceRef citation (SP-1)', () => {
    const inference = proposalArtifact();
    inference.proposalRun!.proposals[0]!.evidenceRefIds = ['src:app-nowhere.ts:1-2'];
    const outcome = buildIntentLedger(buildFixtureInput({ inference }));
    expect(outcome).toMatchObject({
      ok: false,
      diagnostics: [
        expect.objectContaining({ code: ARXIC_INTENT_LEDGER_EVIDENCE_UNRESOLVED }),
      ],
    });
  });

  it('fails closed on a dangling inventory-row citation', () => {
    const inference = proposalArtifact();
    inference.proposalRun!.proposals[0]!.inventoryRowIds = ['inv:page:DELETE:000000000000'];
    const outcome = buildIntentLedger(buildFixtureInput({ inference }));
    expect(outcome).toMatchObject({
      ok: false,
      diagnostics: [expect.objectContaining({ code: ARXIC_INTENT_LEDGER_INPUT_INVALID })],
    });
  });

  it('fails closed on malformed stage artifacts (wrong kind, missing rows)', () => {
    expect(buildIntentLedger(buildFixtureInput({ inventory: { kind: 'other' } }))).toMatchObject({
      ok: false,
      diagnostics: [expect.objectContaining({ code: ARXIC_INTENT_LEDGER_INPUT_INVALID })],
    });
    expect(
      buildIntentLedger(
        buildFixtureInput({ verification: { outcome: 'so-so', runs: [] } }),
      ),
    ).toMatchObject({ ok: false });
  });

  it('excludes run-volatile fields and is byte-stable modulo generatedAt', () => {
    const first = buildIntentLedger(buildFixtureInput()).value!;
    const second = buildIntentLedger(
      buildFixtureInput({
        generatedAt: '2026-08-18T13:00:00.000Z',
        inference: {
          ...proposalArtifact(),
          requestId: 'intent-proposer-run-2',
          proposalRun: {
            ...proposalArtifact().proposalRun!,
            estimatedCostUsd: 0.9999,
            dedupe: { inBatchDropped: 3, crossBatchDropped: 7 },
          },
        },
      }),
    ).value!;
    const firstBytes = serializeIntentLedger(first);
    const secondBytes = serializeIntentLedger(second);
    expect(firstBytes).not.toEqual(secondBytes);
    expect(normalizeLedgerBytes(firstBytes)).toBe(normalizeLedgerBytes(secondBytes));
    expect(firstBytes).not.toContain('estimatedCostUsd');
    expect(firstBytes).not.toContain('requestId');
    expect(firstBytes).not.toContain('dedupe');
    // Same inputs, same generatedAt: byte-identical pure rebuild (C-1).
    expect(serializeIntentLedger(buildIntentLedger(buildFixtureInput()).value!)).toBe(firstBytes);
  });
});

describe('per-lane input resolution', () => {
  it('resolves the local lane layout and the worker-imported nested layout (C-1)', async () => {
    const localRun = await runDirWithArtifacts('local-run', 'flat');
    const localInputs = await resolveLedgerInputs(localRun);
    expect(localInputs.ok).toBe(true);

    const workerRun = await runDirWithArtifacts('worker-run', 'nested');
    const workerInputs = await resolveLedgerInputs(workerRun);
    expect(workerInputs.ok).toBe(true);
  });

  it('fails closed with ARXIC-INTENT-LEDGER-INVENTORY-MISSING when 13.json is unresolvable (SP-2)', async () => {
    const emptyRun = await mkdtemp(join(tmpdir(), 'arxic-ledger-empty-'));
    const outcome = await resolveLedgerInputs(emptyRun);
    expect(outcome).toMatchObject({
      ok: false,
      diagnostics: [expect.objectContaining({ code: ARXIC_INTENT_LEDGER_INVENTORY_MISSING })],
    });

    const noThirteen = await mkdtemp(join(tmpdir(), 'arxic-ledger-no13-'));
    await mkdir(join(noThirteen, 'artifacts'), { recursive: true });
    await writeFile(join(noThirteen, 'artifacts', '04.json'), JSON.stringify(proposalArtifact()));
    expect(await resolveLedgerInputs(noThirteen)).toMatchObject({
      ok: false,
      diagnostics: [expect.objectContaining({ code: ARXIC_INTENT_LEDGER_INVENTORY_MISSING })],
    });

    const ambiguous = await mkdtemp(join(tmpdir(), 'arxic-ledger-ambiguous-'));
    for (const candidate of ['run-a', 'run-b']) {
      await mkdir(join(ambiguous, 'artifacts', 'checkpoints', candidate, 'artifacts'), {
        recursive: true,
      });
      await writeFile(
        join(ambiguous, 'artifacts', 'checkpoints', candidate, 'artifacts', '13.json'),
        JSON.stringify(inventoryEnvelope()),
      );
    }
    expect(await resolveLedgerInputs(ambiguous)).toMatchObject({ ok: false });
  });
});

describe('redaction-gated write (C-6a) and staging', () => {
  it('writes nothing and returns the scanner diagnostics when the scan flags the ledger bytes (SP-4)', async () => {
    const inference = proposalArtifact(true);
    const built = buildIntentLedger(buildFixtureInput({ inference }));
    expect(built.ok).toBe(true);
    const ledger = built.value!;
    const directory = await mkdtemp(join(tmpdir(), 'arxic-ledger-redact-'));
    const scan = (text: string) =>
      /bearer\s+[A-Za-z0-9._-]{20,}/iu.test(text)
        ? [
            {
              code: 'ARXIC_PROMOTION_REDACTION_FAILED',
              severity: 'blocked' as const,
              subject: 'bearer-token',
              message: 'Sensitive data matched bearer-token',
            },
          ]
        : [];
    const outcome = await writeIntentLedger(join(directory, INTENT_LEDGER_FILENAME), ledger, {
      scan,
    });
    expect(outcome).toMatchObject({
      ok: false,
      diagnostics: [expect.objectContaining({ code: 'ARXIC_PROMOTION_REDACTION_FAILED' })],
    });
    expect(await readdir(directory)).toEqual([]);
  });

  it('stages intents.json at the run root and is idempotent per skipIfPresent', async () => {
    const runDirectory = await runDirWithArtifacts('stage-run', 'flat');
    const staged = await stageIntentLedger({
      runDirectory,
      generatedAt: '2026-08-18T14:00:00.000Z',
    });
    expect(staged.ok).toBe(true);
    const bytes = await readFile(join(runDirectory, INTENT_LEDGER_FILENAME), 'utf8');
    expect(bytes.endsWith('\n')).toBe(true);
    expect(validateIntentLedger(JSON.parse(bytes))).toMatchObject({ ok: true });

    const again = await stageIntentLedger({
      runDirectory,
      generatedAt: '2026-08-19T14:00:00.000Z',
      skipIfPresent: true,
    });
    expect(again).toMatchObject({ ok: true, wrote: false });
    expect(await readFile(join(runDirectory, INTENT_LEDGER_FILENAME), 'utf8')).toBe(bytes);
  });

  it('refuses to keep a present-but-invalid ledger', async () => {
    const runDirectory = await runDirWithArtifacts('bad-ledger-run', 'flat');
    await writeFile(
      join(runDirectory, INTENT_LEDGER_FILENAME),
      JSON.stringify({ schemaVersion: 'arxic-intent-ledger-v9' }),
    );
    const outcome = await stageIntentLedger({
      runDirectory,
      generatedAt: '2026-08-18T14:00:00.000Z',
      skipIfPresent: true,
    });
    expect(outcome).toMatchObject({
      ok: false,
      diagnostics: [expect.objectContaining({ code: ARXIC_INTENT_LEDGER_VERSION_UNKNOWN })],
    });
  });

  it('surfaces a missing-ledger subject constant for consumers', () => {
    // The MISSING code exists for the CLI refusal path; pin its value.
    expect(ARXIC_INTENT_LEDGER_MISSING).toBe('ARXIC-INTENT-LEDGER-MISSING');
    expect(ARXIC_INTENT_LEDGER_SCHEMA_INVALID).toBe('ARXIC-INTENT-LEDGER-SCHEMA-INVALID');
  });
});

async function runDirWithArtifacts(
  runId: string,
  layout: 'flat' | 'nested',
): Promise<string> {
  const runDirectory = join(await mkdtemp(join(tmpdir(), `arxic-ledger-${runId}-`)), runId);
  const artifacts =
    layout === 'flat'
      ? join(runDirectory, 'artifacts')
      : join(runDirectory, 'artifacts', 'checkpoints', runId, 'artifacts');
  await mkdir(artifacts, { recursive: true });
  await writeFile(join(artifacts, '13.json'), JSON.stringify(inventoryEnvelope()));
  await writeFile(join(artifacts, '04.json'), JSON.stringify(proposalArtifact()));
  await writeFile(join(artifacts, '09.json'), JSON.stringify(compilationArtifact));
  await writeFile(join(artifacts, '10.json'), JSON.stringify(verificationArtifact));
  return runDirectory;
}
