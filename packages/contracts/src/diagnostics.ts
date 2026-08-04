export const ARXIC_EVIDENCE_REF_INVALID = 'ARXIC-EVIDENCE-REF-INVALID' as const;
export const ARXIC_EVIDENCE_REF_KIND_UNKNOWN = 'ARXIC-EVIDENCE-REF-KIND-UNKNOWN' as const;
export const ARXIC_EVIDENCE_REF_RANGE = 'ARXIC-EVIDENCE-REF-RANGE' as const;
export const ARXIC_SOURCE_REVISION_INVALID = 'ARXIC-SOURCE-REVISION-INVALID' as const;
export const ARXIC_EVIDENCE_ID_GRAMMAR = 'ARXIC-EVIDENCE-ID-GRAMMAR' as const;
export const ARXIC_EVIDENCE_INDEX_INVALID = 'ARXIC-EVIDENCE-INDEX-INVALID' as const;

export type Diagnostic = {
  code: string;
  severity: 'blocked';
  subject: string;
  message: string;
};
