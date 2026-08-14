import { validateDiagnostic } from '@arxic/contracts';
import { describe, expect, it } from 'vitest';
import {
  ARXIC_ORCH_HASH_MISMATCH,
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

const stages = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

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
    const checkpointer = new TerminalCheckpointer(terminalState({ legacy: true }));
    const result = await new LangGraphOrchestrator({ checkpointer }).run(baseline);

    expect(result.status).toBe('failed');
    expect(result.outcome).toBe('blocked');
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: ARXIC_ORCH_INPUT_FINGERPRINT_MISSING, severity: 'blocked' }),
    );
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

  async load(): Promise<RunState> {
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
              maxDepth: baseline.maxDepth,
              maxUrls: baseline.maxUrls,
              requireExplorationApproval: baseline.requireExplorationApproval,
            },
            config: {
              features: baseline.features,
              framework: baseline.framework,
              model: undefined,
              modelPrompt: undefined,
              rulepacksDir: baseline.rulepacksDir,
              supplied: baseline.config,
              credentialBytes: undefined,
            },
          }).sha256,
        }),
    status: 'partial',
    outcome: 'observed',
    completedStages: stages,
    artifacts,
    checkpoints: [],
    diagnostics: [],
    promotionEligible: false,
  };
}
