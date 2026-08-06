import { validateDiagnostic, type Diagnostic } from '@arxic/contracts';

export const ARXIC_RECON_CONFLICT = 'ARXIC-RECON-CONFLICT' as const;
export const ARXIC_RECON_SOURCE_ONLY = 'ARXIC-RECON-SOURCE-ONLY' as const;
export const ARXIC_RECON_RUNTIME_ONLY = 'ARXIC-RECON-RUNTIME-ONLY' as const;
export const ARXIC_RECON_DENOMINATOR_TAMPERED = 'ARXIC-RECON-DENOMINATOR-TAMPERED' as const;
export const ARXIC_RECON_UNSUPPORTED = 'ARXIC-RECON-UNSUPPORTED' as const;
export const ARXIC_RECON_POST_FREEZE_DISCOVERY = 'ARXIC-RECON-POST-FREEZE-DISCOVERY' as const;

export type ReconDiagnosticCode =
  | typeof ARXIC_RECON_CONFLICT
  | typeof ARXIC_RECON_SOURCE_ONLY
  | typeof ARXIC_RECON_RUNTIME_ONLY
  | typeof ARXIC_RECON_DENOMINATOR_TAMPERED
  | typeof ARXIC_RECON_UNSUPPORTED
  | typeof ARXIC_RECON_POST_FREEZE_DISCOVERY;

export function reconDiagnostic(
  code: ReconDiagnosticCode,
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
  if (!validateDiagnostic(diagnostic).ok) throw new Error('reconciler made an invalid Diagnostic');
  return diagnostic;
}
