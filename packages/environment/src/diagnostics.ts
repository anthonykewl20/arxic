import { validateDiagnostic, type Diagnostic } from '@arxic/contracts';

export const ARXIC_ATTESTATION_PRODUCTION_LIKING = 'ARXIC-ATTESTATION-PRODUCTION-LIKING' as const;
export const ARXIC_ATTESTATION_ORIGIN_NOT_ALLOWED = 'ARXIC-ATTESTATION-ORIGIN-NOT-ALLOWED' as const;
export const ARXIC_ATTESTATION_ENV_CLASS_DENIED = 'ARXIC-ATTESTATION-ENV-CLASS-DENIED' as const;
export const ARXIC_ATTESTATION_NONCE_MISMATCH = 'ARXIC-ATTESTATION-NONCE-MISMATCH' as const;
export const ARXIC_ATTESTATION_RECEIPT_UNSIGNED = 'ARXIC-ATTESTATION-RECEIPT-UNSIGNED' as const;
export const ARXIC_ATTESTATION_OVERRIDE_MISSING = 'ARXIC-ATTESTATION-OVERRIDE-MISSING' as const;
export const ARXIC_ATTESTATION_FETCH_FAILED = 'ARXIC-ATTESTATION-FETCH-FAILED' as const;
export const ARXIC_ATTESTATION_ARTIFACT_WRITE_FAILED =
  'ARXIC-ATTESTATION-ARTIFACT-WRITE-FAILED' as const;

export const ATTESTATION_DIAGNOSTIC_CODES = [
  ARXIC_ATTESTATION_PRODUCTION_LIKING,
  ARXIC_ATTESTATION_ORIGIN_NOT_ALLOWED,
  ARXIC_ATTESTATION_ENV_CLASS_DENIED,
  ARXIC_ATTESTATION_NONCE_MISMATCH,
  ARXIC_ATTESTATION_RECEIPT_UNSIGNED,
  ARXIC_ATTESTATION_OVERRIDE_MISSING,
  ARXIC_ATTESTATION_FETCH_FAILED,
  ARXIC_ATTESTATION_ARTIFACT_WRITE_FAILED,
] as const;

export type AttestationDiagnosticCode = (typeof ATTESTATION_DIAGNOSTIC_CODES)[number];

export function attestationDiagnostic(
  code: AttestationDiagnosticCode,
  subject: string,
  message: string,
): Diagnostic {
  const diagnostic: Diagnostic = { code, severity: 'blocked', subject, message };
  if (!validateDiagnostic(diagnostic).ok) {
    throw new Error(`Manufactured invalid attestation diagnostic: ${code}`);
  }
  return diagnostic;
}
