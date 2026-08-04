import { readFileSync } from 'node:fs';
import Ajv2020, { type ErrorObject } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';

export const ARXIC_EVIDENCE_REF_INVALID = 'ARXIC-EVIDENCE-REF-INVALID' as const;
export const ARXIC_EVIDENCE_REF_KIND_UNKNOWN = 'ARXIC-EVIDENCE-REF-KIND-UNKNOWN' as const;
export const ARXIC_EVIDENCE_REF_RANGE = 'ARXIC-EVIDENCE-REF-RANGE' as const;
export const ARXIC_SOURCE_REVISION_INVALID = 'ARXIC-SOURCE-REVISION-INVALID' as const;
export const ARXIC_EVIDENCE_ID_GRAMMAR = 'ARXIC-EVIDENCE-ID-GRAMMAR' as const;
export const ARXIC_EVIDENCE_INDEX_INVALID = 'ARXIC-EVIDENCE-INDEX-INVALID' as const;
export const ARXIC_WORKFLOW_INVALID = 'ARXIC-WORKFLOW-INVALID' as const;
export const ARXIC_WORKFLOW_STATUS_UNKNOWN = 'ARXIC-WORKFLOW-STATUS-UNKNOWN' as const;
export const ARXIC_WORKFLOW_TRANSITION_NO_ASSERTIONS =
  'ARXIC-WORKFLOW-TRANSITION-NO-ASSERTIONS' as const;
export const ARXIC_WORKFLOW_NEGATIVE_NO_EXPECTED = 'ARXIC-WORKFLOW-NEGATIVE-NO-EXPECTED' as const;
export const ARXIC_WORKFLOW_VERIFICATION_MISSING = 'ARXIC-WORKFLOW-VERIFICATION-MISSING' as const;
export const ARXIC_WORKFLOW_VERIFIED_WITHOUT_RUNTIME_EVIDENCE =
  'ARXIC-WORKFLOW-VERIFIED-WITHOUT-RUNTIME-EVIDENCE' as const;
export const ARXIC_WORKFLOW_EVIDENCE_ID_INVALID = 'ARXIC-WORKFLOW-EVIDENCE-ID-INVALID' as const;
export const ARXIC_DIAGNOSTIC_INVALID = 'ARXIC-DIAGNOSTIC-INVALID' as const;
export const ARXIC_DIAGNOSTIC_SEVERITY_UNKNOWN = 'ARXIC-DIAGNOSTIC-SEVERITY-UNKNOWN' as const;
export const ARXIC_DIAGNOSTIC_CODE_FORMAT = 'ARXIC-DIAGNOSTIC-CODE-FORMAT' as const;

export type DiagnosticSeverity = 'hypothesized' | 'observed' | 'contradicted' | 'blocked';

export type Diagnostic = {
  code: string;
  severity: DiagnosticSeverity;
  subject: string;
  message: string;
  evidenceRefs?: string[];
  supportedFixes?: string[];
};

const schemaUrl = new URL('../../../schemas/diagnostics/diagnostics.schema.json', import.meta.url);
let diagnosticSchema: object;

try {
  diagnosticSchema = JSON.parse(readFileSync(schemaUrl, 'utf8')) as object;
} catch (error) {
  throw new Error(`Failed to load Diagnostic schema at ${schemaUrl.pathname}`, { cause: error });
}

const ajv = new Ajv2020({ allErrors: true });
addFormats(ajv);
const validate = ajv.compile<Diagnostic>(diagnosticSchema);

const diagnosticCode = (error: ErrorObject) => {
  if (error.instancePath === '/severity' && error.keyword === 'enum') {
    return ARXIC_DIAGNOSTIC_SEVERITY_UNKNOWN;
  }
  if (error.instancePath === '/code' && error.keyword === 'pattern') {
    return ARXIC_DIAGNOSTIC_CODE_FORMAT;
  }
  return ARXIC_DIAGNOSTIC_INVALID;
};

const toDiagnostic = (error: ErrorObject): Diagnostic => ({
  code: diagnosticCode(error),
  severity: 'blocked',
  subject: 'diagnostic',
  message: `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`,
});

export const validateDiagnostic = (
  input: unknown,
): { ok: true; value: Diagnostic } | { ok: false; diagnostics: Diagnostic[] } => {
  if (validate(input)) {
    return { ok: true, value: input };
  }
  return {
    ok: false,
    diagnostics: (validate.errors ?? []).map(toDiagnostic),
  };
};
