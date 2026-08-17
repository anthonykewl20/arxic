import { validateDiagnostic } from '@arxic/contracts';
import { describe, expect, it } from 'vitest';
import {
  ARXIC_ORCH_HASH_MISMATCH,
  ARXIC_ORCH_INPUT_FINGERPRINT_INVALID,
  ARXIC_ORCH_INPUT_FINGERPRINT_MISMATCH,
  ARXIC_ORCH_INPUT_FINGERPRINT_MISSING,
  artifactHash,
  createRunInputFingerprint,
  LangGraphOrchestrator,
  type ImmutableArtifactRef,
  type OrchestratorInput,
  type RunState,
  type StageArtifact,
  type StageCheckpointer,
  type StageCheckpoint,
  type StageId,
} from '..';

const stages = [0, 1, 2, 13, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const; // stage 13 = domain-inventory (DG-06), runs between 2 and 3

const baseline: OrchestratorInput = {
  runId: 'reused-terminal-run',
  origin: 'http://127.0.0.1:3210',
  revision: {
    repository: 'file:///workspace/reference-app',
    commit: 'a'.repeat(40),
    dirty: false,
  },
  rulepacksDir: '/workspace/rulepacks',
  artifactsDir: '/workspace/artifacts',
  framework: 'nextjs',
  features: ['login'],
  maxUrls: 8,
  maxDepth: 1,
  config: { models: { inference: 'model-a' } },
};

describe('terminal run reuse', () => {
  it.each([
    ['source revision', { revision: { ...baseline.revision, commit: 'b'.repeat(40) } }],
    ['origin', { origin: 'http://127.0.0.1:3211' }],
    ['policy', { maxUrls: 9 }],
    ['config/models', { config: { models: { inference: 'model-b' } } }],
  ] as const)('blocks when the reused %s changes', async (_field, changed) => {
    const checkpointer = new TerminalCheckpointer(terminalState());
    const result = await new LangGraphOrchestrator({ checkpointer }).run({
      ...baseline,
      ...changed,
    });

    expect(result).toMatchObject({ status: 'failed', outcome: 'blocked' });
    expect(result.receipt).toBeUndefined();
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: ARXIC_ORCH_INPUT_FINGERPRINT_MISMATCH,
        severity: 'blocked',
      }),
    );
    expect(
      validateDiagnostic(
        result.diagnostics.find(({ code }) => code === ARXIC_ORCH_INPUT_FINGERPRINT_MISMATCH)!,
      ),
    ).toEqual(expect.objectContaining({ ok: true }));
  });

  it('blocks a legacy terminal record whose inputs cannot be proven identical', async () => {
    const original = terminalState({ legacy: true });
    const checkpointer = new TerminalCheckpointer(original);
    const result = await new LangGraphOrchestrator({ checkpointer }).run(baseline);

    expect(result.status).toBe('failed');
    expect(result.outcome).toBe('blocked');
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: ARXIC_ORCH_INPUT_FINGERPRINT_MISSING, severity: 'blocked' }),
    );
    await expect(checkpointer.load(baseline.runId)).resolves.toEqual(original);
  });

  it('does not alter a terminal record after mismatched reuse is rejected', async () => {
    const original = terminalState();
    const checkpointer = new TerminalCheckpointer(original);

    await new LangGraphOrchestrator({ checkpointer }).run({ ...baseline, maxUrls: 9 });

    await expect(checkpointer.load(baseline.runId)).resolves.toEqual(original);
  });

  it('returns the original terminal receipt when identical inputs follow a rejected mismatch', async () => {
    const original = terminalState();
    const checkpointer = new TerminalCheckpointer(original);
    const orchestrator = new LangGraphOrchestrator({ checkpointer });

    await orchestrator.run({ ...baseline, maxUrls: 9 });

    await expect(orchestrator.run(baseline)).resolves.toEqual(original);
  });

  it('blocks invalid fingerprint inputs without throwing or modifying the terminal record', async () => {
    const original = terminalState();
    const checkpointer = new TerminalCheckpointer(original);
    const result = await new LangGraphOrchestrator({ checkpointer }).run({
      ...baseline,
      config: { concurrency: BigInt(1) },
    });

    expect(result).toMatchObject({ status: 'failed', outcome: 'blocked' });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: ARXIC_ORCH_INPUT_FINGERPRINT_INVALID, severity: 'blocked' }),
    );
    await expect(checkpointer.load(baseline.runId)).resolves.toEqual(original);

    const circular: { self?: unknown } = {};
    circular.self = circular;
    const circularResult = await new LangGraphOrchestrator({ checkpointer }).run({
      ...baseline,
      policy: circular,
    });

    expect(circularResult.diagnostics).toContainEqual(
      expect.objectContaining({ code: ARXIC_ORCH_INPUT_FINGERPRINT_INVALID, severity: 'blocked' }),
    );
    await expect(checkpointer.load(baseline.runId)).resolves.toEqual(original);
  });

  it('blocks terminal reuse when persisted artifact bytes drift from their recorded hash', async () => {
    const checkpointer = new TerminalCheckpointer(terminalState(), 9);
    const result = await new LangGraphOrchestrator({ checkpointer }).run(baseline);

    expect(result.status).toBe('failed');
    expect(result.outcome).toBe('blocked');
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: ARXIC_ORCH_HASH_MISMATCH, severity: 'blocked' }),
    );
  });

  it('returns the terminal state when inputs and persisted artifact bytes are identical', async () => {
    const persisted = terminalState();
    const checkpointer = new TerminalCheckpointer(persisted);

    await expect(new LangGraphOrchestrator({ checkpointer }).run(baseline)).resolves.toEqual(
      persisted,
    );
  });
});

