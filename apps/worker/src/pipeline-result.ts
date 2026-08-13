import { createHash } from 'node:crypto';
import type {
  Diagnostic,
  GateResult,
  PromotionReceipt,
  StagedBundle,
  TruthState,
} from '@arxic/contracts';
import type { ArxicConfig, RunStatus, StageId } from './run-spec';

/** The one supported worker-result wire version (app-local; not a frozen contract). */
export const PIPELINE_RESULT_VERSION = 1 as const;
export const PIPELINE_RESULT_PATH = 'pipeline-result.json' as const;

export type PipelineArtifactRef = Readonly<{
  id: string;
  /** Path in #156's ArtifactTransportManifest / imported file set. */
  path: string;
  sha256: string;
  bytes: number;
}>;

export type PipelineStageCheckpoint = Readonly<{
  stage: StageId;
  name: string;
  status: 'completed' | 'awaiting-approval' | 'skipped' | 'deferred' | 'failed';
  startedAt: string;
  finishedAt: string;
  adapter: Readonly<{ name: string; version: string }>;
  orchestratorVersion: string;
  artifacts: readonly PipelineArtifactRef[];
  toolVersions: Readonly<Record<string, string>>;
  modelRequestId?: string;
  decisions: readonly string[];
  approvals: readonly string[];
  gateResults: readonly GateResult[];
  redaction: Readonly<{ passed: boolean; redactedFields: readonly string[] }>;
}>;

/** Deterministic stage-10 authority record. Transport integrity alone is not authority. */
export type Stage10VerifierRecord = Readonly<{
  version: 1;
  runId: string;
  verifierVersion: string;
  orchestratorVersion: string;
  configSha256: string;
  sourceSha256: string;
  appBuildDigest: string;
  requiredReplayCount: number;
  cleanReplayCount: number;
  outcome: TruthState;
  artifactHashes: readonly string[];
  stagedBundleSha256: string;
}>;

/**
 * Bounded, seam-owned projection of the worker pipeline result. Bulk bytes are
 * referenced through #156's manifest and never embedded here.
 */
export type PipelineResult = Readonly<{
  protocolVersion: typeof PIPELINE_RESULT_VERSION;
  binding: Readonly<{
    runId: string;
    configSha256: string;
    sourceSha256: string;
    sourceRevision: string;
    appBuildDigest: string;
    workerImageVersion: string;
    toolVersion: string;
    browserVersion: string;
    orchestratorVersion: string;
  }>;
  freshness: Readonly<{ producedAt: string; expiresAt: string }>;
  state: Readonly<{
    runId: string;
    status: RunStatus;
    outcome: TruthState;
    activeStage?: StageId;
    completedStages: readonly StageId[];
    artifacts: readonly Readonly<{ stage: StageId; ref: PipelineArtifactRef }>[];
    checkpoints: readonly PipelineStageCheckpoint[];
    diagnostics: readonly Diagnostic[];
    promotionEligible: boolean;
  }>;
  candidate: Readonly<{
    stagedBundle?: StagedBundle;
    gateResults: readonly GateResult[];
  }>;
  verifier?: Stage10VerifierRecord;
  /** Receipt is absent until the trusted CLI performs the durable promotion. */
  receipt?: PromotionReceipt;
}>;

/** Canonical wire encoding: sorted object keys, preserved array order, one LF. */
export function serializePipelineResult(result: PipelineResult): Uint8Array {
  return Buffer.from(`${canonicalPipelineJson(result)}\n`, 'utf8');
}

export function canonicalPipelineJson(value: unknown): string {
  const encoded = JSON.stringify(sortValue(value));
  if (encoded === undefined) throw new Error('PipelineResult is not JSON serializable');
  return encoded;
}

export function pipelineSha256(value: unknown): string {
  return createHash('sha256').update(canonicalPipelineJson(value)).digest('hex');
}

export function pipelineConfigSha256(config: ArxicConfig): string {
  return pipelineSha256(config);
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, sortValue(item)]),
    );
  }
  return value;
}
