import { readFileSync } from 'node:fs';
import Ajv2020, { type ErrorObject } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { ARXIC_SOURCE_REVISION_INVALID, type Diagnostic } from './diagnostics';

export type SourceRevision = {
  repository: string;
  commit: string;
  dirty: boolean;
  submodules?: {
    path: string;
    repository: string;
    commit: string;
  }[];
};

const schemaUrl = new URL('../../../schemas/evidence/source-revision.schema.json', import.meta.url);
function createValidator() {
  let sourceRevisionSchema: object;
  try {
    sourceRevisionSchema = JSON.parse(readFileSync(schemaUrl, 'utf8')) as object;
  } catch (error) {
    throw new Error(`Failed to load SourceRevision schema at ${schemaUrl.pathname}`, {
      cause: error,
    });
  }
  const ajv = new Ajv2020({ allErrors: true });
  addFormats(ajv);
  return ajv.compile<SourceRevision>(sourceRevisionSchema);
}
let validate: ReturnType<typeof createValidator> | undefined;
const validator = () => (validate ??= createValidator());

const toDiagnostic = (error: ErrorObject): Diagnostic => ({
  code: ARXIC_SOURCE_REVISION_INVALID,
  severity: 'blocked',
  subject: 'source-revision',
  message: `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`,
});

export const validateSourceRevision = (
  input: unknown,
): { ok: true; value: SourceRevision } | { ok: false; diagnostics: Diagnostic[] } => {
  const compiled = validator();
  if (compiled(input)) {
    return { ok: true, value: input };
  }
  return {
    ok: false,
    diagnostics: (compiled.errors ?? []).map(toDiagnostic),
  };
};
