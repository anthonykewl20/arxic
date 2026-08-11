import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import type { EvidenceRef, StagedBundle, Workflow } from '@arxic/contracts';
import {
  ARXIC_INTENT_ORACLE_CONFLICT,
  ARXIC_INTENT_ORACLE_MISSING,
  ARXIC_INTENT_WORKFLOW_COVERAGE_GAP,
  INTENT_SCHEMA_VERSION,
  canonicalizeIntentSpec,
  normalizeIntentSpec,
  type IntentSpec,
  type IntentSpecInput,
} from '@arxic/intent';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ARXIC_ORCH_ORACLE_RESOLVED,
  ARXIC_ORCH_ORACLE_UNMATCHED,
  ARXIC_ORCH_STAGE_BLOCKED,
  InMemoryStageCheckpointer,
  LangGraphOrchestrator,
  type Candidate,
  type CompilationResult,
  type OracleResolution,
  type OracleResolutionInput,
  type OracleRule,
} from '..';

const execute = promisify(execFile);
const root = resolve(import.meta.dirname, '../../../..');
const directories: string[] = [];
let commit = '';
const sourceId = 'src:authentication.login';
const runtimeId = 'run:authentication.login';
const pinnedCanonicalSha256 = 'b7d7b8cb4ef5fc7477a4df7c4a453bd7381ae5a77b1dc1662e2d06032b254e97';
let server: Server;
let origin = '';
let repository = '';
let artifactsDir = '';

