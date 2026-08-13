import { createHash } from 'node:crypto';
import type { ArtifactTransportManifest } from '@arxic/environment';
import {
  ORCHESTRATOR_VERSION,
  type ImmutableArtifactRef,
  type RunState,
  type StageCheckpoint,
  type StageId,
  type VerificationNodeResult,
} from '@arxic/orchestrator-langgraph';
import {
  PIPELINE_RESULT_PATH,
  PIPELINE_RESULT_VERSION,
  pipelineConfigSha256,
  pipelineSha256,
  serializePipelineResult,
  type PipelineArtifactRef,
  type PipelineResult,
  type PipelineStageCheckpoint,
} from './pipeline-result';
import type { RunSpec } from './run-spec';

export type VolumeFile = Readonly<{ path: string; bytes: Uint8Array }>;

export interface ProjectPipelineResultInput {
  readonly spec: RunSpec;
  readonly state: RunState;
  readonly volumeFiles: readonly VolumeFile[];
  readonly now: () => string;
  readonly appBuildDigest?: string;
  readonly workerImageVersion?: string;
  readonly toolVersion?: string;
  readonly browserVersion?: string;
  readonly orchestratorVersion?: string;
  /** Hash independently computed from source bytes inside the sandbox. */
  readonly sourceSha256: string;
}

export interface ProjectPipelineResultOutput {
  readonly result: PipelineResult;
  readonly manifest: ArtifactTransportManifest;
  readonly pipelineResultBytes: Uint8Array;
}

export function projectPipelineResult(
  input: ProjectPipelineResultInput,
): ProjectPipelineResultOutput {
  const filesByPath = new Map(input.volumeFiles.map((file) => [file.path, file]));
  const filesBySha256 = new Map(input.volumeFiles.map((file) => [fileSha256(file.bytes), file]));
  const artifactRef = (ref: ImmutableArtifactRef): PipelineArtifactRef => {
    const path = artifactPath(input.spec.runId, ref.id);
    const file = filesByPath.get(path);
    if (!file) throw new Error(`Referenced stage artifact is missing: ${path}`);
    const sha256 = fileSha256(file.bytes);
    if (sha256 !== ref.sha256) {
      throw new Error(`Referenced stage artifact hash disagrees with checkpoint: ${path}`);
    }
    if (!filesBySha256.has(ref.sha256)) {
      throw new Error(`Referenced stage artifact hash does not resolve: ${path}`);
    }
    return { id: ref.id, path, sha256, bytes: file.bytes.length };
  };
  const checkpoints = input.state.checkpoints.map((checkpoint) =>
    projectCheckpoint(checkpoint, artifactRef),
  );
  const stageTen = input.state.checkpoints.find(({ stage }) => stage === 10);
  const stageTenResult = parseStageTen(
    filesByPath.get(`checkpoints/${input.spec.runId}/artifacts/10.json`),
  );
  const stagedBundle = stageTenResult?.stagedBundle;
  const configSha256 = pipelineConfigSha256(input.spec.config);
  const sourceSha256 = input.sourceSha256;
  const orchestratorVersion = input.orchestratorVersion ?? ORCHESTRATOR_VERSION;
  const appBuildDigest =
    input.appBuildDigest ??
    (/^[0-9a-f]{40}$/iu.test(input.spec.config.source.revision)
      ? input.spec.config.source.revision
      : 'unknown');
  const producedAt = input.now();
  const binding = {
    runId: input.spec.runId,
    configSha256,
    sourceSha256,
    sourceRevision: input.spec.config.source.revision,
    appBuildDigest,
    workerImageVersion: input.workerImageVersion ?? 'unknown',
    toolVersion: input.toolVersion ?? 'unknown',
    browserVersion: input.browserVersion ?? 'unknown',
    orchestratorVersion,
  };
  const candidate = {
    ...(stagedBundle ? { stagedBundle } : {}),
    gateResults: uniqueGateResults(checkpoints),
  };
  const result: PipelineResult = {
    protocolVersion: PIPELINE_RESULT_VERSION,
    binding,
    freshness: {
      producedAt,
      expiresAt: new Date(new Date(producedAt).getTime() + 5 * 60_000).toISOString(),
    },
    state: {
      runId: input.state.runId,
      status: input.state.status,
      outcome: input.state.outcome,
      ...(input.state.activeStage === undefined ? {} : { activeStage: input.state.activeStage }),
      completedStages: input.state.completedStages,
      artifacts: Object.entries(input.state.artifacts).map(([stage, ref]) => ({
        stage: Number(stage) as StageId,
        ref: artifactRef(ref),
      })),
      checkpoints,
      diagnostics: input.state.diagnostics,
      promotionEligible: input.state.promotionEligible,
    },
    candidate,
    verifier: {
      version: 1,
      runId: input.spec.runId,
      verifierVersion: stageTen?.toolVersions['@arxic/verifier'] ?? 'unknown',
      orchestratorVersion,
      configSha256,
      sourceSha256,
      appBuildDigest,
      requiredReplayCount: input.spec.config.policy.requiredVerificationRuns,
      cleanReplayCount: stageTenResult?.runs.filter(({ passed }) => passed).length ?? 0,
      outcome: input.state.outcome,
      artifactHashes: [...new Set(stageTen?.artifacts.map(({ sha256 }) => sha256) ?? [])].sort(),
      stagedBundleSha256: pipelineSha256(stagedBundle ?? null),
    },
  };
  const pipelineResultBytes = serializePipelineResult(result);
  const manifestFiles = [
    ...input.volumeFiles.filter(
      ({ path }) => path !== 'result-manifest.json' && path !== PIPELINE_RESULT_PATH,
    ),
    { path: PIPELINE_RESULT_PATH, bytes: pipelineResultBytes },
  ]
    .map(({ path, bytes }) => ({ path, sha256: fileSha256(bytes), bytes: bytes.length }))
    .sort((left, right) => left.path.localeCompare(right.path));
  return {
    result,
    pipelineResultBytes,
    manifest: { runId: input.spec.runId, resultReady: true, files: manifestFiles },
  };
}

