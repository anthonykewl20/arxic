import { createHash } from 'node:crypto';
import {
  validateDiagnostic,
  validateEvidenceIndex,
  validateManifest,
  validateWorkflow,
  type StagedBundle,
} from '@arxic/contracts';
import type { RunState } from '@arxic/orchestrator-langgraph';
import {
  PIPELINE_RESULT_PATH,
  PIPELINE_RESULT_VERSION,
  canonicalPipelineJson,
  pipelineConfigSha256,
  pipelineSha256,
  pipelineSourceSha256,
  type ImportedArtifacts,
  type PipelineArtifactRef,
  type PipelineResult,
} from '@arxic/worker';
import type { RunRequest } from './executor';

const MAX_ENVELOPE_BYTES = 2 * 1024 * 1024;
const MAX_DEPTH = 32;
const MAX_COUNT = 4096;
const MAX_CLOCK_SKEW_MS = 30_000;

export type WorkerResultFailure = Readonly<{
  ok: false;
  kind: 'protocol' | 'verifier';
  reason: string;
}>;
export type NormalizedWorkerResult = Readonly<{
  ok: true;
  state: RunState;
  stagedBundle?: StagedBundle;
  gateResults: PipelineResult['candidate']['gateResults'];
}>;

/** Validate hostile worker bytes and project them into the orchestrator-owned RunState. */
export function normalizeWorkerResult(
  request: RunRequest,
  imported: ImportedArtifacts,
): WorkerResultFailure | NormalizedWorkerResult {
  try {
    return normalizeWorkerResultUnsafe(request, imported);
  } catch {
    return protocol('Pipeline result envelope contains malformed nested fields');
  }
}

