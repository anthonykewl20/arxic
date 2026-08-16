import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  PIPELINE_RESULT_PATH,
  pipelineConfigSha256,
  pipelineSha256,
  serializePipelineResult,
  type ImportedArtifacts,
  type PipelineResult,
} from '@arxic/worker';
import { normalizeWorkerResult, runResultFromState, type RunRequest } from '../executor';
import { VALID_CONFIG } from './fixtures';

const now = '2026-08-13T12:00:00.000Z';
const request: RunRequest = {
  runId: 'protocol-test',
  config: VALID_CONFIG,
  runDirectory: '/tmp/protocol-test',
  rulepacksDir: '/tmp/rulepacks',
  now: () => now,
};
const stageBytes = Buffer.from('{"stage":10}\n');
const stageHash = sha256(stageBytes);
const trustedSourceSha256 = 'a'.repeat(64);

describe('worker PipelineResult fail-closed normalization', () => {
  it('rejects a fabricated worker source hash against the trusted staged bytes', () => {
    const fabricated = envelope();
    const result = normalizeWorkerResult(request, imported(fabricated), 'f'.repeat(64));
    expect(result).toMatchObject({ ok: false, kind: 'source' });
  });

  it('rejects a missing worker source hash before reconciliation', () => {
    const candidate = envelope();
    const missing = {
      ...candidate,
      binding: { ...candidate.binding, sourceSha256: undefined },
    };
    expect(
      normalizeWorkerResult(
        request,
        imported(missing as unknown as PipelineResult),
        trustedSourceSha256,
      ),
    ).toMatchObject({ ok: false, kind: 'protocol' });
  });

  it('rejects a worker-asserted verified value without a stage-10 verifier record as forged', () => {
    const forged = { ...envelope({ outcome: 'verified' }), verifier: undefined };
    const result = normalizeWorkerResult(
      request,
      imported(forged as PipelineResult),
      trustedSourceSha256,
    );
    expect(result).toMatchObject({ ok: false, kind: 'verifier' });
  });

  it('rejects a stale or replay-inconsistent stage-10 verifier record', () => {
    const candidate = envelope();
    const stale = {
      ...candidate,
      verifier: { ...candidate.verifier!, cleanReplayCount: 1 },
    };
    expect(normalizeWorkerResult(request, imported(stale), trustedSourceSha256)).toMatchObject({
      ok: false,
      kind: 'verifier',
    });
  });

  it('rejects an artifact hash mismatch against independently imported bytes', () => {
    const result = normalizeWorkerResult(
      request,
      imported(envelope({ outcome: 'observed' }), Buffer.from('tampered')),
      trustedSourceSha256,
    );
    expect(result).toMatchObject({ ok: false, kind: 'protocol' });
  });

  it('normalizes a fresh consistent envelope through the local RunResult shape', () => {
    const normalized = normalizeWorkerResult(
      request,
      imported(envelope({ outcome: 'observed' })),
      trustedSourceSha256,
    );
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) return;
    const workerResult = runResultFromState(request, normalized.state);
    const localResult = runResultFromState(request, normalized.state);
    expect(Object.keys(workerResult).sort()).toEqual(Object.keys(localResult).sort());
    expect(workerResult).toEqual(localResult);
    expect(workerResult.state.artifacts[10]).toEqual({ id: 'stage:10', sha256: stageHash });
  });

  // ---- stage-13 execution-order semantics (DG-06, exception 2 on #250) ----
  // Stage 13 (domain-inventory) uses the next available ID but EXECUTES at
  // position 3 (graph order 2 → 13 → 3, ADR-008 numbering recorded at DG-06),
  // so "monotonic" means a PREFIX OF THE CANONICAL EXECUTION ORDER
  // (STAGE_EXECUTION_ORDER, exported by @arxic/orchestrator-langgraph) —
  // never `stage === index`. The five tests below are the mandated no-weakening
  // contract: the honest rejections that held before must still hold.
  describe('execution-order prefix validation (stage 13 between 2 and 3)', () => {
    it('accepts the real full execution sequence [0,1,2,13,3,…,12]', () => {
      const result = normalizeWorkerResult(
        request,
        imported(
          envelope({ outcome: 'observed', stages: [0, 1, 2, 13, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] }),
        ),
        trustedSourceSha256,
      );
      expect(result).toMatchObject({ ok: true });
    });

    it('accepts an incomplete-but-gapless 0–12-only prefix (old worker result without stage 13) unchanged', () => {
      // Backward compat: a pre-DG-06 worker result has no stage-13 checkpoint
      // at all; its sequence [0,1,2,3,…] is a prefix of the 0–12 order and
      // must validate exactly as before.
      const result = normalizeWorkerResult(
        request,
        imported(envelope({ outcome: 'observed' })),
        trustedSourceSha256,
      );
      expect(result).toMatchObject({ ok: true });
    });

    it('rejects a genuinely out-of-order sequence (e.g. [0,2,1] in canonical-order terms)', () => {
      const result = normalizeWorkerResult(
        request,
        imported(envelope({ stages: [0, 2, 1, 3, 4, 5, 6, 7, 8, 9] })),
        trustedSourceSha256,
      );
      expect(result).toMatchObject({ ok: false, kind: 'protocol' });
    });

    it('rejects stage 13 misplaced in the sequence (id is not position)', () => {
      // [0,1,2,3,13,…] looks numeric-sorted but is NOT the canonical order —
      // 13 must appear between 2 and 3, never after 3.
      const result = normalizeWorkerResult(
        request,
        imported(envelope({ stages: [0, 1, 2, 3, 13, 4, 5, 6, 7, 8, 9, 10, 11, 12] })),
        trustedSourceSha256,
      );
      expect(result).toMatchObject({ ok: false, kind: 'protocol' });
    });

    it('rejects a sequence missing an intermediate stage (gap mid-sequence)', () => {
      const result = normalizeWorkerResult(
        request,
        imported(envelope({ stages: [0, 1, 2, 13, 3, 4, 6, 7, 8, 9, 10] })),
        trustedSourceSha256,
      );
      expect(result).toMatchObject({ ok: false, kind: 'protocol' });
    });

    it('rejects a duplicate stage in the checkpoint sequence', () => {
      const result = normalizeWorkerResult(
        request,
        imported(envelope({ stages: [0, 1, 2, 13, 3, 3, 4] })),
        trustedSourceSha256,
      );
      expect(result).toMatchObject({ ok: false, kind: 'protocol' });
    });

    it('rejects completed stages ordered against a DIFFERENT execution order than the checkpoints', () => {
      // Checkpoints in the current order, completed stages in the legacy
      // order — a mixed envelope is internally inconsistent (stage 3 cannot
      // complete while stage 13, which precedes it, has a checkpoint but did
      // not complete) and must be rejected exactly like the id≡position
      // check it replaces.
      const current = envelope({ stages: [0, 1, 2, 13, 3] });
      const mixed = {
        ...current,
        state: { ...current.state, completedStages: [0, 1, 2, 3] as unknown },
      };
      const result = normalizeWorkerResult(
        request,
        imported(mixed as unknown as PipelineResult),
        trustedSourceSha256,
      );
      expect(result).toMatchObject({ ok: false, kind: 'protocol' });
    });

    // REVIEW ROUND (P2): a PRE-DG-06 worker run that failed at stage 3 writes
    // checkpoints [0,1,2,3] (the failed stage still has a checkpoint) with
    // completedStages [0,1,2] — LEGACY-order checkpoints + agreement-region
    // completed stages. The baseline id≡position check passed this shape; a
    // first-match-wins order comparison rejected it as a protocol failure.
    // The ORDER gate must accept the shape again. (The envelope as a whole is
    // still rejected — by the PRE-EXISTING unconditional stage-10 requirement
    // in validateVerifier, exactly as at baseline — so the pin here is that
    // the failure is NOT the order gate's 'protocol'. The order-gate
    // acceptance itself is pinned directly on the exported predicate in
    // packages/orchestrator-langgraph/src/__tests__/stage-order.test.ts.)
    it('passes the order gate for a legacy envelope that failed at stage 3: checkpoints [0,1,2,3], completedStages [0,1,2]', () => {
      const legacy = envelope({ stages: [0, 1, 2, 3] });
      const failedAtThree = {
        ...legacy,
        state: { ...legacy.state, completedStages: [0, 1, 2] as unknown },
      };
      const result = normalizeWorkerResult(
        request,
        imported(failedAtThree as unknown as PipelineResult),
        trustedSourceSha256,
      );
      expect(result).toMatchObject({ ok: false, kind: 'verifier' });
    });

    it('passes the order gate for the mirror shape on a current worker: checkpoints [0,1,2,13,3], completedStages [0,1,2,13]', () => {
      const current = envelope({ outcome: 'observed', stages: [0, 1, 2, 13, 3] });
      const failedAtThree = {
        ...current,
        state: { ...current.state, completedStages: [0, 1, 2, 13] as unknown },
      };
      const result = normalizeWorkerResult(
        request,
        imported(failedAtThree as unknown as PipelineResult),
        trustedSourceSha256,
      );
      expect(result).toMatchObject({ ok: false, kind: 'verifier' });
    });
  });
});