describe('stage-9 oracle resolution', () => {
  beforeAll(async () => {
    repository = await committedSource();
    artifactsDir = await temporaryDirectory('artifacts-');
    server = createServer((request, response) => {
      response.setHeader(
        'content-type',
        request.url?.includes('.json') ? 'application/json' : 'text/html',
      );
      if (request.url === '/.well-known/arxic-test-target.json') {
        response.end(
          JSON.stringify({
            environmentClass: 'local-test',
            origin,
            allowedOrigins: [origin],
            buildDigest: 'b'.repeat(64),
            nonce: 'oracle-resolution',
          }),
        );
        return;
      }
      response.end('<!doctype html><title>Login</title>');
    });
    await new Promise<void>((listen) => server.listen(0, '127.0.0.1', listen));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test server did not bind');
    origin = `http://127.0.0.1:${address.port}`;
  }, 30_000);

  afterAll(async () => {
    await new Promise<void>((close) => server.close(() => close()));
    await Promise.all(
      directories.map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  it('blocks stage 9 when the intent service reports a missing oracle', async () => {
    const checkpointer = new InMemoryStageCheckpointer();
    let compileRan = false;
    const result = await orchestrator({
      checkpointer,
      resolveOracle: (input) => realResolution(input, []),
      compile: async () => {
        compileRan = true;
        return { compiled: true, plan: 'must not compile' };
      },
    }).run(orchestratorInput('oracle-missing'));
    const artifact = await stageNineArtifact(checkpointer, result, 'oracle-missing');

    expect(compileRan).toBe(false);
    expect(artifact.compiled).toBe(false);
    expect(artifact.oracleOutcome).toBe('blocked');
    expect(result.outcome).toBe('blocked');
    expect(result.status).toBe('partial');
    expect(result.promotionEligible).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: ARXIC_INTENT_ORACLE_MISSING, severity: 'blocked' }),
    );
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: ARXIC_ORCH_STAGE_BLOCKED,
        severity: 'blocked',
        subject: 'stage-9',
      }),
    );
    expect(result.checkpoints.find(({ stage }) => stage === 9)).toMatchObject({
      stage: 9,
      status: 'completed',
      gateResults: [{ gate: 'compile', passed: false }],
    });
  }, 60_000);

  it('allows the same harness to promote when oracle resolution is clean', async () => {
    const stagedBundle = coherentObservedBundle();
    let compileIntentSpec: IntentSpec | undefined;
    const result = await orchestrator({
      resolveOracle: (input) => realResolution(input, input.oracleRules),
      compile: async ({ intentSpec }) => {
        compileIntentSpec = intentSpec;
        return { compiled: true, plan: 'compiled', stagedBundle };
      },
      verify: async () => verifiedResult(stagedBundle),
      promote: async () => promotionReceipt(stagedBundle),
    }).run(
      orchestratorInput('oracle-control', [{ candidateId: candidate().id, oracle: domainRule() }]),
    );

    expect(compileIntentSpec?.assertions[0]?.kind).toBe('acceptance');
    expect(result.outcome).not.toBe('blocked');
    expect(result.promotionEligible).toBe(true);
    expect(result.receipt).toBeDefined();
  }, 60_000);

  it('keeps an intent conflict contradicted when stage 10 reports verified', async () => {
    const stagedBundle = coherentObservedBundle();
    const result = await orchestrator({
      resolveOracle: conflictResolution,
      compile: async () => ({ compiled: true, plan: 'compiled', stagedBundle }),
      verify: async () => verifiedResult(stagedBundle),
    }).run(orchestratorInput('oracle-conflict'));

    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: ARXIC_INTENT_ORACLE_CONFLICT,
        severity: 'contradicted',
      }),
    );
    expect(result.diagnostics).not.toContainEqual(
      expect.objectContaining({ code: ARXIC_ORCH_STAGE_BLOCKED, subject: 'stage-9' }),
    );
    expect(result.checkpoints.find(({ stage }) => stage === 9)?.status).toBe('completed');
    expect(result.outcome).toBe('contradicted');
    expect(result.promotionEligible).toBe(false);
    expect(result.receipt).toBeUndefined();
  }, 60_000);

  it('keeps characterization-only intent non-promotable when stage 10 reports verified', async () => {
    const stagedBundle = coherentObservedBundle();
    const checkpointer = new InMemoryStageCheckpointer();
    let promoted = false;
    const observedOnlyRules = [
      { candidateId: candidate().id, oracle: { kind: 'observed-only' } },
    ] as const;
    const result = await orchestrator({
      checkpointer,
      resolveOracle: (input) => realResolution(input, input.oracleRules),
      compile: async () => ({ compiled: true, plan: 'compiled', stagedBundle }),
      verify: async () => verifiedResult(stagedBundle),
      promote: async () => {
        promoted = true;
        return promotionReceipt(stagedBundle);
      },
    }).run(orchestratorInput('oracle-characterization', observedOnlyRules));
    const artifact = await stageNineArtifact(checkpointer, result, 'oracle-characterization');

    expect(artifact.compiled).toBe(true);
    expect(artifact.intentSpec?.assertions).toEqual([
      expect.objectContaining({ kind: 'characterization' }),
    ]);
    expect(result.checkpoints.find(({ stage }) => stage === 10)?.gateResults).toEqual([
      { gate: 'verify', passed: true },
    ]);
    expect(result.promotionEligible).toBe(false);
    expect(result.receipt).toBeUndefined();
    expect(promoted).toBe(false);
  }, 60_000);

  it('blocks compilation when IntentSpec does not cover a required workflow assertion', async () => {
    const checkpointer = new InMemoryStageCheckpointer();
    let compileRan = false;
    const result = await orchestrator({
      checkpointer,
      resolveOracle: async (input) => {
        const resolved = await realResolution(input, input.oracleRules);
        if (!resolved.intentSpec) throw new Error('Expected resolved IntentSpec');
        return {
          ...resolved,
          intentSpec: {
            ...resolved.intentSpec,
            assertions: resolved.intentSpec.assertions.map((assertion) => ({
              ...assertion,
              intent: 'text:Different outcome',
            })),
          },
        };
      },
      compile: async () => {
        compileRan = true;
        return { compiled: true, plan: 'must not compile' };
      },
    }).run(
      orchestratorInput('oracle-coverage-gap', [
        { candidateId: candidate().id, oracle: domainRule() },
      ]),
    );
    const artifact = await stageNineArtifact(checkpointer, result, 'oracle-coverage-gap');

    expect(compileRan).toBe(false);
    expect(artifact.compiled).toBe(false);
    expect(artifact.oracleOutcome).toBe('blocked');
    expect(result.promotionEligible).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: ARXIC_INTENT_WORKFLOW_COVERAGE_GAP,
        severity: 'blocked',
      }),
    );
  }, 60_000);

  it('keeps default oracle resolution as a no-op', async () => {
    const checkpointer = new InMemoryStageCheckpointer();
    const result = await orchestrator({ checkpointer }).run(orchestratorInput('oracle-default'));
    const artifact = await stageNineArtifact(checkpointer, result, 'oracle-default');

    expect(artifact.intentSpec).toBeUndefined();
    expect(result.diagnostics).not.toContainEqual(
      expect.objectContaining({ code: ARXIC_ORCH_ORACLE_RESOLVED }),
    );
  }, 60_000);

  it('does not persist hostile verified oracle input', async () => {
    const hostileOracle = {
      ...domainRule(),
      truthState: 'verified',
    } as unknown as OracleRule['oracle'];
    const checkpointer = new InMemoryStageCheckpointer();
    const result = await orchestrator({
      checkpointer,
      resolveOracle: (input) =>
        realResolution(input, [{ candidateId: 'authentication.login', oracle: hostileOracle }]),
    }).run(
      orchestratorInput('oracle-hostile', [
        { candidateId: 'authentication.login', oracle: hostileOracle },
      ]),
    );
    const artifact = await stageNineArtifact(checkpointer, result, 'oracle-hostile');

    expect(artifact.intentSpec).toBeDefined();
    expect(JSON.stringify(artifact.intentSpec)).not.toContain(':"verified"');
  }, 60_000);

  it('fails closed when the oracle service claims a verified outcome', async () => {
    const result = await orchestrator({
      resolveOracle: async () => ({ resolved: [], diagnostics: [], outcome: 'verified' as never }),
    }).run(orchestratorInput('oracle-verified-outcome'));

    expect(result.status).toBe('failed');
    expect(result.outcome).toBe('blocked');
    expect(result.promotionEligible).toBe(false);
    expect(result.completedStages).not.toContain(9);
  }, 60_000);

  it('revalidates and blocks a resolver IntentSpec carrying a verified truth state', async () => {
    const checkpointer = new InMemoryStageCheckpointer();
    const result = await orchestrator({
      checkpointer,
      resolveOracle: async (input) => {
        const resolved = await realResolution(input, [
          { candidateId: candidate().id, oracle: domainRule() },
        ]);
        if (!resolved.intentSpec) throw new Error('Expected resolved IntentSpec');
        return {
          ...resolved,
          intentSpec: {
            ...resolved.intentSpec,
            assertions: resolved.intentSpec.assertions.map((assertion) => ({
              ...assertion,
              truthState: 'verified',
            })),
          } as never,
        };
      },
    }).run(orchestratorInput('oracle-hostile-spec'));
    const artifact = await stageNineArtifact(checkpointer, result, 'oracle-hostile-spec');

    expect(JSON.stringify(artifact)).not.toContain(':"verified"');
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ severity: 'blocked', subject: 'stage-9' }),
    );
  }, 60_000);

  it('blocks an oracle rule whose candidate id is unmatched', async () => {
    const result = await orchestrator({
      resolveOracle: (input) => realResolution(input, []),
    }).run(
      orchestratorInput('oracle-unmatched', [
        { candidateId: 'authentication.typo', oracle: domainRule() },
      ]),
    );

    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: ARXIC_ORCH_ORACLE_UNMATCHED,
        severity: 'blocked',
        subject: 'stage-9',
        message: expect.stringContaining('authentication.typo'),
      }),
    );
  }, 60_000);

  it('persists and reloads a stable acceptance IntentSpec while compilation continues', async () => {
    const checkpointer = new InMemoryStageCheckpointer();
    let compileRan = false;
    const rules = [{ candidateId: 'authentication.login', oracle: domainRule() }] as const;
    const result = await orchestrator({
      checkpointer,
      compile: async () => {
        compileRan = true;
        return { compiled: true, plan: 'compiled raw workflow' };
      },
      resolveOracle: (input) => {
        expect(input.candidates[0]?.id).toBe('authentication.login');
        expect(input.observations.map(({ kind }) => kind)).toEqual(['source', 'runtime']);
        return realResolution(input, input.oracleRules);
      },
    }).run(orchestratorInput('oracle-happy', rules));
    const artifact = await stageNineArtifact(checkpointer, result, 'oracle-happy');
    const reloaded = await checkpointer.load('oracle-happy');
    if (!reloaded) throw new Error('Expected reloaded run state');
    const reloadedArtifact = await stageNineArtifact(checkpointer, reloaded, 'oracle-happy');

    expect(compileRan).toBe(true);
    expect(artifact.oracleOutcome).toBe('observed');
    expect(artifact.intentSpec?.assertions[0]?.kind).toBe('acceptance');
    expect(canonicalizeIntentSpec(artifact.intentSpec!).canonicalSha256).toBe(
      pinnedCanonicalSha256,
    );
    expect(canonicalizeIntentSpec(reloadedArtifact.intentSpec!).canonicalSha256).toBe(
      pinnedCanonicalSha256,
    );
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: ARXIC_ORCH_ORACLE_RESOLVED,
        severity: 'observed',
        message: expect.stringContaining('Resolved 1 acceptance and 0 characterization assertions'),
      }),
    );
  }, 60_000);
});