function normalizeWorkerResultUnsafe(
  request: RunRequest,
  imported: ImportedArtifacts,
): WorkerResultFailure | NormalizedWorkerResult {
  for (const declaration of imported.manifest.files) {
    const file = imported.files.find(({ path }) => path === declaration.path);
    if (
      !file ||
      file.bytes.length !== declaration.bytes ||
      sha256(file.bytes) !== declaration.sha256 ||
      file.sha256 !== declaration.sha256
    ) {
      return protocol('Imported artifact does not match its transport declaration');
    }
  }
  const envelopeFile = imported.files.find(({ path }) => path === PIPELINE_RESULT_PATH);
  if (!envelopeFile || envelopeFile.bytes.length > MAX_ENVELOPE_BYTES) {
    return protocol('Pipeline result envelope is missing or exceeds its byte limit');
  }
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(envelopeFile.bytes));
  } catch {
    return protocol('Pipeline result envelope is not valid UTF-8 JSON');
  }
  if (!withinBounds(value)) return protocol('Pipeline result envelope exceeds structural limits');
  if (!isPipelineResult(value))
    return protocol('Pipeline result envelope shape or version is invalid');
  const result = value;

  if (
    result.binding.runId !== request.runId ||
    result.state.runId !== request.runId ||
    result.binding.configSha256 !== pipelineConfigSha256(request.config) ||
    result.binding.sourceSha256 !== pipelineSourceSha256(request.config) ||
    result.binding.sourceRevision !== request.config.source.revision
  ) {
    return protocol('Pipeline result binding does not match this run');
  }
  const now = new Date((request.now ?? (() => new Date().toISOString()))()).getTime();
  const produced = Date.parse(result.freshness.producedAt);
  const expires = Date.parse(result.freshness.expiresAt);
  if (
    !Number.isFinite(now) ||
    !Number.isFinite(produced) ||
    !Number.isFinite(expires) ||
    produced > now + MAX_CLOCK_SKEW_MS ||
    expires <= produced ||
    now > expires
  ) {
    return protocol('Pipeline result is stale or has invalid freshness timestamps');
  }
  if (result.receipt !== undefined) {
    return protocol('Worker supplied an authoritative promotion receipt');
  }
  if (!monotonicCompletePrefix(result)) {
    return protocol('Pipeline checkpoints are not a complete monotonic prefix');
  }
  if (
    result.state.diagnostics.some((diagnostic) => !validateDiagnostic(diagnostic).ok) ||
    result.state.checkpoints.some((checkpoint) =>
      checkpoint.gateResults.some((gate) =>
        gate.diagnostics?.some((diagnostic) => !validateDiagnostic(diagnostic).ok),
      ),
    )
  ) {
    return protocol('Pipeline result contains an invalid diagnostic');
  }

  const importedByPath = new Map(imported.files.map((file) => [file.path, file] as const));
  const refs = allRefs(result);
  for (const ref of refs) {
    const file = importedByPath.get(ref.path);
    if (!file || file.bytes.length !== ref.bytes || sha256(file.bytes) !== ref.sha256) {
      return protocol('Pipeline artifact hash or byte count is inconsistent');
    }
    const declaration = imported.manifest.files.find(({ path }) => path === ref.path);
    if (!declaration || declaration.sha256 !== ref.sha256 || declaration.bytes !== ref.bytes) {
      return protocol('Pipeline artifact reference disagrees with the transport manifest');
    }
  }
  const verifierFailure = validateVerifier(result, request, refs);
  if (verifierFailure) return verifierFailure;
  if (result.candidate.stagedBundle && !validStagedBundle(result.candidate.stagedBundle)) {
    return protocol('Pipeline result contains an invalid staged bundle candidate');
  }
  if (
    result.candidate.stagedBundle?.artifacts.some((artifact) => {
      const file = importedByPath.get(artifact.path);
      return !file || sha256(file.bytes) !== artifact.sha256;
    })
  ) {
    return protocol(
      'Staged bundle artifact is absent from imported bytes or has a mismatched hash',
    );
  }

  const artifacts = Object.fromEntries(
    result.state.artifacts.map(({ stage, ref }) => [stage, { id: ref.id, sha256: ref.sha256 }]),
  );
  const checkpoints = result.state.checkpoints.map((checkpoint) => ({
    ...checkpoint,
    artifacts: checkpoint.artifacts.map(({ id, sha256: digest }) => ({ id, sha256: digest })),
  }));
  const state: RunState = {
    runId: result.state.runId,
    status: result.state.status,
    outcome: result.state.outcome,
    ...(result.state.activeStage === undefined ? {} : { activeStage: result.state.activeStage }),
    completedStages: result.state.completedStages,
    artifacts,
    checkpoints,
    diagnostics: result.state.diagnostics,
    // This is candidate eligibility only; authoritative promotion is CLI-side.
    promotionEligible: result.state.promotionEligible,
  };
  return {
    ok: true,
    state,
    gateResults: result.candidate.gateResults,
    ...(result.candidate.stagedBundle ? { stagedBundle: result.candidate.stagedBundle } : {}),
  };
}

function validateVerifier(
  result: PipelineResult,
  request: RunRequest,
  refs: readonly PipelineArtifactRef[],
): WorkerResultFailure | undefined {
  const record = result.verifier;
  if (!record) return verifier('Stage-10 verifier record is missing');
  const stage10 = result.state.checkpoints.find(({ stage }) => stage === 10);
  const bundle = result.candidate.stagedBundle;
  const expectedHashes = [
    ...new Set(stage10?.artifacts.map(({ sha256: digest }) => digest) ?? []),
  ].sort();
  if (
    record.version !== 1 ||
    record.runId !== request.runId ||
    record.configSha256 !== result.binding.configSha256 ||
    record.sourceSha256 !== result.binding.sourceSha256 ||
    record.appBuildDigest !== result.binding.appBuildDigest ||
    record.orchestratorVersion !== result.binding.orchestratorVersion ||
    record.outcome !== result.state.outcome ||
    !stage10 ||
    stage10.orchestratorVersion !== record.orchestratorVersion ||
    !stage10.adapter.name.includes('verifier') ||
    stage10.toolVersions['@arxic/verifier'] !== record.verifierVersion ||
    record.requiredReplayCount !== request.config.policy.requiredVerificationRuns ||
    !Number.isSafeInteger(record.cleanReplayCount) ||
    record.cleanReplayCount < 0 ||
    canonicalPipelineJson([...record.artifactHashes].sort()) !==
      canonicalPipelineJson(expectedHashes) ||
    record.artifactHashes.some((digest) => !refs.some((ref) => ref.sha256 === digest)) ||
    record.stagedBundleSha256 !== (bundle ? pipelineSha256(bundle) : pipelineSha256(null))
  ) {
    return verifier('Stage-10 verifier record is stale or inconsistent');
  }
  if (
    result.state.outcome === 'verified' &&
    (record.cleanReplayCount < record.requiredReplayCount ||
      !bundle ||
      !result.state.promotionEligible ||
      result.candidate.gateResults.some(({ passed }) => !passed))
  ) {
    return verifier('Worker verified claim is inconsistent with deterministic verifier evidence');
  }
  return undefined;
}

