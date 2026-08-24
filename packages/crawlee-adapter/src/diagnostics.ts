import type { Diagnostic } from '@arxic/contracts';
import { validateDiagnostic } from '@arxic/contracts';

export const ARXIC_SURFACE_EXTERNAL_ORIGIN = 'ARXIC-SURFACE-001' as const;
export const ARXIC_SURFACE_FORM_SUBMIT_BLOCKED = 'ARXIC-SURFACE-002' as const;
export const ARXIC_SURFACE_FRONTIER_STOP = 'ARXIC-SURFACE-003' as const;
export const ARXIC_SURFACE_PERSONA_SERIALIZED = 'ARXIC-SURFACE-004' as const;
export const ARXIC_SURFACE_NAVIGATION_FAILED = 'ARXIC-SURFACE-005' as const;
export const ARXIC_SURFACE_ORIGIN_INVALID = 'ARXIC-SURFACE-006' as const;
export const ARXIC_SURFACE_BUILD_UNATTESTED = 'ARXIC-SURFACE-007' as const;
export const ARXIC_SURFACE_MUTATION_BLOCKED = 'ARXIC-SURFACE-008' as const;
/** DG-297 E2 (#297): the declared replay-persona login failed before breadth discovery; the crawl proceeded anonymously. */
export const ARXIC_SURFACE_REPLAY_LOGIN_BLOCKED = 'ARXIC-SURFACE-009' as const;

export type SurfaceDiagnosticCode =
  | typeof ARXIC_SURFACE_EXTERNAL_ORIGIN
  | typeof ARXIC_SURFACE_FORM_SUBMIT_BLOCKED
  | typeof ARXIC_SURFACE_FRONTIER_STOP
  | typeof ARXIC_SURFACE_PERSONA_SERIALIZED
  | typeof ARXIC_SURFACE_NAVIGATION_FAILED
  | typeof ARXIC_SURFACE_ORIGIN_INVALID
  | typeof ARXIC_SURFACE_BUILD_UNATTESTED
  | typeof ARXIC_SURFACE_MUTATION_BLOCKED
  | typeof ARXIC_SURFACE_REPLAY_LOGIN_BLOCKED;

export function surfaceDiagnostic(
  code: SurfaceDiagnosticCode,
  severity: Diagnostic['severity'],
  subject: string,
  message: string,
): Diagnostic {
  const diagnostic: Diagnostic = { code, severity, subject, message };
  if (!validateDiagnostic(diagnostic).ok)
    throw new Error('crawlee-adapter made an invalid Diagnostic');
  return diagnostic;
}