function orchestrator(overrides: {
  checkpointer?: InMemoryStageCheckpointer;
  compile?: (input: {
    candidates: readonly Candidate[];
    observations: readonly EvidenceRef[];
    outputDirectory: string;
    origin: string;
    intentSpec?: IntentSpec;
  }) => Promise<CompilationResult>;
  resolveOracle?: (input: OracleResolutionInput) => Promise<OracleResolution>;
  verify?: () => Promise<ReturnType<typeof verifiedResult>>;
  promote?: () => Promise<ReturnType<typeof promotionReceipt>>;
}) {
  return new LangGraphOrchestrator({
    checkpointer: overrides.checkpointer ?? new InMemoryStageCheckpointer(),
    inferCandidates: async () => ({ requestId: 'oracle-resolution', candidates: [candidate()] }),
    reconcile: async ({ candidates }) => ({ denominator: candidates.length, rows: [] }),
    prepareFixtures: async () => ({
      provisioned: true,
      requirements: [],
      leases: [],
      diagnostics: [],
    }),
    explore: async () => ({ approved: true, evidenceRefs: observations(), decisions: [] }),
    compile: overrides.compile ?? (async () => ({ compiled: true, plan: 'compiled raw workflow' })),
    ...(overrides.verify ? { verify: overrides.verify } : {}),
    ...(overrides.promote ? { promote: overrides.promote } : {}),
    ...(overrides.resolveOracle ? { resolveOracle: overrides.resolveOracle } : {}),
  });
}

