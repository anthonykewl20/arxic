import type { Diagnostic } from '@arxic/contracts';
import { validateDiagnostic } from '@arxic/contracts';

export const ARXIC_MODEL_STRUCTURED_OUTPUT_INVALID =
  'ARXIC-MODEL-STRUCTURED-OUTPUT-INVALID' as const;
export const ARXIC_MODEL_SCHEMA_VERSION_DRIFT = 'ARXIC-MODEL-SCHEMA-VERSION-DRIFT' as const;
export const ARXIC_MODEL_RETRIES_EXHAUSTED = 'ARXIC-MODEL-RETRIES-EXHAUSTED' as const;
export const ARXIC_MODEL_CREDENTIAL_LEAK_DETECTED = 'ARXIC-MODEL-CREDENTIAL-LEAK-DETECTED' as const;
export const ARXIC_MODEL_PROVIDER_ERROR = 'ARXIC-MODEL-PROVIDER-ERROR' as const;
export const ARXIC_MODEL_PROVIDER_TIMEOUT = 'ARXIC-MODEL-PROVIDER-TIMEOUT' as const;

export const MODEL_DIAGNOSTIC_CODES = [
  ARXIC_MODEL_STRUCTURED_OUTPUT_INVALID,
  ARXIC_MODEL_SCHEMA_VERSION_DRIFT,
  ARXIC_MODEL_RETRIES_EXHAUSTED,
  ARXIC_MODEL_CREDENTIAL_LEAK_DETECTED,
  ARXIC_MODEL_PROVIDER_ERROR,
  ARXIC_MODEL_PROVIDER_TIMEOUT,
] as const;

export type ModelDiagnosticCode = (typeof MODEL_DIAGNOSTIC_CODES)[number];

export function modelDiagnostic(
  code: ModelDiagnosticCode,
  subject: string,
  message: string,
): Diagnostic {
  const diagnostic: Diagnostic = { code, severity: 'blocked', subject, message };
  if (!validateDiagnostic(diagnostic).ok) {
    throw new Error('model adapter manufactured invalid Diagnostic');
  }
  return diagnostic;
}
