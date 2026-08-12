import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  PIPELINE_RESULT_PATH,
  pipelineConfigSha256,
  pipelineSha256,
  pipelineSourceSha256,
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

describe('worker PipelineResult fail-closed normalization', () => {
  it('rejects a worker-asserted verified value without a stage-10 verifier record as forged', () => {
    const forged = { ...envelope({ outcome: 'verified' }), verifier: undefined };
    const result = normalizeWorkerResult(request, imported(forged as PipelineResult));
    expect(result).toMatchObject({ ok: false, kind: 'verifier' });
  });

  it('rejects a stale or replay-inconsistent stage-10 verifier record', () => {
    const candidate = envelope();
    const stale = {
      ...candidate,
      verifier: { ...candidate.verifier!, cleanReplayCount: 1 },
    };
    expect(normalizeWorkerResult(request, imported(stale))).toMatchObject({
      ok: false,
      kind: 'verifier',
    });
  });

  it('rejects an artifact hash mismatch against independently imported bytes', () => {
    const result = normalizeWorkerResult(
      request,
      imported(envelope({ outcome: 'observed' }), Buffer.from('tampered')),
    );
    expect(result).toMatchObject({ ok: false, kind: 'protocol' });
  });

  it('normalizes a fresh consistent envelope through the local RunResult shape', () => {
    const normalized = normalizeWorkerResult(request, imported(envelope({ outcome: 'observed' })));
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) return;
    const workerResult = runResultFromState(request, normalized.state);
    const localResult = runResultFromState(request, normalized.state);
    expect(Object.keys(workerResult).sort()).toEqual(Object.keys(localResult).sort());
    expect(workerResult).toEqual(localResult);
    expect(workerResult.state.artifacts[10]).toEqual({ id: 'stage:10', sha256: stageHash });
  });
});

function envelope(overrides: { outcome?: 'verified' | 'observed' } = {}): PipelineResult {
  const outcome = overrides.outcome ?? 'verified';
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
  const checkpoints = Array.from({ length: 11 }, (_, stage) =>
    stage === 10
      ? checkpoint
      : {
          ...checkpoint,
          stage: stage as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9,
          name: `stage-${stage}`,
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
      sourceSha256: pipelineSourceSha256(request.config),
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
      activeStage: 10,
      completedStages: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
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
      sourceSha256: pipelineSourceSha256(request.config),
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
