import type {
  ArtifactRef,
  Diagnostic,
  GateResult,
  StagedBundle,
  TruthState,
} from '@arxic/contracts';
import { validateManifest, validateWorkflow } from '@arxic/contracts';
import { validateStagedBundle } from './validator';

export type VerifiedBundleProjectionResult =
  | { ok: true; value: StagedBundle }
  | {
      ok: false;
      reason:
        | 'verification-outcome-not-verified'
        | 'verification-evidence-incomplete'
        | 'artifact-reference-conflict'
        | 'projected-bundle-invalid';
    };

export type VerifiedProjectionEvidence = Readonly<{
  outcome: TruthState;
  diagnostics?: readonly Diagnostic[];
  gates: readonly GateResult[];
  artifacts: readonly ArtifactRef[];
  runs: readonly Readonly<{ passed: boolean }>[];
}>;

/**
 * Mechanically projects an action's deterministic verifier result into immutable
 * staged bytes. The caller remains responsible for deciding when verification is
 * authoritative and for classifying a rejected projection.
 */
export function projectVerifiedBundle(
  bundle: StagedBundle,
  verification: VerifiedProjectionEvidence,
  verifiedAt: string,
): VerifiedBundleProjectionResult {
  if (verification.outcome !== 'verified') {
    return { ok: false, reason: 'verification-outcome-not-verified' };
  }
  if (!validateStagedBundle(bundle).ok) {
    return { ok: false, reason: 'projected-bundle-invalid' };
  }
  const requiredRuns = bundle.workflow.verification.requiredRuns;
  const verifyGates = Array.isArray(verification.gates)
    ? verification.gates.filter(({ gate }) => gate === 'verify')
    : [];
  if (
    verification.runs.length !== requiredRuns ||
    verification.runs.some(({ passed }) => !passed) ||
    verifyGates.length !== 1 ||
    verifyGates[0]?.passed !== true ||
    verification.gates.some(({ passed }) => !passed) ||
    !isCanonicalTimestamp(verifiedAt)
  ) {
    return { ok: false, reason: 'verification-evidence-incomplete' };
  }
  const artifacts = mergeArtifacts(bundle.artifacts, verification.artifacts);
  if (!artifacts) return { ok: false, reason: 'artifact-reference-conflict' };

  const projected = structuredClone(bundle);
  projected.workflow.status = 'verified';
  projected.manifest.workflow = { id: projected.workflow.id, status: 'verified' };
  projected.manifest.verification = {
    requiredRuns,
    runs: verification.runs.map(({ passed }) => ({
      startedAt: verifiedAt,
      finishedAt: verifiedAt,
      passed,
    })),
  };
  projected.manifest.gateResults = [
    ...projected.manifest.gateResults.filter(({ gate }) => gate !== 'verify'),
    { gate: 'verify', passed: true },
  ];
  projected.artifacts = artifacts;
  projected.manifest.fileHashes = artifacts.map(({ path, sha256 }) => ({ path, sha256 }));
  projected.manifest.coverage = {
    denominator: projected.manifest.coverage.denominator,
    verified: projected.manifest.coverage.denominator,
    contradicted: 0,
    blocked: 0,
    uncovered: 0,
  };

  if (
    !validateWorkflow(projected.workflow).ok ||
    !validateManifest(projected.manifest).ok ||
    !validateStagedBundle(projected).ok
  ) {
    return { ok: false, reason: 'projected-bundle-invalid' };
  }
  return { ok: true, value: projected };
}

function mergeArtifacts(
  staged: readonly ArtifactRef[],
  verified: readonly ArtifactRef[],
): ArtifactRef[] | undefined {
  const byPath = new Map<string, ArtifactRef>();
  for (const artifact of [...staged, ...verified]) {
    const existing = byPath.get(artifact.path);
    if (existing && (existing.sha256 !== artifact.sha256 || existing.kind !== artifact.kind)) {
      return undefined;
    }
    byPath.set(artifact.path, structuredClone(artifact));
  }
  return [...byPath.values()];
}

function isCanonicalTimestamp(value: string): boolean {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}