class TerminalCheckpointer implements StageCheckpointer {
  readonly #artifacts = new Map<string, StageArtifact>();
  #state: RunState;
  readonly #driftedStage?: StageId;

  constructor(state: RunState, driftedStage?: StageId) {
    this.#state = state;
    this.#driftedStage = driftedStage;
    for (const stage of stages) this.#artifacts.set(`stage:${stage}`, { stage });
  }

  async load(_runId: string): Promise<RunState> {
    void _runId;
    return this.#state;
  }

  async saveArtifact(
    _runId: string,
    stage: StageId,
    value: StageArtifact,
  ): Promise<ImmutableArtifactRef> {
    this.#artifacts.set(`stage:${stage}`, value);
    return { id: `stage:${stage}`, sha256: artifactHash(value) };
  }

  async readArtifact(_runId: string, ref: ImmutableArtifactRef): Promise<StageArtifact> {
    return this.#artifacts.get(ref.id);
  }

  async verifyArtifact(_runId: string, ref: ImmutableArtifactRef): Promise<boolean> {
    const stage = Number(ref.id.slice('stage:'.length)) as StageId;
    if (stage === this.#driftedStage) return false;
    return artifactHash(this.#artifacts.get(ref.id)) === ref.sha256;
  }

  async saveCheckpoint(
    _runId: string,
    _checkpoint: StageCheckpoint,
    state: RunState,
  ): Promise<void> {
    this.#state = state;
  }
}

function terminalState(options: { legacy?: boolean; driftedStage?: StageId } = {}): RunState {
  const artifacts = Object.fromEntries(
    stages.map((stage) => {
      const value = { stage };
      return [stage, { id: `stage:${stage}`, sha256: artifactHash(value) }];
    }),
  ) as RunState['artifacts'];
  return {
    runId: baseline.runId,
    ...(options.legacy
      ? {}
      : {
          inputFingerprint: createRunInputFingerprint({
            sourceRevision: baseline.revision,
            origin: baseline.origin,
            policy: {
              appBuildDigest: baseline.appBuildDigest,
              expectedNonce: baseline.expectedNonce,
              maxDepth: baseline.maxDepth,
              maxUrls: baseline.maxUrls,
              requireExplorationApproval: baseline.requireExplorationApproval,
              supplied: baseline.policy,
            },
            config: {
              features: baseline.features,
              framework: baseline.framework,
              languages: baseline.languages,
              model: undefined,
              modelPrompt: undefined,
              oracleRules: baseline.oracleRules,
              personas: baseline.personas,
              rulepacksDir: baseline.rulepacksDir,
              supplied: baseline.config,
              credentialBytes: baseline.credentialBytes,
            },
          }).sha256,
        }),
    status: 'partial',
    outcome: 'observed',
    completedStages: stages,
    artifacts,
    checkpoints: [
      {
        stage: 12,
        name: 'promotion',
        status: 'completed',
        startedAt: '2026-08-14T00:00:00.000Z',
        finishedAt: '2026-08-14T00:00:01.000Z',
        adapter: { name: '@arxic/orchestrator-langgraph', version: '0.0.0' },
        orchestratorVersion: '0.0.0',
        artifacts: Object.values(artifacts),
        toolVersions: {},
        decisions: [],
        approvals: [],
        gateResults: [],
        redaction: { passed: true, redactedFields: [] },
      },
    ],
    diagnostics: [],
    promotionEligible: false,
    receipt: {
      manifest: {} as never,
      promotedAt: '2026-08-14T00:00:01.000Z',
      location: '/workspace/bundles/reused-terminal-run',
      checksumSha256: 'a'.repeat(64),
    },
  };
}
