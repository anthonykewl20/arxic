import { readFileSync } from 'node:fs';
import Ajv2020, { type ErrorObject } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import {
  ARXIC_EVIDENCE_ID_GRAMMAR,
  ARXIC_EVIDENCE_INDEX_INVALID,
  type Diagnostic,
} from './diagnostics';
import { validateEvidenceRef, type EvidenceRef } from './evidence-ref';

export type EvidenceIndex = Record<string, EvidenceRef>;
export type EvidenceId = string & { readonly __evidenceId: unique symbol };
export const EVIDENCE_ID_PATTERN = /^(src|run|doc):[A-Za-z0-9._#-]+(?::[A-Za-z0-9._#-]+)?$/;

const schemaUrl = new URL('../../../schemas/evidence/evidence-index.schema.json', import.meta.url);
const evidenceRefSchemaUrl = new URL(
  '../../../schemas/evidence/evidence-ref.schema.json',
  import.meta.url,
);
function createValidator() {
  let evidenceIndexSchema: object;
  let evidenceRefSchema: object;
  try {
    evidenceIndexSchema = JSON.parse(readFileSync(schemaUrl, 'utf8')) as object;
    evidenceRefSchema = JSON.parse(readFileSync(evidenceRefSchemaUrl, 'utf8')) as object;
  } catch (error) {
    throw new Error(
      `Failed to load EvidenceIndex schemas at ${schemaUrl.pathname} and ${evidenceRefSchemaUrl.pathname}`,
      { cause: error },
    );
  }
  const ajv = new Ajv2020({ allErrors: true, $data: true });
  addFormats(ajv);
  ajv.addSchema(evidenceRefSchema);
  return ajv.compile<EvidenceIndex>(evidenceIndexSchema);
}
let validate: ReturnType<typeof createValidator> | undefined;
const validator = () => (validate ??= createValidator());

const grammarDiagnostic = (id: unknown): Diagnostic => ({
  code: ARXIC_EVIDENCE_ID_GRAMMAR,
  severity: 'blocked',
  subject: 'evidence-id',
  message: `${String(id)} does not match the EvidenceId grammar`,
});

export const validateEvidenceId = (
  id: unknown,
): { ok: true; value: EvidenceId } | { ok: false; diagnostics: Diagnostic[] } => {
  if (typeof id === 'string' && EVIDENCE_ID_PATTERN.test(id)) {
    return { ok: true, value: id as EvidenceId };
  }
  return { ok: false, diagnostics: [grammarDiagnostic(id)] };
};

const indexDiagnostic = (error: ErrorObject): Diagnostic => ({
  code: ARXIC_EVIDENCE_INDEX_INVALID,
  severity: 'blocked',
  subject: 'evidence-index',
  message: `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`,
});

export const validateEvidenceIndex = (
  input: unknown,
): { ok: true; value: EvidenceIndex } | { ok: false; diagnostics: Diagnostic[] } => {
  if (typeof input === 'object' && input !== null && !Array.isArray(input)) {
    const invalidKey = Object.keys(input).find((key) => !EVIDENCE_ID_PATTERN.test(key));
    if (invalidKey !== undefined) {
      return { ok: false, diagnostics: [grammarDiagnostic(invalidKey)] };
    }
  }
  const compiled = validator();
  if (compiled(input)) {
    return { ok: true, value: input };
  }
  const diagnostics = (compiled.errors ?? []).map(indexDiagnostic);
  if (typeof input === 'object' && input !== null && !Array.isArray(input)) {
    for (const value of Object.values(input)) {
      const result = validateEvidenceRef(value);
      if (!result.ok) {
        diagnostics.push(...result.diagnostics);
      }
    }
  }
  return { ok: false, diagnostics };
};