async function realResolution(
  input: OracleResolutionInput,
  oracleRules: readonly OracleRule[],
): Promise<OracleResolution> {
  const candidate = input.candidates[0];
  const workflow = candidate?.workflow;
  if (!candidate || !workflow) throw new Error('Expected login candidate workflow');
  const source = [sourceId];
  const runtime = [runtimeId];
  const assertion = workflow.transitions[0]?.assertions[0];
  if (!assertion) throw new Error('Expected login assertion');
  const specInput: IntentSpecInput = {
    schemaVersion: INTENT_SCHEMA_VERSION,
    id: `${input.runId}-intent`,
    domain: workflow.domain,
    persona: workflow.persona,
    intent: workflow.title,
    lineage: input.lineage,
    proposals: workflow.transitions.map((transition, index) => ({
      id: `${candidate.id}:${index}`,
      intent: transition.action.intent,
      action: transition.action.intent,
      fromState: transition.from,
      toState: transition.to,
      evidenceRefs: { source, runtime },
    })),
    assertions: [
      {
        id: 'login-success',
        intent: assertion.intent,
        expectedValue: assertion.intent,
        oracles: oracleRules
          .filter(({ candidateId }) => candidateId === candidate.id)
          .map(({ oracle }) => oracle),
        evidenceRefs: { source, runtime },
      },
    ],
    evidenceRefs: { source, runtime },
  };
  const normalized = normalizeIntentSpec(specInput);
  if (!normalized.ok) {
    return {
      resolved: [],
      diagnostics: normalized.diagnostics,
      outcome: normalized.diagnostics.some(({ severity }) => severity === 'blocked')
        ? 'blocked'
        : 'contradicted',
    };
  }
  return {
    intentSpec: normalized.spec,
    resolved: normalized.spec.assertions,
    diagnostics: [],
    outcome: 'observed',
  };
}

