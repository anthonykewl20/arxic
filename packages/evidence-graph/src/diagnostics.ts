import type { Diagnostic, EvidenceRef } from '@arxic/contracts';
import { validateDiagnostic } from '@arxic/contracts';
import { evidenceRefId } from './serialize';

export const ARXIC_GRAPH_EDGE_EVIDENCE_MISSING = 'ARXIC-GRAPH-001' as const;
export const ARXIC_GRAPH_NODE_CONFLICT = 'ARXIC-GRAPH-002' as const;
export const ARXIC_GRAPH_EDGE_CONFLICT = 'ARXIC-GRAPH-003' as const;

export type GraphDiagnosticCode =
  | typeof ARXIC_GRAPH_EDGE_EVIDENCE_MISSING
  | typeof ARXIC_GRAPH_NODE_CONFLICT
  | typeof ARXIC_GRAPH_EDGE_CONFLICT;

export function graphDiagnostic(
  code: GraphDiagnosticCode,
  severity: Diagnostic['severity'],
  subject: string,
  message: string,
  evidence: readonly EvidenceRef[] = [],
): Diagnostic {
  const diagnostic: Diagnostic = {
    code,
    severity,
    subject,
    message,
    ...(evidence.length > 0 ? { evidenceRefs: evidence.map(evidenceRefId) } : {}),
  };
  if (!validateDiagnostic(diagnostic).ok)
    throw new Error('evidence-graph made an invalid Diagnostic');
  return diagnostic;
}
