import Ajv2020, { type ErrorObject } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import evidenceRefSchema from '../../../schemas/evidence/evidence-ref.schema.json';
import {
  ARXIC_EVIDENCE_REF_INVALID,
  ARXIC_EVIDENCE_REF_KIND_UNKNOWN,
  ARXIC_EVIDENCE_REF_RANGE,
  type Diagnostic,
} from './diagnostics';

export type EvidenceRefSource = {
  kind: 'source';
  repo: string;
  commit: string;
  path: string;
  startLine: number;
  endLine: number;
  blobSha256: string;
  extractor: string;
  ruleId?: string;
};

export type EvidenceRefRuntime = {
  kind: 'runtime';
  runId: string;
  appBuildDigest: string;
  browser: string;
  browserVersion: string;
  url: string;
  timestamp: string;
  accessibilitySnapshotSha256?: string;
  screenshotRef?: string;
  traceRef?: string;
  networkRefs?: string[];
};

export type EvidenceRefDocument = {
  kind: 'document';
  artifactRef: string;
  section?: string;
  sha256: string;
};

export type EvidenceRef = EvidenceRefSource | EvidenceRefRuntime | EvidenceRefDocument;

function createValidator() {
  const ajv = new Ajv2020({ allErrors: true, $data: true });
  addFormats(ajv);
  return ajv.compile<EvidenceRef>(evidenceRefSchema);
}
let validate: ReturnType<typeof createValidator> | undefined;
const validator = () => (validate ??= createValidator());

const isRecord = (input: unknown): input is Record<string, unknown> =>
  typeof input === 'object' && input !== null && !Array.isArray(input);

const diagnosticCode = (input: unknown) => {
  if (!isRecord(input) || !['source', 'runtime', 'document'].includes(String(input.kind))) {
    return ARXIC_EVIDENCE_REF_KIND_UNKNOWN;
  }
  if (
    input.kind === 'source' &&
    typeof input.startLine === 'number' &&
    typeof input.endLine === 'number' &&
    input.startLine > input.endLine
  ) {
    return ARXIC_EVIDENCE_REF_RANGE;
  }
  return ARXIC_EVIDENCE_REF_INVALID;
};

const toDiagnostic = (error: ErrorObject, code: string): Diagnostic => ({
  code,
  severity: 'blocked',
  subject: 'evidence-ref',
  message: `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`,
});

export const validateEvidenceRef = (
  input: unknown,
): { ok: true; value: EvidenceRef } | { ok: false; diagnostics: Diagnostic[] } => {
  const compiled = validator();
  if (compiled(input)) {
    return { ok: true, value: input };
  }
  const code = diagnosticCode(input);
  return {
    ok: false,
    diagnostics: (compiled.errors ?? []).map((error) => toDiagnostic(error, code)),
  };
};
