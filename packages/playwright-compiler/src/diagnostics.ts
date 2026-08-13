import type { Diagnostic } from '@arxic/contracts';
import { validateDiagnostic } from '@arxic/contracts';

export const ARXIC_COMPILE_WORKFLOW_INVALID = 'ARXIC-COMPILE-WORKFLOW-INVALID' as const;
export const ARXIC_COMPILE_FORBIDDEN_API = 'ARXIC-COMPILE-FORBIDDEN-API' as const;
export const ARXIC_COMPILE_LOCATOR_NONSEMANTIC = 'ARXIC-COMPILE-LOCATOR-NONSEMANTIC' as const;
export const ARXIC_COMPILE_SECRET_EXPOSURE = 'ARXIC-COMPILE-SECRET-EXPOSURE' as const;
export const ARXIC_COMPILE_UNSUPPORTED_STEP = 'ARXIC-COMPILE-UNSUPPORTED-STEP' as const;
export const ARXIC_COMPILE_EVIDENCE_MISSING = 'ARXIC-COMPILE-EVIDENCE-MISSING' as const;
export const ARXIC_COMPILE_MANIFEST_INVALID = 'ARXIC-COMPILE-MANIFEST-INVALID' as const;
export const ARXIC_COMPILE_WRITE_FAILED = 'ARXIC-COMPILE-WRITE-FAILED' as const;
export const ARXIC_COMPILE_ORIGIN_DENIED = 'ARXIC-COMPILE-ORIGIN-DENIED' as const;
export const ARXIC_PROBE_INSENSITIVE_ASSERTION = 'ARXIC-PROBE-INSENSITIVE-ASSERTION' as const;
export const ARXIC_PROBE_HARNESS_UNUSABLE = 'ARXIC-PROBE-HARNESS-UNUSABLE' as const;

export const ARXIC_COMPILE_DIAGNOSTIC_CODES = [
  ARXIC_COMPILE_WORKFLOW_INVALID,
  ARXIC_COMPILE_FORBIDDEN_API,
  ARXIC_COMPILE_LOCATOR_NONSEMANTIC,
  ARXIC_COMPILE_SECRET_EXPOSURE,
  ARXIC_COMPILE_UNSUPPORTED_STEP,
  ARXIC_COMPILE_EVIDENCE_MISSING,
  ARXIC_COMPILE_MANIFEST_INVALID,
  ARXIC_COMPILE_WRITE_FAILED,
  ARXIC_COMPILE_ORIGIN_DENIED,
] as const;

export type CompileDiagnosticCode = (typeof ARXIC_COMPILE_DIAGNOSTIC_CODES)[number];

export const ARXIC_PROBE_DIAGNOSTIC_CODES = [
  ARXIC_PROBE_INSENSITIVE_ASSERTION,
  ARXIC_PROBE_HARNESS_UNUSABLE,
] as const;

export type ProbeDiagnosticCode = (typeof ARXIC_PROBE_DIAGNOSTIC_CODES)[number];

export function compileDiagnostic(
  code: CompileDiagnosticCode,
  subject: string,
  message: string,
): Diagnostic {
  const diagnostic: Diagnostic = { code, severity: 'blocked', subject, message };
  if (!validateDiagnostic(diagnostic).ok)
    throw new Error('Playwright compiler manufactured an invalid Diagnostic');
  return diagnostic;
}

export function probeDiagnostic(
  code: ProbeDiagnosticCode,
  subject: string,
  message: string,
): Diagnostic {
  const diagnostic: Diagnostic = { code, severity: 'blocked', subject, message };
  if (!validateDiagnostic(diagnostic).ok)
    throw new Error('Playwright sensitivity probe manufactured an invalid Diagnostic');
  return diagnostic;
}
