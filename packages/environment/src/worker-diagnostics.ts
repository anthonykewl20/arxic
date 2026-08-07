import { validateDiagnostic, type Diagnostic, type DiagnosticSeverity } from '@arxic/contracts';

export const WORKER_DIAGNOSTIC_CODES = [
  'ARXIC-WORKER-QUOTA-EXCEEDED',
  'ARXIC-WORKER-ISOLATION-VIOLATED',
  'ARXIC-WORKER-CONFIG-UNSAFE',
  'ARXIC-WORKER-CLEANUP-FAILED',
  'ARXIC-WORKER-TIMEOUT',
  'ARXIC-WORKER-RUN-FAILED',
  'ARXIC-WORKER-INJECTION-NEUTRALIZED',
] as const;

export type WorkerDiagnosticCode = (typeof WORKER_DIAGNOSTIC_CODES)[number];

export function workerDiagnostic(
  code: WorkerDiagnosticCode,
  subject: string,
  message: string,
  severity: DiagnosticSeverity = 'blocked',
): Diagnostic {
  const diagnostic: Diagnostic = { code, severity, subject, message };
  if (!validateDiagnostic(diagnostic).ok) {
    throw new Error(`Manufactured invalid worker diagnostic: ${code}`);
  }
  return diagnostic;
}
