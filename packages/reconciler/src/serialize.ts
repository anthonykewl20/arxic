import { canonicalJson, codepointCompare } from '@arxic/evidence-graph';
import type { ReconciliationResult } from './types';

export { canonicalJson };

export function serializeCoverageMatrix(result: ReconciliationResult): string {
  return canonicalJson({
    ...result,
    rows: [...result.rows].sort((left, right) =>
      codepointCompare(left.candidateId, right.candidateId),
    ),
    orderedCandidates: [...result.orderedCandidates],
    diagnostics: [...result.diagnostics].sort((left, right) =>
      codepointCompare(`${left.code}\0${left.subject}`, `${right.code}\0${right.subject}`),
    ),
  });
}
