import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanTextForSecrets } from '@arxic/bundle-promoter';
import {
  PIPELINE_RESULT_PATH,
  WORKER_SOURCE_PATH,
  pipelineConfigSha256,
  pipelineSha256,
  serializePipelineResult,
  type PipelineResult,
  type RunHandle,
  type RunStreamEvent,
  type WorkerClient,
} from '@arxic/worker';
import { WorkerRunExecutor } from '../worker-executor';
import type { RunRequest } from '../executor';
import { VALID_CONFIG } from './fixtures';
import {
  buildIntentLedger,
  normalizeLedgerBytes,
  serializeIntentLedger,
  validateIntentLedger,
} from '../../../../packages/intent/src/ledger';

const request: RunRequest = {
  runId: 'worker-test',
  config: VALID_CONFIG,
  runDirectory: '/tmp/arxic-worker-test',
  rulepacksDir: '/tmp/rulepacks',
};
const TRUSTED_SOURCE_SHA256 = 'a'.repeat(64);
const running: RunHandle = {
  runId: request.runId,
  status: 'running',
  outcome: 'observed',
  diagnostics: [],
  promotionEligible: false,
};

describe('WorkerRunExecutor sad paths', () => {
  it('blocks startup interruption without exposing raw worker prose', async () => {
    const client = workerClient({ start: async () => Promise.reject(new Error('SECRET worker')) });
    const emitted: string[] = [];
    const result = await workerExecutor(client).execute(request, {
      emit: (diagnostic) => emitted.push(diagnostic.message),
    });
    expect(result).toMatchObject({ status: 'failed', outcome: 'blocked' });
    expect(result.diagnostics.map(({ code }) => code)).toEqual(['ARXIC-EXEC-WORKER-INTERRUPTED']);
    expect(emitted.join(' ')).not.toContain('SECRET');
  });

  it('cancels and blocks a stream interruption, preserving cleanup diagnostics', async () => {
    let canceled = false;
    const cleanup = {
      code: 'ARXIC-WORKER-CLEANUP-FAILED',
      severity: 'blocked',
      subject: 'SECRET provider subject',
      message: 'raw docker daemon output SECRET',
    } as const;
    const client = workerClient({
      stream: () => interruptedStream(),
      cancel: async () => {
        canceled = true;
        return { ...running, status: 'failed', outcome: 'blocked', diagnostics: [cleanup] };
      },
    });
    const result = await workerExecutor(client).execute(request, { emit() {} });
    expect(canceled).toBe(true);
    expect(result.diagnostics.map(({ code }) => code)).toEqual([
      'ARXIC-EXEC-WORKER-INTERRUPTED',
      'ARXIC-WORKER-CLEANUP-FAILED',
    ]);
    expect(JSON.stringify(result.diagnostics)).not.toContain('SECRET');
  });

  it('blocks an approval event rather than trusting worker prose', async () => {
    const client = workerClient({
      stream: () =>
        events({
          type: 'awaiting-approval',
          stage: 8,
          message: 'approve SECRET destructive action',
        }),
    });
    const result = await workerExecutor(client).execute(request, { emit() {} });
    expect(result.diagnostics.map(({ code }) => code)).toContain(
      'ARXIC-EXEC-WORKER-APPROVAL-REQUIRED',
    );
    expect(JSON.stringify(result.diagnostics)).not.toContain('SECRET');
  });

  it('reclassifies an unrecognized worker diagnostic without exposing its fields', async () => {
    const completed = { ...running, status: 'completed' } as const;
    const client = workerClient({
      stream: () =>
        events(
          {
            type: 'diagnostic',
            diagnostic: {
              code: 'ARXIC-MODEL-UNEXPECTED',
              severity: 'blocked',
              subject: 'SECRET subject',
              message: 'SECRET provider prose',
            },
          },
          { type: 'finished', handle: completed },
        ),
      inspect: async () => completed,
    });
    const result = await workerExecutor(client).execute(request, { emit() {} });
    expect(result.diagnostics.map(({ code }) => code)).toEqual([
      'ARXIC-EXEC-WORKER-INTERRUPTED',
      'ARXIC-WORKER-RUN-FAILED',
    ]);
    expect(JSON.stringify(result.diagnostics)).not.toContain('SECRET');
  });

  it('blocks a completed handle when its pipeline result is missing', async () => {
    const completed = { ...running, status: 'completed' } as const;
    const client = workerClient({
      stream: () => events({ type: 'finished', handle: completed }),
      inspect: async () => completed,
    });
    const result = await workerExecutor(client).execute(request, { emit() {} });
    expect(result).toMatchObject({ status: 'failed', outcome: 'blocked' });
    expect(result.diagnostics.map(({ code }) => code)).toEqual(['ARXIC-WORKER-RUN-FAILED']);
    expect(result.state.checkpoints).toEqual([]);
    expect(result.state.artifacts).toEqual({});
    expect(result.receipt).toBeUndefined();
  });

  it('uses the injected source hash instead of hashing the ambient cwd', async () => {
    const repositories: string[] = [];
    const nonRepositoryRequest = {
      ...request,
      config: {
        ...request.config,
        source: { ...request.config.source, repository: '/not/a/git/repository' },
      },
    };
    const completed = { ...running, status: 'completed' } as const;
    const client = workerClient({
      stream: () => events({ type: 'finished', handle: completed }),
      inspect: async () => completed,
    });

    const result = await new WorkerRunExecutor(client, {
      sourceHash: async (repository) => {
        repositories.push(repository);
        return TRUSTED_SOURCE_SHA256;
      },
    }).execute(nonRepositoryRequest, { emit() {} });

    expect(repositories).toEqual(['/not/a/git/repository']);
    expect(result.diagnostics.map(({ code }) => code)).toEqual(['ARXIC-WORKER-RUN-FAILED']);
  });

  it('does not write imported bytes until the PipelineResult envelope validates', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'arxic-worker-ingress-'));
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const manifest = {
      runId: request.runId,
      resultReady: true,
      files: [{ path: 'screens/proof.png', sha256, bytes: bytes.length }],
    } as const;
    const completed = { ...running, status: 'completed' } as const;
    const client = workerClient({
      stream: () =>
        events({ type: 'result-ready', manifest }, { type: 'finished', handle: completed }),
      collectArtifacts: async () => ({
        manifest,
        files: [{ path: manifest.files[0].path, sha256, bytes }],
      }),
      inspect: async () => completed,
    });
    try {
      const result = await workerExecutor(client).execute(
        { ...request, runDirectory: directory },
        { emit() {} },
      );
      await expect(
        readFile(join(directory, request.runId, 'artifacts/screens/proof.png')),
      ).rejects.toThrow();
      expect(result.diagnostics.map(({ code }) => code)).toEqual(['ARXIC-EXEC-WORKER-PROTOCOL']);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('WorkerRunExecutor intent-ledger staging (DG-07 remediation on #251)', () => {
  // Security P1 (two convergent reviews): the worker lane used to stage with
  // skipIfPresent, so a schema-valid FORGED intents.json planted at the run
  // root (`arxic run --out ... --run-id ...` over a caller-controlled
  // directory) was kept verbatim — no rebuild, no redaction scan, fabricated
  // `verified` truth states and secret strings riding the promoted frozen
  // bundle (bypassing C-5 and C-6a). The lane must ALWAYS rebuild the ledger
  // from the IMPORTED stage artifacts and redaction-scan the rebuilt bytes.
  it('overwrites a caller-planted schema-valid forged intents.json with the derived ledger', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'arxic-worker-forged-'));
    const runId = 'forged-run';
    const runRoot = join(directory, runId);
    await mkdir(runRoot, { recursive: true });
    const forgedBytes = `${JSON.stringify(forgedLedgerDocument())}\n`;
    // The plant is schema-valid (the exact attack class: shape-valid bytes a
    // skipIfPresent branch would trust) and its secret is visible to the REAL
    // redaction scanner — keeping it verbatim would ship a live secret.
    expect(validateIntentLedger(JSON.parse(forgedBytes)).ok).toBe(true);
    expect(scanTextForSecrets(forgedBytes).length).toBeGreaterThan(0);
    await writeFile(join(runRoot, 'intents.json'), forgedBytes);

    const result = await new WorkerRunExecutor(forgedArtifactsClient(runId), {
      sourceHash: async () => TRUSTED_SOURCE_SHA256,
    }).execute({ ...request, runId, runDirectory: directory, now: () => STAGED_AT }, { emit() {} });

    try {
      expect(result.status).toBe('partial');
      expect(result.outcome).toBe('observed');
      expect(result.diagnostics).toEqual([]);
      const stagedBytes = await readFile(join(runRoot, 'intents.json'), 'utf8');
      expect(stagedBytes).not.toBe(forgedBytes);
      const staged = JSON.parse(stagedBytes);
      expect(validateIntentLedger(staged).ok).toBe(true);
      // Nothing fabricated survives: no candidate, no verification block, no
      // `verified` truth state, no secret — the staged ledger is the
      // deterministic rebuild over the imported stage artifacts.
      expect(staged.candidate).toBeUndefined();
      expect(staged.verification).toBeUndefined();
      expect(
        staged.rows.every(({ truthState }: { truthState: string }) => truthState !== 'verified'),
      ).toBe(true);
      expect(stagedBytes).not.toContain('bearer abcdefghijklmnopqrstuvwxyz1234');
      // Byte-exact (modulo generatedAt) match with an independent rebuild
      // from the same artifacts. What withEmbeddedLedger embeds into a
      // promoted frozen bundle is exactly this staged outcome — the forged
      // bytes therefore cannot reach a promoted bundle in this lane.
      const rebuilt = buildIntentLedger({
        inventory: workerInventoryArtifact(),
        inference: workerInferenceArtifact(),
        generatedAt: STAGED_AT,
      });
      if (!rebuilt.ok)
        throw new Error(`fixture rebuild failed: ${JSON.stringify(rebuilt.diagnostics)}`);
      expect(normalizeLedgerBytes(stagedBytes)).toBe(
        normalizeLedgerBytes(serializeIntentLedger(rebuilt.value)),
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

function workerExecutor(client: WorkerClient): WorkerRunExecutor {
  return new WorkerRunExecutor(client, {
    sourceHash: async () => TRUSTED_SOURCE_SHA256,
  });
}

function workerClient(overrides: Partial<WorkerClient>): WorkerClient {
  return {
    start: async () => running,
    stream: () => events({ type: 'finished', handle: running }),
    collectArtifacts: async () => Promise.reject(new Error('not ready')),
    inspect: async (handle) => handle,
    approve: async (handle) => handle,
    cancel: async (handle) => ({ ...handle, status: 'failed', outcome: 'blocked' }),
    ...overrides,
  };
}

async function* events(...items: RunStreamEvent[]): AsyncIterable<RunStreamEvent> {
  yield* items;
}

function interruptedStream(): AsyncIterable<RunStreamEvent> {
  return {
    [Symbol.asyncIterator]() {
      return {
        next: async () => Promise.reject(new Error('SECRET stream failure')),
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Forged-ledger regression fixtures (#251 remediation P1)
// ---------------------------------------------------------------------------

const STAGED_AT = '2026-08-19T12:00:00.000Z';
const STAGE_TEN_BYTES = Buffer.from('{"stage":10}\n');
const STAGE_TEN_SHA256 = sha256Of(STAGE_TEN_BYTES);
const FORGED_SECRET = 'bearer abcdefghijklmnopqrstuvwxyz1234';

function sha256Of(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * A schema-valid but fully fabricated ledger: `verified` truth states +
 * `attempted:passed` replay with NO verifier artifact behind them, a made-up
 * candidate/verification block, and a bearer-token secret in `reason`.
 */
function forgedLedgerDocument(): Record<string, unknown> {
  return {
    schemaVersion: 'arxic-intent-ledger-v1',
    generatedAt: '2026-08-18T00:00:00.000Z',
    source: { repository: 'file:///tmp/attacker', commit: 'f'.repeat(40) },
    inventory: {
      totalRows: 1,
      byDisposition: { extracted: 1, unsupported: 0, unsafe: 0, 'unextracted-with-reason': 0 },
    },
    candidate: { workflowId: 'prop:ffffffffffffffff' },
    verification: { outcome: 'verified', runs: 2, passedRuns: 2 },
    rows: [
      {
        inventoryKey: 'POST /forgot-password',
        inventoryRowId: `inv:page:POST:${sha256Of(Buffer.from('POST /forgot-password')).slice(0, 12)}`,
        domain: 'account-recovery',
        surface: { kind: 'page', method: 'POST', path: '/forgot-password' },
        disposition: 'extracted',
        reason: `planted leak ${FORGED_SECRET}`,
        verbs: ['request'],
        evidence: {
          sourceRefs: [
            {
              kind: 'source',
              repo: 'file:///tmp/attacker',
              commit: 'f'.repeat(40),
              path: 'app/forgot-password/actions.ts',
              startLine: 5,
              endLine: 44,
              blobSha256: 'f'.repeat(64),
              extractor: 'nextjs-file-conventions:route',
            },
          ],
          runtimeUrls: [],
          runtimeForms: [],
          runtimeObservationCount: 0,
        },
        oracleKinds: ['repository-specification'],
        truthState: 'verified',
        replayStatus: 'attempted:passed',
        intents: [
          {
            proposalId: 'prop:ffffffffffffffff',
            domain: 'account-recovery',
            intent: 'fabricated verified intent',
            action: 'perform POST /forgot-password',
            persona: 'attacker',
            fromState: 'signed-out',
            toState: 'signed-in',
            evidenceRefIds: ['src:app-forgot-password-actions.ts:5-44'],
            oracleKinds: ['repository-specification'],
            truthState: 'verified',
            replayStatus: 'attempted:passed',
            isCandidate: true,
          },
        ],
      },
    ],
  };
}

function workerInventoryArtifact() {
  return {
    kind: 'arxic-domain-inventory-stage-v1',
    schemaVersion: 1,
    inventory: {
      schemaVersion: 1,
      generatedAt: '2026-08-19T10:00:00.000Z',
      rows: [
        {
          key: 'POST /forgot-password',
          surfaceKind: 'page',
          method: 'POST',
          path: '/forgot-password',
          origin: 'source',
          sourceRefs: [
            {
              kind: 'source',
              repo: 'file:///tmp/fixture-source',
              commit: '0123456789abcdef0123456789abcdef01234567',
              path: 'app/forgot-password/actions.ts',
              startLine: 5,
              endLine: 44,
              blobSha256: 'b'.repeat(64),
              extractor: 'nextjs-file-conventions:route',
            },
          ],
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

function workerInferenceArtifact() {
  const rowId = `inv:page:POST:${sha256Of(Buffer.from('POST /forgot-password')).slice(0, 12)}`;
  return {
    requestId: 'intent-proposer-run-1',
    candidates: [{ id: 'prop:0123456789abcdef', title: 'request a password reset email' }],
    proposalRun: {
      proposals: [
        {
          id: 'prop:0123456789abcdef',
          domain: 'account-recovery',
          intent: 'request a password reset email',
          action: 'perform POST /forgot-password',
          fromState: 'reset-not-requested',
          toState: 'reset-requested',
          persona: 'registered-user@example.test',
          inventoryRowIds: [rowId],
          evidenceRefIds: ['src:app-forgot-password-actions.ts:5-44'],
          rationale: 'the /forgot-password form emails a reset link',
          truthState: 'hypothesized',
        },
      ],
      rows: [],
      estimatedCostUsd: 0.001,
      dedupe: { inBatchDropped: 0, crossBatchDropped: 0 },
    },
  };
}

/** A WorkerClient whose imported artifacts carry the worker-nested lane layout. */
function forgedArtifactsClient(runId: string): WorkerClient {
  const inventoryBytes = Buffer.from(`${JSON.stringify(workerInventoryArtifact())}\n`);
  const inferenceBytes = Buffer.from(`${JSON.stringify(workerInferenceArtifact())}\n`);
  const envelopeBytes = serializePipelineResult(workerPipelineResult(runId));
  const files = [
    { path: PIPELINE_RESULT_PATH, sha256: sha256Of(envelopeBytes), bytes: envelopeBytes },
    { path: 'stages/10.json', sha256: STAGE_TEN_SHA256, bytes: STAGE_TEN_BYTES },
    {
      path: `checkpoints/${runId}/artifacts/13.json`,
      sha256: sha256Of(inventoryBytes),
      bytes: inventoryBytes,
    },
    {
      path: `checkpoints/${runId}/artifacts/04.json`,
      sha256: sha256Of(inferenceBytes),
      bytes: inferenceBytes,
    },
  ];
  const manifest = {
    runId,
    resultReady: true,
    files: files.map(({ path, sha256, bytes }) => ({ path, sha256, bytes: bytes.length })),
  };
  const completed: RunHandle = {
    runId,
    status: 'completed',
    outcome: 'observed',
    diagnostics: [],
    promotionEligible: false,
  };
  return {
    start: async () => ({ ...completed, status: 'running' }),
    stream: () =>
      events({ type: 'result-ready', manifest }, { type: 'finished', handle: completed }),
    collectArtifacts: async () => ({ manifest, files }),
    inspect: async (handle) => handle,
    approve: async (handle) => handle,
    cancel: async (handle) => ({ ...handle, status: 'failed', outcome: 'blocked' }),
  };
}

function workerPipelineResult(runId: string): PipelineResult {
  const workerConfig = {
    ...request.config,
    source: { ...request.config.source, repository: WORKER_SOURCE_PATH },
  };
  const ref = {
    id: 'stage:10',
    path: 'stages/10.json',
    sha256: STAGE_TEN_SHA256,
    bytes: STAGE_TEN_BYTES.length,
  };
  const checkpoint = {
    stage: 10 as const,
    name: 'verify',
    status: 'completed' as const,
    startedAt: '2026-08-19T11:59:00.000Z',
    finishedAt: '2026-08-19T11:59:01.000Z',
    adapter: { name: '@arxic/verifier', version: '0.0.0' },
    orchestratorVersion: '0.0.0',
    artifacts: [ref],
    toolVersions: { node: '22.0.0', '@arxic/verifier': '0.0.0' },
    decisions: ['deterministic verifier ran'],
    approvals: [],
    gateResults: [{ gate: 'verify', passed: true }],
    redaction: { passed: true, redactedFields: [] },
  };
  const stages = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const checkpoints = stages.map((stage, index) =>
    stage === 10
      ? checkpoint
      : {
          ...checkpoint,
          stage: stage as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 11 | 12 | 13,
          name: `stage-${stage}-${index}`,
          adapter: { name: '@arxic/orchestrator-langgraph', version: '0.0.0' },
          artifacts: [],
          gateResults: [],
        },
  );
  return {
    protocolVersion: 1,
    binding: {
      runId,
      configSha256: pipelineConfigSha256(workerConfig),
      sourceSha256: TRUSTED_SOURCE_SHA256,
      sourceRevision: request.config.source.revision,
      appBuildDigest: 'b'.repeat(64),
      workerImageVersion: 'synthetic-no-image',
      toolVersion: '0.0.0',
      browserVersion: '1.62.1',
      orchestratorVersion: '0.0.0',
    },
    freshness: {
      producedAt: '2026-08-19T11:59:30.000Z',
      expiresAt: '2026-08-19T12:05:00.000Z',
    },
    state: {
      runId,
      status: 'partial',
      outcome: 'observed',
      activeStage: stages.at(-1) as PipelineResult['state']['activeStage'],
      completedStages: [...stages] as PipelineResult['state']['completedStages'],
      artifacts: [{ stage: 10, ref }],
      checkpoints,
      diagnostics: [],
      promotionEligible: false,
    },
    candidate: { gateResults: [{ gate: 'verify', passed: true }] },
    verifier: {
      version: 1,
      runId,
      verifierVersion: '0.0.0',
      orchestratorVersion: '0.0.0',
      configSha256: pipelineConfigSha256(workerConfig),
      sourceSha256: TRUSTED_SOURCE_SHA256,
      appBuildDigest: 'b'.repeat(64),
      requiredReplayCount: 2,
      cleanReplayCount: 2,
      outcome: 'observed',
      artifactHashes: [STAGE_TEN_SHA256],
      stagedBundleSha256: pipelineSha256(null),
    },
  };
}
