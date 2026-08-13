import { createHash } from 'node:crypto';
import {
  validateEvidenceIndex,
  validateManifest,
  validateWorkflow,
  type StagedBundle,
  type Workflow,
} from '@arxic/contracts';
import {
  canonicalJson,
  type RunState,
  type StageCheckpoint,
  type StageId,
  type VerificationNodeResult,
} from '@arxic/orchestrator-langgraph';
import { describe, expect, it } from 'vitest';
import { pipelineConfigSha256, pipelineSha256, pipelineSourceSha256 } from '../pipeline-result';
import { projectPipelineResult, type VolumeFile } from '../runner-project';
import type { RunSpec } from '../run-spec';

const runId = 'worker-projection-run';
const stagedBundle = bundle();
const stageTenResult: VerificationNodeResult = {
  outcome: 'verified',
  diagnostics: [],
  artifacts: [],
  runs: [{ passed: true }, { passed: true }],
  stagedBundle,
  gates: [{ gate: 'verify', passed: true }],
};
const artifactValues = Array.from({ length: 13 }, (_, stage) =>
  stage === 10 ? stageTenResult : { stage, produced: true },
);
const volumeFiles = artifactValues.map((value, stage) => volumeFile(stage, value));
const checkpoints = artifactValues.map((_, stage) =>
  checkpoint(stage as StageId, volumeFiles[stage]),
);
const state: RunState = {
  runId,
  status: 'completed',
  outcome: 'verified',
  completedStages: Array.from({ length: 13 }, (_, stage) => stage as StageId),
  artifacts: Object.fromEntries(checkpoints.map(({ stage, artifacts }) => [stage, artifacts[0]])),
  checkpoints,
  diagnostics: [],
  promotionEligible: true,
};
const spec: RunSpec = {
  runId,
  config: {
    version: 1,
    source: {
      repository: 'file:///work/source',
      revision: '0123456789abcdef0123456789abcdef01234567',
      languages: ['typescript'],
    },
    scope: {
      domains: ['authentication'],
      frameworks: ['nextjs'],
      browsers: ['chromium'],
      personas: ['registered-user'],
    },
    target: {
      origin: 'http://reference-app:3000',
      environmentClass: 'local-test',
      attestationPath: '/.well-known/arxic-environment',
      allowedOrigins: ['http://reference-app:3000'],
    },
    policy: {
      maxUrls: 20,
      maxDepth: 2,
      maxRuntimeMinutes: 10,
      mutation: 'leased-fixtures-only',
      externalNetwork: 'deny',
      requiredVerificationRuns: 2,
      screenshots: 'masked',
      trace: 'retain',
      humanApproval: [],
    },
    fixtures: {},
    models: { provider: 'test-model', sourceRetention: 'disabled' },
  },
};

describe('projectPipelineResult', () => {
  it('fails closed when a referenced stage artifact is missing', () => {
    expect(() => projectPipelineResult(projectInput(volumeFiles.slice(1)))).toThrow(/missing/u);
  });

  it('fails closed when a referenced stage artifact hash disagrees', () => {
    const corrupt = volumeFiles.map((file, index) =>
      index === 0 ? { ...file, bytes: Buffer.from('{}\n') } : file,
    );
    expect(() => projectPipelineResult(projectInput(corrupt))).toThrow(/hash disagrees/u);
  });

  it('projects honest replay counts below policy requirements', () => {
    const onePass = volumeFile(10, { ...stageTenResult, runs: [{ passed: true }] });
    const files = volumeFiles.map((file, stage) => (stage === 10 ? onePass : file));
    const stageTenCheckpoint = checkpoint(10, onePass);
    const changedState: RunState = {
      ...state,
      artifacts: { ...state.artifacts, 10: stageTenCheckpoint.artifacts[0] },
      checkpoints: checkpoints.map((item) => (item.stage === 10 ? stageTenCheckpoint : item)),
    };
    const projected = projectPipelineResult({ ...projectInput(files), state: changedState });
    expect(projected.result.verifier?.cleanReplayCount).toBe(1);
    expect(projected.result.verifier?.requiredReplayCount).toBe(2);
  });

  it('projects a deterministic verified result and transport manifest', () => {
    const projected = projectPipelineResult(projectInput(volumeFiles));
    expect(projected.manifest.files).toHaveLength(volumeFiles.length + 1);
    expect(projected.manifest.files.some(({ path }) => path === 'pipeline-result.json')).toBe(true);
    expect(projected.manifest.files.some(({ path }) => path === 'result-manifest.json')).toBe(
      false,
    );
    for (const entry of projected.manifest.files) {
      const bytes =
        entry.path === 'pipeline-result.json'
          ? projected.pipelineResultBytes
          : volumeFiles.find(({ path }) => path === entry.path)?.bytes;
      expect(bytes).toBeDefined();
      expect(entry.bytes).toBe(bytes?.length);
      expect(entry.sha256).toBe(sha256(bytes as Uint8Array));
    }
    expect(projected.result.binding.configSha256).toBe(pipelineConfigSha256(spec.config));
    expect(projected.result.binding.sourceSha256).toBe(pipelineSourceSha256(spec.config));
    expect(projected.result.state).toMatchObject({
      status: 'completed',
      outcome: 'verified',
      promotionEligible: true,
    });
    expect(projected.result.state.checkpoints).toHaveLength(13);
    expect(
      projected.result.state.checkpoints.every(({ artifacts }) =>
        artifacts.every(({ path, bytes }) => path.length > 0 && bytes > 0),
      ),
    ).toBe(true);
    expect(projected.result.candidate.stagedBundle).toEqual(stagedBundle);
    expect(validateManifest(stagedBundle.manifest).ok).toBe(true);
    expect(validateWorkflow(stagedBundle.workflow).ok).toBe(true);
    expect(validateEvidenceIndex(stagedBundle.evidenceIndex).ok).toBe(true);
    expect(projected.result.verifier).toMatchObject({
      runId,
      cleanReplayCount: 2,
      requiredReplayCount: 2,
      outcome: 'verified',
      stagedBundleSha256: pipelineSha256(stagedBundle),
    });
    expect(projected.result.verifier?.artifactHashes).toEqual([
      checkpoints[10].artifacts[0].sha256,
    ]);
    expect(projected.result.receipt).toBeUndefined();
  });
});

