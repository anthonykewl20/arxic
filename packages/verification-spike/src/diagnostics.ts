import type { Diagnostic, TruthState } from '@arxic/contracts';
import { validateDiagnostic } from '@arxic/contracts';

export const ARXIC_DG03_OBSERVATION_STEP_FAILED = 'ARXIC-DG03-OBSERVATION-STEP-FAILED' as const;
export const ARXIC_DG03_OBSERVATION_DRIFTED = 'ARXIC-DG03-OBSERVATION-DRIFTED' as const;
export const ARXIC_DG03_OBSERVATION_UNSTABLE = 'ARXIC-DG03-OBSERVATION-UNSTABLE' as const;
export const ARXIC_DG03_DERIVATION_EMPTY = 'ARXIC-DG03-DERIVATION-EMPTY' as const;
export const ARXIC_DG03_ATTESTATION_REFUSED = 'ARXIC-DG03-ATTESTATION-REFUSED' as const;
export const ARXIC_DG03_ATTESTATION_UNAVAILABLE = 'ARXIC-DG03-ATTESTATION-UNAVAILABLE' as const;
export const ARXIC_DG03_POLICY_DENIED = 'ARXIC-DG03-POLICY-DENIED' as const;
export const ARXIC_DG03_ORIGIN_DRIFT = 'ARXIC-DG03-ORIGIN-DRIFT' as const;
export const ARXIC_DG03_REDACTION_FAILED = 'ARXIC-DG03-REDACTION-FAILED' as const;
export const ARXIC_DG03_ARTIFACT_HASH_MISMATCH = 'ARXIC-DG03-ARTIFACT-HASH-MISMATCH' as const;
export const ARXIC_DG03_REPLAY_LEASE_REQUIRED = 'ARXIC-DG03-REPLAY-LEASE-REQUIRED' as const;
export const ARXIC_DG03_REDACTION_MASKED = 'ARXIC-DG03-REDACTION-MASKED' as const;

export const DG03_DIAGNOSTIC_CODES = Object.freeze([
  ARXIC_DG03_OBSERVATION_STEP_FAILED,
  ARXIC_DG03_OBSERVATION_DRIFTED,
  ARXIC_DG03_OBSERVATION_UNSTABLE,
  ARXIC_DG03_DERIVATION_EMPTY,
  ARXIC_DG03_ATTESTATION_REFUSED,
  ARXIC_DG03_ATTESTATION_UNAVAILABLE,
  ARXIC_DG03_POLICY_DENIED,
  ARXIC_DG03_ORIGIN_DRIFT,
  ARXIC_DG03_REDACTION_FAILED,
  ARXIC_DG03_ARTIFACT_HASH_MISMATCH,
  ARXIC_DG03_REPLAY_LEASE_REQUIRED,
  ARXIC_DG03_REDACTION_MASKED,
] as const);

export type Dg03DiagnosticCode = (typeof DG03_DIAGNOSTIC_CODES)[number];

export function dg03Diagnostic(
  code: Dg03DiagnosticCode,
  severity: Exclude<TruthState, 'verified'>,
  subject: string,
  message: string,
): Diagnostic {
  const diagnostic: Diagnostic = { code, severity, subject, message };
  if (!validateDiagnostic(diagnostic).ok)
    throw new Error(`DG-03 spike made an invalid Diagnostic for ${code}`);
  return diagnostic;
}
