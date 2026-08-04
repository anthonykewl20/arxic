import type { Diagnostic, DiagnosticSeverity } from '@arxic/contracts';
import { validateDiagnostic } from '@arxic/contracts';

export const ARXIC_AGENT_HANDSHAKE_FAILED = 'ARXIC-AGENT-HANDSHAKE-FAILED' as const;
export const ARXIC_AGENT_TOOL_MISSING = 'ARXIC-AGENT-TOOL-MISSING' as const;
export const ARXIC_AGENT_SCHEMA_DRIFT = 'ARXIC-AGENT-SCHEMA-DRIFT' as const;
export const ARXIC_AGENT_PROCESS_ERROR = 'ARXIC-AGENT-PROCESS-ERROR' as const;
export const ARXIC_AGENT_HEAL_REJECTED = 'ARXIC-AGENT-HEAL-REJECTED' as const;
export const ARXIC_AGENT_WORKFLOW_INVALID = 'ARXIC-AGENT-WORKFLOW-INVALID' as const;
export const ARXIC_AGENT_FALLBACK_FAILED = 'ARXIC-AGENT-FALLBACK-FAILED' as const;

export const AGENT_DIAGNOSTIC_CODES = [
  ARXIC_AGENT_HANDSHAKE_FAILED,
  ARXIC_AGENT_TOOL_MISSING,
  ARXIC_AGENT_SCHEMA_DRIFT,
  ARXIC_AGENT_PROCESS_ERROR,
  ARXIC_AGENT_HEAL_REJECTED,
  ARXIC_AGENT_WORKFLOW_INVALID,
  ARXIC_AGENT_FALLBACK_FAILED,
] as const;

export type AgentDiagnosticCode = (typeof AGENT_DIAGNOSTIC_CODES)[number];

export function agentDiagnostic(
  code: AgentDiagnosticCode,
  subject: string,
  message: string,
  severity: DiagnosticSeverity = 'blocked',
): Diagnostic {
  const diagnostic = { code, severity, subject, message };
  if (!validateDiagnostic(diagnostic).ok)
    throw new Error('adapter manufactured invalid Diagnostic');
  return diagnostic;
}
