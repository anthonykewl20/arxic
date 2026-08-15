import Ajv2020, { type ErrorObject } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import sourceRevisionSchema from '../../../schemas/evidence/source-revision.schema.json';
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

function createValidator() {
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
