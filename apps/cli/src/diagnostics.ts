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

export type CliDiagnosticCode =
  | typeof ARXIC_CLI_USAGE
  | typeof ARXIC_CLI_INTERNAL
  | typeof ARXIC_CONFIG_MISSING
  | typeof ARXIC_CONFIG_PARSE
  | typeof ARXIC_CONFIG_INVALID
  | typeof ARXIC_CONFIG_VERSION
  | typeof ARXIC_CONFIG_MODEL_MISSING
  | typeof ARXIC_EXEC_CRASH
  | typeof ARXIC_EXEC_RESUMED;

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