function projectCheckpoint(
  checkpoint: StageCheckpoint,
  artifactRef: (ref: ImmutableArtifactRef) => PipelineArtifactRef,
): PipelineStageCheckpoint {
  return {
    stage: checkpoint.stage,
    name: checkpoint.name,
    status: checkpoint.status,
    startedAt: checkpoint.startedAt,
    finishedAt: checkpoint.finishedAt,
    adapter: checkpoint.adapter,
    orchestratorVersion: checkpoint.orchestratorVersion,
    artifacts: checkpoint.artifacts.map(artifactRef),
    toolVersions: checkpoint.toolVersions,
    ...(checkpoint.modelRequestId === undefined
      ? {}
      : { modelRequestId: checkpoint.modelRequestId }),
    decisions: checkpoint.decisions,
    approvals: checkpoint.approvals,
    gateResults: checkpoint.gateResults,
    redaction: checkpoint.redaction,
  };
}

function artifactPath(runId: string, id: string): string {
  const match = /^stage:(\d|1[0-2])$/u.exec(id);
  if (!match) throw new Error(`Unsupported stage artifact id: ${id}`);
  return `checkpoints/${runId}/artifacts/${String(Number(match[1])).padStart(2, '0')}.json`;
}

function parseStageTen(file: VolumeFile | undefined): VerificationNodeResult | undefined {
  if (!file) return undefined;
  try {
    return JSON.parse(Buffer.from(file.bytes).toString('utf8')) as VerificationNodeResult;
  } catch {
    throw new Error(`Stage-10 artifact is not valid JSON: ${file.path}`);
  }
}

function uniqueGateResults(checkpoints: readonly PipelineStageCheckpoint[]) {
  const seen = new Set<string>();
  return checkpoints.flatMap(({ gateResults }) =>
    gateResults.filter((gate) => {
      const key = pipelineSha256(gate);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
  );
}

function fileSha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
