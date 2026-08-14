import { validateDiagnostic, type Diagnostic } from '@arxic/contracts';

export const ARXIC_CLI_USAGE = 'ARXIC-CLI-USAGE' as const;
export const ARXIC_CLI_INTERNAL = 'ARXIC-CLI-INTERNAL' as const;
export const ARXIC_CONFIG_MISSING = 'ARXIC-CONFIG-MISSING' as const;
export const ARXIC_CONFIG_PARSE = 'ARXIC-CONFIG-PARSE' as const;
export const ARXIC_CONFIG_INVALID = 'ARXIC-CONFIG-INVALID' as const;
export const ARXIC_CONFIG_VERSION = 'ARXIC-CONFIG-VERSION' as const;
export const ARXIC_CONFIG_MODEL_MISSING = 'ARXIC-CONFIG-MODEL-MISSING' as const;
export const ARXIC_EXEC_CRASH = 'ARXIC-EXEC-CRASH' as const;
export const ARXIC_EXEC_RESUMED = 'ARXIC-EXEC-RESUMED' as const;
export const ARXIC_EXEC_WORKER_INTERRUPTED = 'ARXIC-EXEC-WORKER-INTERRUPTED' as const;
export const ARXIC_EXEC_WORKER_PROTOCOL = 'ARXIC-EXEC-WORKER-PROTOCOL' as const;
export const ARXIC_EXEC_WORKER_SOURCE_MISMATCH = 'ARXIC-EXEC-WORKER-SOURCE-MISMATCH' as const;
export const ARXIC_EXEC_WORKER_APPROVAL_REQUIRED = 'ARXIC-EXEC-WORKER-APPROVAL-REQUIRED' as const;

export type CliDiagnosticCode =
  | typeof ARXIC_CLI_USAGE
  | typeof ARXIC_CLI_INTERNAL
  | typeof ARXIC_CONFIG_MISSING
  | typeof ARXIC_CONFIG_PARSE
  | typeof ARXIC_CONFIG_INVALID
  | typeof ARXIC_CONFIG_VERSION
  | typeof ARXIC_CONFIG_MODEL_MISSING
  | typeof ARXIC_EXEC_CRASH
  | typeof ARXIC_EXEC_RESUMED
  | typeof ARXIC_EXEC_WORKER_INTERRUPTED
  | typeof ARXIC_EXEC_WORKER_PROTOCOL
  | typeof ARXIC_EXEC_WORKER_SOURCE_MISMATCH
  | typeof ARXIC_EXEC_WORKER_APPROVAL_REQUIRED;

export function cliDiagnostic(
  code: CliDiagnosticCode,
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
  if (!validateDiagnostic(diagnostic).ok) throw new Error('CLI made an invalid Diagnostic');
  return diagnostic;
}
