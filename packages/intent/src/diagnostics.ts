import { validateDiagnostic, type Diagnostic } from '@arxic/contracts';

export const ARXIC_INTENT_INVALID = 'ARXIC-INTENT-INVALID' as const;
export const ARXIC_INTENT_ORACLE_MISSING = 'ARXIC-INTENT-ORACLE-MISSING' as const;
export const ARXIC_INTENT_ORACLE_CONFLICT = 'ARXIC-INTENT-ORACLE-CONFLICT' as const;
export const ARXIC_INTENT_ORACLE_STALE = 'ARXIC-INTENT-ORACLE-STALE' as const;
export const ARXIC_INTENT_SOURCE_AS_ACCEPTANCE = 'ARXIC-INTENT-SOURCE-AS-ACCEPTANCE' as const;
export const ARXIC_INTENT_CANONICAL_MISMATCH = 'ARXIC-INTENT-CANONICAL-MISMATCH' as const;

export type IntentDiagnosticCode =
  | typeof ARXIC_INTENT_INVALID
  | typeof ARXIC_INTENT_ORACLE_MISSING
  | typeof ARXIC_INTENT_ORACLE_CONFLICT
  | typeof ARXIC_INTENT_ORACLE_STALE
  | typeof ARXIC_INTENT_SOURCE_AS_ACCEPTANCE
  | typeof ARXIC_INTENT_CANONICAL_MISMATCH;

export function intentDiagnostic(
  code: IntentDiagnosticCode,
  severity: Diagnostic['severity'],
  subject: string,
  message: string,
  evidenceRefs: readonly string[] = [],
): Diagnostic {
  const diagnostic: Diagnostic = {
    code,
    severity,
    subject,
    message,
    ...(evidenceRefs.length > 0 ? { evidenceRefs: [...evidenceRefs] } : {}),
  };
  if (!validateDiagnostic(diagnostic).ok) throw new Error('intent made an invalid Diagnostic');
  return diagnostic;
}