function projectInput(files: readonly VolumeFile[]) {
  return {
    spec,
    state,
    volumeFiles: files,
    now: () => '2026-08-13T12:00:00.000Z',
    appBuildDigest: 'b'.repeat(64),
    workerImageVersion: 'worker-test',
    toolVersion: 'tool-test',
    browserVersion: 'chromium-test',
  };
}

function volumeFile(stage: number, value: unknown): VolumeFile {
  return {
    path: `checkpoints/${runId}/artifacts/${String(stage).padStart(2, '0')}.json`,
    bytes: Buffer.from(`${canonicalJson(value)}\n`),
  };
}

function checkpoint(stage: StageId, file: VolumeFile): StageCheckpoint {
  return {
    stage,
    name: `stage-${stage}`,
    status: 'completed',
    startedAt: '2026-08-13T11:00:00.000Z',
    finishedAt: '2026-08-13T11:00:01.000Z',
    adapter: { name: 'test-adapter', version: '1.0.0' },
    orchestratorVersion: '0.0.0',
    artifacts: [{ id: `stage:${stage}`, sha256: sha256(file.bytes) }],
    toolVersions: stage === 10 ? { '@arxic/verifier': '0.0.0' } : {},
    decisions: [],
    approvals: [],
    gateResults: stage === 10 ? [{ gate: 'verify', passed: true }] : [],
    redaction: { passed: true, redactedFields: [] },
  };
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function bundle(): StagedBundle {
  const workflow: Workflow = {
    $schema: 'https://arxic.dev/schemas/workflow/v1.json',
    id: 'auth.login.success',
    version: 1 as const,
    title: 'Log in',
    domain: 'authentication',
    persona: 'registered-user',
    status: 'verified' as const,
    confidence: 1,
    scope: {
      commit: '0123456789abcdef0123456789abcdef01234567',
      environment: 'local-test',
      browser: 'chromium',
    },
    preconditions: [],
    states: [{ id: 'logged-out' }, { id: 'logged-in' }],
    transitions: [
      {
        from: 'logged-out',
        to: 'logged-in',
        action: { intent: 'Submit valid credentials' },
        assertions: [{ intent: 'The account home is visible' }],
        evidenceRefs: ['src:login-handler', 'run:login-success'],
      },
    ],
    negativeCases: [],
    verification: {
      requiredRuns: 2,
      screenshotCheckpoints: ['logged-in'],
      forbidNetworkErrors: true,
      trace: 'retain' as const,
    },
    evidenceRefs: ['src:login-handler', 'run:login-success'],
  };
  return {
    workflow,
    evidenceIndex: {
      'src:login-handler': {
        kind: 'source',
        repo: 'file:///work/source',
        commit: workflow.scope.commit,
        path: 'src/login.ts',
        startLine: 1,
        endLine: 2,
        blobSha256: 'a'.repeat(64),
        extractor: 'test',
      },
    },
    artifacts: [],
    plan: '# Log in',
    manifest: {
      schemaVersion: 1,
      bundleVersion: 1,
      workflow: { id: workflow.id, status: workflow.status },
      repository: 'file:///work/source',
      commit: workflow.scope.commit,
      appBuildDigest: 'b'.repeat(64),
      environment: { class: 'local-test', browser: 'chromium' },
      generator: { id: 'arxic', version: '0.0.0' },
      verification: {
        requiredRuns: 2,
        runs: [
          {
            startedAt: '2026-08-13T10:00:00.000Z',
            finishedAt: '2026-08-13T10:00:01.000Z',
            passed: true,
          },
          {
            startedAt: '2026-08-13T10:01:00.000Z',
            finishedAt: '2026-08-13T10:01:01.000Z',
            passed: true,
          },
        ],
      },
      fileHashes: [{ path: 'workflow.json', sha256: 'c'.repeat(64) }],
      gateResults: [{ gate: 'verify', passed: true }],
      coverage: { denominator: 1, verified: 1 },
      runId,
    },
  };
}