async function conflictResolution(input: OracleResolutionInput): Promise<OracleResolution> {
  const candidate = input.candidates[0];
  const workflow = candidate?.workflow;
  const assertion = workflow?.transitions[0]?.assertions[0];
  if (!candidate || !workflow || !assertion) throw new Error('Expected login candidate workflow');
  const evidenceRefs = { source: [sourceId], runtime: [runtimeId] } as const;
  const base = {
    id: 'login-success',
    intent: assertion.intent,
    oracles: [domainRule()],
    evidenceRefs,
  };
  const normalized = normalizeIntentSpec({
    schemaVersion: INTENT_SCHEMA_VERSION,
    id: `${input.runId}-intent`,
    domain: workflow.domain,
    persona: workflow.persona,
    intent: workflow.title,
    lineage: input.lineage,
    proposals: [],
    assertions: [
      { ...base, expectedValue: 'url:/' },
      { ...base, expectedValue: 'text:Logged in' },
    ],
    evidenceRefs,
  });
  if (normalized.ok) throw new Error('Expected conflicting real intent diagnostics');
  return { resolved: [], diagnostics: normalized.diagnostics, outcome: 'contradicted' };
}

function domainRule() {
  const identity = {
    domainPackId: '@arxic/auth-domain-pack',
    ruleId: 'authentication.login',
    ruleVersion: '0.0.0',
  };
  return {
    kind: 'domain-rule',
    ...identity,
    digest: createHash('sha256')
      .update(JSON.stringify(identity, Object.keys(identity).sort()))
      .digest('hex'),
  } as const;
}

function candidate(): Candidate {
  return {
    id: 'authentication.login',
    title: 'Login',
    evidenceRefs: [sourceId, runtimeId],
    workflow: workflow(),
  };
}

function workflow(): Workflow {
  return {
    $schema: 'https://arxic.dev/schemas/workflow/v1.json',
    id: 'authentication.login',
    version: 1,
    title: 'Login',
    domain: 'authentication',
    persona: 'registered-user',
    status: 'hypothesized',
    confidence: 0.5,
    scope: { commit, environment: 'local-test', browser: 'chromium' },
    preconditions: [],
    states: [{ id: 'login-page' }, { id: 'home' }],
    transitions: [
      {
        from: 'login-page',
        to: 'home',
        action: { intent: 'Submit login credentials' },
        assertions: [{ intent: 'url:/' }],
        evidenceRefs: [sourceId, runtimeId],
      },
    ],
    negativeCases: [],
    verification: {
      requiredRuns: 2,
      screenshotCheckpoints: ['home'],
      forbidNetworkErrors: true,
      trace: 'retain',
    },
    evidenceRefs: [sourceId, runtimeId],
  };
}

