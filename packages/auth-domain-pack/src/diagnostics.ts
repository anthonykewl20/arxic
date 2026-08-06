import { validateDiagnostic, type Diagnostic } from '@arxic/contracts';

export const ARXIC_AUTH_COMPILE_BLOCKED = 'ARXIC-AUTH-COMPILE-BLOCKED' as const;
export const ARXIC_AUTH_NO_EVIDENCE = 'ARXIC-AUTH-NO-EVIDENCE' as const;
export const ARXIC_AUTH_FIXTURE_UNAVAILABLE = 'ARXIC-AUTH-FIXTURE-UNAVAILABLE' as const;

export const ARXIC_AUTH_DIAGNOSTIC_CODES = [
  ARXIC_AUTH_COMPILE_BLOCKED,
  ARXIC_AUTH_NO_EVIDENCE,
  ARXIC_AUTH_FIXTURE_UNAVAILABLE,
] as const;

export type AuthDiagnosticCode = (typeof ARXIC_AUTH_DIAGNOSTIC_CODES)[number];

export function authDiagnostic(
  code: AuthDiagnosticCode,
  subject: string,
  message: string,
  evidenceRefs: readonly string[] = [],
): Diagnostic {
  const diagnostic: Diagnostic = {
    code,
    severity: 'blocked',
    subject,
    message,
    ...(evidenceRefs.length > 0 ? { evidenceRefs: [...evidenceRefs] } : {}),
  };
  if (!validateDiagnostic(diagnostic).ok) {
    throw new Error('auth domain pack manufactured an invalid Diagnostic');
  }
  return diagnostic;
}
