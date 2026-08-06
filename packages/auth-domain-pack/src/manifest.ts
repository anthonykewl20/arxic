import type {
  AuthCandidate,
  CoverageMatrix,
  CoverageRow,
  DomainManifest,
  WorkflowResult,
} from './types';

export function createDomainManifest(
  workflows: WorkflowResult[],
  generatedAt: string,
): DomainManifest {
  return {
    schemaVersion: 1,
    domain: 'authentication',
    generatedAt,
    generator: { id: '@arxic/auth-domain-pack', version: '0.0.0' },
    workflowCount: workflows.length,
    verified: workflows.filter(({ outcome }) => outcome === 'verified').length,
    blocked: workflows.filter(({ outcome }) => outcome === 'blocked').length,
    contradicted: workflows.filter(({ outcome }) => outcome === 'contradicted').length,
  };
}

export function createCoverageMatrix(
  candidates: AuthCandidate[],
  workflows: WorkflowResult[],
): CoverageMatrix {
  const results = new Map(workflows.map((result) => [result.id, result]));
  const rows: CoverageRow[] = candidates.map((candidate) => {
    const result = results.get(candidate.workflow.id);
    if (!result) throw new Error(`Missing workflow result for ${candidate.workflow.id}`);
    const evidence = candidateEvidence(candidate);
    const blockerReason =
      result.outcome === 'blocked'
        ? result.diagnostics.map(({ message }) => message).join('; ')
        : undefined;
    return {
      workflowId: result.id,
      title: result.title,
      outcome: result.outcome,
      staticEvidence: evidence.filter((id) => id.startsWith('src:')).length,
      runtimeEvidence: evidence.filter((id) => id.startsWith('run:')).length,
      ...(blockerReason ? { blockerReason } : {}),
    };
  });
  return { denominator: rows.length, rows };
}

export function candidateEvidence(candidate: AuthCandidate): string[] {
  return [
    ...new Set([
      ...candidate.workflow.evidenceRefs,
      ...candidate.workflow.transitions.flatMap(({ evidenceRefs }) => evidenceRefs),
    ]),
  ];
}