function coherentObservedBundle(): StagedBundle {
  const observedWorkflow = workflow();
  const artifact = {
    kind: 'playwright-spec',
    path: 'tests/workflow.spec.ts',
    sha256: 'd'.repeat(64),
  };
  return {
    workflow: observedWorkflow,
    evidenceIndex: {
      [sourceId]: observations()[0]!,
      [runtimeId]: observations()[1]!,
    },
    artifacts: [artifact],
    plan: 'Replay login.',
    manifest: {
      schemaVersion: 1,
      bundleVersion: 1,
      workflow: { id: observedWorkflow.id, status: observedWorkflow.status },
      repository: pathToFileURL(repository).href,
      commit,
      appBuildDigest: 'b'.repeat(64),
      environment: { class: 'local-test', browser: 'chromium' },
      generator: { id: '@arxic/playwright-compiler', version: '0.0.0' },
      verification: {
        requiredRuns: 2,
        runs: [
          {
            startedAt: '2026-08-10T00:00:00.000Z',
            finishedAt: '2026-08-10T00:00:00.000Z',
            passed: false,
          },
        ],
      },
      fileHashes: [{ path: artifact.path, sha256: artifact.sha256 }],
      gateResults: [{ gate: 'compile', passed: true }],
      coverage: { denominator: 1, uncovered: 1 },
      runId: 'oracle-resolution',
    },
  };
}

function verifiedResult(stagedBundle: StagedBundle) {
  return {
    outcome: 'verified' as const,
    stagedBundle,
    diagnostics: [],
    artifacts: [{ kind: 'screenshot', path: '/safe/login.png', sha256: 'e'.repeat(64) }],
    runs: [{ passed: true }, { passed: true }],
    gates: [{ gate: 'verify', passed: true }],
  };
}

function promotionReceipt(stagedBundle: StagedBundle) {
  return {
    manifest: stagedBundle.manifest,
    promotedAt: '2026-08-10T00:00:00.000Z',
    location: 'test://promoted',
    checksumSha256: 'f'.repeat(64),
  };
}

function observations(): EvidenceRef[] {
  return [
    {
      kind: 'source',
      repo: pathToFileURL(repository).href,
      commit,
      path: 'page.tsx',
      startLine: 1,
      endLine: 1,
      blobSha256: 'a'.repeat(64),
      extractor: 'oracle-resolution-test',
    },
    {
      kind: 'runtime',
      runId: 'authentication.login',
      appBuildDigest: 'b'.repeat(64),
      browser: 'chromium',
      browserVersion: '1.62.1',
      url: `${origin}/`,
      timestamp: '2026-08-10T00:00:00.000Z',
      accessibilitySnapshotSha256: 'c'.repeat(64),
    },
  ];
}

function orchestratorInput(runId: string, oracleRules: readonly OracleRule[] = []) {
  return {
    runId,
    origin,
    revision: { repository: pathToFileURL(repository).href, commit, dirty: false },
    rulepacksDir: resolve(root, 'rulepacks'),
    artifactsDir,
    framework: 'nextjs',
    features: ['login'],
    maxUrls: 1,
    maxDepth: 0,
    appBuildDigest: 'b'.repeat(64),
    expectedNonce: 'oracle-resolution',
    oracleRules,
  } as const;
}

async function stageNineArtifact(
  checkpointer: InMemoryStageCheckpointer,
  state: Awaited<ReturnType<LangGraphOrchestrator['run']>>,
  runId: string,
): Promise<CompilationResult> {
  const ref = state.artifacts[9];
  if (!ref) throw new Error('Expected stage-9 artifact');
  return (await checkpointer.readArtifact(runId, ref)) as CompilationResult;
}

async function committedSource(): Promise<string> {
  const directory = await temporaryDirectory('source-');
  await writeFile(join(directory, 'page.tsx'), 'export default function Page() { return null; }\n');
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 'Arxic Test',
    GIT_AUTHOR_EMAIL: 'test@arxic.invalid',
    GIT_COMMITTER_NAME: 'Arxic Test',
    GIT_COMMITTER_EMAIL: 'test@arxic.invalid',
    GIT_AUTHOR_DATE: '2026-08-10T00:00:00Z',
    GIT_COMMITTER_DATE: '2026-08-10T00:00:00Z',
  };
  await execute('git', ['init', '--initial-branch=main'], { cwd: directory, env });
  await execute('git', ['add', '.'], { cwd: directory, env });
  await execute('git', ['commit', '-m', 'fixture'], { cwd: directory, env });
  commit = (await execute('git', ['rev-parse', 'HEAD'], { cwd: directory })).stdout.trim();
  return directory;
}

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), `arxic-oracle-${prefix}`));
  directories.push(directory);
  return directory;
}