function monotonicCompletePrefix(result: PipelineResult): boolean {
  const stages = result.state.checkpoints.map(({ stage }) => stage);
  if (stages.some((stage, index) => stage !== index)) return false;
  if (new Set(result.state.completedStages).size !== result.state.completedStages.length)
    return false;
  return result.state.completedStages.every(
    (stage, index) => stage === index && stages.includes(stage),
  );
}

function allRefs(result: PipelineResult): readonly PipelineArtifactRef[] {
  const refs = [
    ...result.state.artifacts.map(({ ref }) => ref),
    ...result.state.checkpoints.flatMap(({ artifacts }) => artifacts),
  ];
  return [...new Map(refs.map((ref) => [`${ref.path}:${ref.sha256}`, ref] as const)).values()];
}

function validStagedBundle(bundle: StagedBundle): boolean {
  return (
    validateManifest(bundle.manifest).ok &&
    validateWorkflow(bundle.workflow).ok &&
    validateEvidenceIndex(bundle.evidenceIndex).ok &&
    bundle.artifacts.every(
      ({ path, sha256: digest }) =>
        typeof path === 'string' && path.length > 0 && /^[a-f0-9]{64}$/.test(digest),
    )
  );
}

function isPipelineResult(value: unknown): value is PipelineResult {
  if (!isRecord(value) || value.protocolVersion !== PIPELINE_RESULT_VERSION) return false;
  if (
    !exactKeys(value, [
      'protocolVersion',
      'binding',
      'freshness',
      'state',
      'candidate',
      'verifier',
      'receipt',
    ])
  )
    return false;
  const { binding, freshness, state, candidate } = value;
  if (!isRecord(binding) || !isRecord(freshness) || !isRecord(state) || !isRecord(candidate))
    return false;
  const statuses = ['queued', 'running', 'awaiting-approval', 'completed', 'partial', 'failed'];
  const outcomes = ['hypothesized', 'observed', 'verified', 'contradicted', 'blocked'];
  return (
    exactKeys(binding, [
      'runId',
      'configSha256',
      'sourceSha256',
      'sourceRevision',
      'appBuildDigest',
      'workerImageVersion',
      'toolVersion',
      'browserVersion',
      'orchestratorVersion',
    ]) &&
    Object.values(binding).every(
      (item) => typeof item === 'string' && item.length > 0 && item.length <= 1024,
    ) &&
    typeof freshness.producedAt === 'string' &&
    typeof freshness.expiresAt === 'string' &&
    typeof state.runId === 'string' &&
    typeof state.status === 'string' &&
    statuses.includes(state.status) &&
    typeof state.outcome === 'string' &&
    outcomes.includes(state.outcome) &&
    Array.isArray(state.completedStages) &&
    state.completedStages.every(isStage) &&
    Array.isArray(state.artifacts) &&
    state.artifacts.every(isStageArtifact) &&
    Array.isArray(state.checkpoints) &&
    state.checkpoints.every(isCheckpoint) &&
    Array.isArray(state.diagnostics) &&
    typeof state.promotionEligible === 'boolean' &&
    Array.isArray(candidate.gateResults) &&
    candidate.gateResults.every(isGate) &&
    (value.verifier === undefined || isVerifier(value.verifier))
  );
}

function isStage(value: unknown): value is PipelineResult['state']['completedStages'][number] {
  return Number.isSafeInteger(value) && typeof value === 'number' && value >= 0 && value <= 12;
}

