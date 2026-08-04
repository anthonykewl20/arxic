import type { Diagnostic } from '@arxic/contracts';
import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import {
  ARXIC_MODEL_STRUCTURED_OUTPUT_INVALID,
  ARXIC_MODEL_SCHEMA_VERSION_DRIFT,
  modelDiagnostic,
} from './diagnostics';

export type CompiledSchema =
  { ok: true; validate: ValidateFunction<unknown> } | { ok: false; diagnostics: Diagnostic[] };

export type StructuredValidationResult =
  { ok: true; value: unknown } | { ok: false; diagnostics: Diagnostic[] };

export const RUN_RECORD_SCHEMA = {
  type: 'object',
  required: ['requestId', 'schemaVersion', 'schemaSha256', 'model', 'tokens', 'timestamp'],
  additionalProperties: false,
  properties: {
    requestId: { type: 'string' },
    schemaVersion: { type: 'string' },
    schemaSha256: { type: 'string', pattern: '^[0-9a-f]{64}$' },
    model: { type: 'string' },
    tokens: {
      type: 'object',
      required: ['prompt', 'completion', 'total'],
      additionalProperties: false,
      properties: {
        prompt: { type: 'number', minimum: 0 },
        completion: { type: 'number', minimum: 0 },
        total: { type: 'number', minimum: 0 },
      },
    },
    cost: { type: 'object' },
    retention: { type: 'string' },
    region: { type: 'string' },
    sourceSharing: { type: 'string' },
    timestamp: { type: 'string', format: 'date-time' },
  },
};

export function compileSchema(schema: object): CompiledSchema {
  try {
    const ajv = new Ajv2020({ allErrors: true });
    addFormats(ajv);
    return { ok: true, validate: ajv.compile(schema) };
  } catch {
    return {
      ok: false,
      diagnostics: [
        modelDiagnostic(
          ARXIC_MODEL_STRUCTURED_OUTPUT_INVALID,
          'structured-output-schema',
          'Structured output schema could not be compiled',
        ),
      ],
    };
  }
}

export function validateStructuredOutput(
  validate: ValidateFunction<unknown>,
  value: unknown,
): StructuredValidationResult {
  if (validate(value)) return { ok: true, value };
  const message = (validate.errors ?? [])
    .map((error) => `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`)
    .join('; ');
  return {
    ok: false,
    diagnostics: [
      modelDiagnostic(
        ARXIC_MODEL_STRUCTURED_OUTPUT_INVALID,
        'structured-output',
        message || 'Structured output is invalid',
      ),
    ],
  };
}

export function assertSchemaVersion(
  output: unknown,
  expected: string,
): { ok: true } | { ok: false; diagnostics: Diagnostic[] } {
  if (
    typeof output === 'object' &&
    output !== null &&
    !Array.isArray(output) &&
    (output as Record<string, unknown>).schemaVersion === expected
  ) {
    return { ok: true };
  }
  return {
    ok: false,
    diagnostics: [
      modelDiagnostic(
        ARXIC_MODEL_SCHEMA_VERSION_DRIFT,
        'structured-output.schemaVersion',
        'Model output schema version does not match the expected version',
      ),
    ],
  };
}

const runRecordSchema = compileSchema(RUN_RECORD_SCHEMA);

export function validateRunRecord(
  record: unknown,
): { ok: true } | { ok: false; diagnostics: Diagnostic[] } {
  if (!runRecordSchema.ok) return runRecordSchema;
  const result = validateStructuredOutput(runRecordSchema.validate, record);
  return result.ok ? { ok: true } : result;
}