function envelope(
  overrides: {
    outcome?: 'verified' | 'observed';
    /** Checkpoint sequence in the given order (default: the 0–12 legacy order). */
    stages?: readonly number[];
  } = {},
): PipelineResult {
  const outcome = overrides.outcome ?? 'verified';
  const stages = overrides.stages ?? [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const ref = {
    id: 'stage:10',
    path: 'stages/10.json',
    sha256: stageHash,
    bytes: stageBytes.length,
  };
  const checkpoint = {
    stage: 10 as const,
    name: 'verify',
    status: 'completed' as const,
    startedAt: '2026-08-13T11:59:00.000Z',
    finishedAt: '2026-08-13T11:59:01.000Z',
    adapter: { name: '@arxic/verifier', version: '0.0.0' },
    orchestratorVersion: '0.0.0',
    artifacts: [ref],
    toolVersions: { node: '22.0.0', '@arxic/verifier': '0.0.0' },
    decisions: ['deterministic verifier ran'],
    approvals: [],
    gateResults: [{ gate: 'verify', passed: true }],
    redaction: { passed: true, redactedFields: [] },
  };
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
      runId: request.runId,
      configSha256: pipelineConfigSha256(request.config),
      sourceSha256: trustedSourceSha256,
      sourceRevision: request.config.source.revision,
      appBuildDigest: 'b'.repeat(64),
      workerImageVersion: 'synthetic-no-image',
      toolVersion: '0.0.0',
      browserVersion: '1.62.1',
      orchestratorVersion: '0.0.0',
    },
    freshness: {
      producedAt: '2026-08-13T11:59:30.000Z',
      expiresAt: '2026-08-13T12:05:00.000Z',
    },
    state: {
      runId: request.runId,
      status: outcome === 'verified' ? 'partial' : 'partial',
      outcome,
      activeStage: stages.at(-1) as PipelineResult['state']['activeStage'],
      completedStages: [...stages] as PipelineResult['state']['completedStages'],
      artifacts: [{ stage: 10, ref }],
      checkpoints,
      diagnostics: [],
      promotionEligible: outcome === 'verified',
    },
    candidate: { gateResults: [{ gate: 'verify', passed: true }] },
    verifier: {
      version: 1,
      runId: request.runId,
      verifierVersion: '0.0.0',
      orchestratorVersion: '0.0.0',
      configSha256: pipelineConfigSha256(request.config),
      sourceSha256: trustedSourceSha256,
      appBuildDigest: 'b'.repeat(64),
      requiredReplayCount: 2,
      cleanReplayCount: 2,
      outcome,
      artifactHashes: [stageHash],
      stagedBundleSha256: pipelineSha256(null),
    },
  };
}

function imported(result: PipelineResult, bytes = stageBytes): ImportedArtifacts {
  const envelopeBytes = serializePipelineResult(result);
  const files = [
    { path: PIPELINE_RESULT_PATH, sha256: sha256(envelopeBytes), bytes: envelopeBytes },
    { path: 'stages/10.json', sha256: stageHash, bytes },
  ];
  return {
    manifest: {
      runId: request.runId,
      resultReady: true,
      files: files.map((file) => ({
        path: file.path,
        sha256: file.sha256,
        bytes: file.bytes.length,
      })),
    },
    files,
  };
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
