import { createHash } from 'node:crypto';
import type { Diagnostic, GateResult, StagedBundle } from '@arxic/contracts';
import { validateEvidenceIndex, validateManifest, validateWorkflow } from '@arxic/contracts';
import {
  ARXIC_PROMOTION_GATE_FAILED,
  ARXIC_PROMOTION_HASH_MISMATCH,
  ARXIC_PROMOTION_VALIDATION_FAILED,
  promotionDiagnostic,
} from './diagnostics';

export type ValidationResult = { ok: true } | { ok: false; diagnostics: Diagnostic[] };

export function validateGates(gates: GateResult[]): ValidationResult {
  const failed = gates.filter((gate) => !gate.passed);
  if (failed.length === 0) return { ok: true };
  return {
    ok: false,
    diagnostics: failed.map((_gate, index) =>
      promotionDiagnostic(
        ARXIC_PROMOTION_GATE_FAILED,
        `promotion.gate.${index}`,
        'A required promotion gate did not pass',
      ),
    ),
  };
}

export function validateStagedBundle(bundle: StagedBundle): ValidationResult {
  const manifest = validateManifest(bundle.manifest);
  if (!manifest.ok) {
    return invalidBundle(
      'bundle.manifest',
      manifest.diagnostics.map((diagnostic) => diagnostic.message).join('; '),
    );
  }
  const workflow = validateWorkflow(bundle.workflow);
  if (!workflow.ok) return invalidBundle('bundle.workflow', 'Staged workflow is invalid');
  const evidenceIndex = validateEvidenceIndex(bundle.evidenceIndex);
  if (!evidenceIndex.ok) {
    return invalidBundle('bundle.evidence', 'Staged evidence index is invalid');
  }
  if (
    bundle.manifest.workflow.id !== bundle.workflow.id ||
    bundle.manifest.workflow.status !== bundle.workflow.status
  ) {
    return invalidBundle(
      'bundle.workflow',
      'Staged workflow identity or status does not match its manifest',
    );
  }
  if (!artifactHashesAgree(bundle)) {
    return invalidBundle(
      'bundle.artifacts',
      'Staged artifact references do not match manifest file hashes',
    );
  }
  if (!workflowEvidenceResolves(bundle)) {
    return invalidBundle(
      'bundle.evidence',
      'Staged workflow evidence references do not resolve to the declared evidence kind',
    );
  }
  if (bundle.workflow.status === 'verified' && !hasDeterministicVerificationEvidence(bundle)) {
    return invalidBundle(
      'bundle.verification',
      'Verified staged workflow lacks complete deterministic verifier evidence',
    );
  }
  return { ok: true };
}

function invalidBundle(subject: string, message: string): ValidationResult {
  return {
    ok: false,
    diagnostics: [promotionDiagnostic(ARXIC_PROMOTION_VALIDATION_FAILED, subject, message)],
  };
}

function artifactHashesAgree(bundle: StagedBundle): boolean {
  const artifacts = new Map<string, string>();
  for (const artifact of bundle.artifacts) {
    if (artifacts.has(artifact.path)) return false;
    artifacts.set(artifact.path, artifact.sha256);
  }
  const hashes = new Map<string, string>();
  for (const file of bundle.manifest.fileHashes) {
    if (hashes.has(file.path)) return false;
    hashes.set(file.path, file.sha256);
  }
  if (artifacts.size !== hashes.size) return false;
  return [...artifacts].every(([path, digest]) => hashes.get(path) === digest);
}

function hasDeterministicVerificationEvidence(bundle: StagedBundle): boolean {
  const { requiredRuns, runs } = bundle.manifest.verification;
  const verifyGates = bundle.manifest.gateResults.filter(({ gate }) => gate === 'verify');
  return (
    requiredRuns === bundle.workflow.verification.requiredRuns &&
    runs.length === requiredRuns &&
    runs.every(({ passed }) => passed) &&
    verifyGates.length === 1 &&
    verifyGates[0]?.passed === true &&
    bundle.manifest.gateResults.every(({ passed }) => passed) &&
    (bundle.manifest.blockers?.length ?? 0) === 0 &&
    bundle.manifest.coverage.verified === bundle.manifest.coverage.denominator &&
    (bundle.manifest.coverage.contradicted ?? 0) === 0 &&
    (bundle.manifest.coverage.blocked ?? 0) === 0 &&
    (bundle.manifest.coverage.uncovered ?? 0) === 0
  );
}

function workflowEvidenceResolves(bundle: StagedBundle): boolean {
  const referenced = new Set([
    ...bundle.workflow.evidenceRefs,
    ...bundle.workflow.transitions.flatMap(({ evidenceRefs }) => evidenceRefs),
  ]);
  for (const evidenceId of referenced) {
    const evidence = bundle.evidenceIndex[evidenceId];
    let prefix = 'doc';
    if (evidence?.kind === 'source') prefix = 'src';
    if (evidence?.kind === 'runtime') prefix = 'run';
    if (!evidence || !evidenceId.startsWith(`${prefix}:`)) {
      return false;
    }
  }
  if (bundle.workflow.status !== 'verified') return true;
  return bundle.workflow.transitions
    .filter(({ required }) => required !== false)
    .every(({ evidenceRefs }) =>
      evidenceRefs.some((evidenceId) => bundle.evidenceIndex[evidenceId]?.kind === 'runtime'),
    );
}

export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function validateStagedBytes(bytes: Uint8Array, expectedSha256: string): ValidationResult {
  const actual = sha256(bytes);
  if (actual === expectedSha256) return { ok: true };
  return {
    ok: false,
    diagnostics: [
      promotionDiagnostic(
        ARXIC_PROMOTION_HASH_MISMATCH,
        'bundle.staged-bytes',
        `Staged SHA-256 ${actual} does not match frozen SHA-256 ${expectedSha256}`,
      ),
    ],
  };
}