function isArtifactRef(value: unknown): value is PipelineArtifactRef {
  return (
    isRecord(value) &&
    exactKeys(value, ['id', 'path', 'sha256', 'bytes']) &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    typeof value.path === 'string' &&
    value.path.length > 0 &&
    typeof value.sha256 === 'string' &&
    /^[a-f0-9]{64}$/.test(value.sha256) &&
    Number.isSafeInteger(value.bytes) &&
    typeof value.bytes === 'number' &&
    value.bytes >= 0
  );
}

function isStageArtifact(value: unknown): boolean {
  return (
    isRecord(value) &&
    exactKeys(value, ['stage', 'ref']) &&
    isStage(value.stage) &&
    isArtifactRef(value.ref)
  );
}

function isCheckpoint(value: unknown): boolean {
  return (
    isRecord(value) &&
    isStage(value.stage) &&
    typeof value.name === 'string' &&
    ['completed', 'awaiting-approval', 'skipped', 'deferred', 'failed'].includes(
      String(value.status),
    ) &&
    typeof value.startedAt === 'string' &&
    typeof value.finishedAt === 'string' &&
    isRecord(value.adapter) &&
    typeof value.adapter.name === 'string' &&
    typeof value.adapter.version === 'string' &&
    typeof value.orchestratorVersion === 'string' &&
    Array.isArray(value.artifacts) &&
    value.artifacts.every(isArtifactRef) &&
    isRecord(value.toolVersions) &&
    Object.values(value.toolVersions).every((item) => typeof item === 'string') &&
    Array.isArray(value.decisions) &&
    value.decisions.every((item) => typeof item === 'string') &&
    Array.isArray(value.approvals) &&
    value.approvals.every((item) => typeof item === 'string') &&
    Array.isArray(value.gateResults) &&
    value.gateResults.every(isGate) &&
    isRecord(value.redaction) &&
    typeof value.redaction.passed === 'boolean' &&
    Array.isArray(value.redaction.redactedFields) &&
    value.redaction.redactedFields.every((item) => typeof item === 'string')
  );
}

function isGate(value: unknown): boolean {
  return isRecord(value) && typeof value.gate === 'string' && typeof value.passed === 'boolean';
}

function isVerifier(value: unknown): boolean {
  return (
    isRecord(value) &&
    value.version === 1 &&
    typeof value.runId === 'string' &&
    typeof value.verifierVersion === 'string' &&
    value.verifierVersion.length > 0 &&
    typeof value.orchestratorVersion === 'string' &&
    typeof value.configSha256 === 'string' &&
    /^[a-f0-9]{64}$/.test(value.configSha256) &&
    typeof value.sourceSha256 === 'string' &&
    /^[a-f0-9]{64}$/.test(value.sourceSha256) &&
    typeof value.appBuildDigest === 'string' &&
    Number.isSafeInteger(value.requiredReplayCount) &&
    Number.isSafeInteger(value.cleanReplayCount) &&
    typeof value.outcome === 'string' &&
    Array.isArray(value.artifactHashes) &&
    value.artifactHashes.every((item) => typeof item === 'string' && /^[a-f0-9]{64}$/.test(item)) &&
    typeof value.stagedBundleSha256 === 'string' &&
    /^[a-f0-9]{64}$/.test(value.stagedBundleSha256)
  );
}

function withinBounds(value: unknown, depth = 0, count = { value: 0 }): boolean {
  if (depth > MAX_DEPTH || ++count.value > MAX_COUNT) return false;
  if (typeof value === 'string') return value.length <= 16_384;
  if (Array.isArray(value))
    return value.length <= MAX_COUNT && value.every((item) => withinBounds(item, depth + 1, count));
  if (isRecord(value))
    return Object.entries(value).every(
      ([key, item]) => key.length <= 256 && withinBounds(item, depth + 1, count),
    );
  return value === null || ['boolean', 'number'].includes(typeof value);
}

function exactKeys(record: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(record).every((key) => allowed.includes(key));
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function protocol(reason: string): WorkerResultFailure {
  return { ok: false, kind: 'protocol', reason };
}

function verifier(reason: string): WorkerResultFailure {
  return { ok: false, kind: 'verifier', reason };
}
