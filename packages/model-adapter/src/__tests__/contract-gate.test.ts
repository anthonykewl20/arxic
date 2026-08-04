import { validateDiagnostic } from '@arxic/contracts';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import * as exports from '..';
import {
  canonicalizeRecord,
  computeSchemaSha256,
  MODEL_DIAGNOSTIC_CODES,
  ModelAdapter,
  redactionGate,
  RUN_RECORD_SCHEMA,
  validateRunRecord,
  type ModelRunRecord,
} from '..';
import {
  adapterRequest,
  BEARER_TOKEN,
  completion,
  EXPECTED_SCHEMA_VERSION,
  startStub,
  STRUCTURED_OUTPUT_SCHEMA,
  validOutput,
} from './stub';

const runRecord: ModelRunRecord = {
  requestId: 'chatcmpl-contract-001',
  schemaVersion: EXPECTED_SCHEMA_VERSION,
  schemaSha256: computeSchemaSha256(STRUCTURED_OUTPUT_SCHEMA),
  model: 'test-model-v1',
  tokens: { prompt: 21, completion: 13, total: 34 },
  retention: 'none',
  region: 'local-test',
  sourceSharing: 'disabled',
  timestamp: '2026-08-05T14:00:00.000Z',
};

describe('ModelAdapter contract gate', () => {
  it('loop-closes every exported ARXIC-MODEL code through the frozen validator', () => {
    const codes = (Object.values(exports) as unknown[]).filter(
      (value): value is string => typeof value === 'string' && value.startsWith('ARXIC-MODEL-'),
    );
    expect(codes.sort()).toEqual([...MODEL_DIAGNOSTIC_CODES].sort());
    for (const code of codes) {
      expect(
        validateDiagnostic({
          code,
          severity: 'blocked',
          subject: 'contract-gate',
          message: 'test',
        }).ok,
      ).toBe(true);
    }
  });

  it('enforces the closed flat run-record shape and redaction contract with real AJV', () => {
    const ajv = new Ajv2020({ allErrors: true });
    addFormats(ajv);
    const validate = ajv.compile(RUN_RECORD_SCHEMA);
    expect(validateRunRecord(runRecord)).toEqual({ ok: true });
    expect(validate(runRecord)).toBe(true);
    for (const extra of [
      { messages: [{ role: 'user', content: 'prompt bytes' }] },
      { prompt: 'prompt bytes' },
      { content: 'prompt bytes' },
      { provider: { region: 'x' } },
      { completedAt: '2026-01-01T00:00:00.000Z' },
    ]) {
      const invalid = { ...runRecord, ...extra };
      expect(validate(invalid)).toBe(false);
      expect(validateRunRecord(invalid).ok).toBe(false);
    }
    expect(canonicalizeRecord(runRecord)).toBe(
      JSON.stringify({
        model: 'test-model-v1',
        region: 'local-test',
        requestId: 'chatcmpl-contract-001',
        retention: 'none',
        schemaSha256: computeSchemaSha256(STRUCTURED_OUTPUT_SCHEMA),
        schemaVersion: EXPECTED_SCHEMA_VERSION,
        sourceSharing: 'disabled',
        timestamp: '2026-08-05T14:00:00.000Z',
        tokens: { completion: 13, prompt: 21, total: 34 },
      }),
    );
    expect(redactionGate({ record: runRecord, output: undefined }, [BEARER_TOKEN]).ok).toBe(true);
    expect(
      redactionGate({ record: { ...runRecord, requestId: BEARER_TOKEN }, output: undefined }, [
        BEARER_TOKEN,
      ]).ok,
    ).toBe(false);
  });

  it('sends the credential only in the Bearer authorization header', async () => {
    const stub = await startStub(() => ({
      completion: completion(JSON.stringify(validOutput())),
    }));
    try {
      const result = await new ModelAdapter({
        baseUrl: stub.baseUrl,
        credentials: () => BEARER_TOKEN,
      }).requestStructuredOutput(adapterRequest());
      expect(result.ok).toBe(true);
      expect(stub.requests).toHaveLength(1);
      const captured = stub.requests[0];
      expect(captured.headers.authorization).toBe(`Bearer ${BEARER_TOKEN}`);
      const nonAuthorizationHeaders = Object.fromEntries(
        Object.entries(captured.headers).filter(([name]) => name !== 'authorization'),
      );
      expect(JSON.stringify(nonAuthorizationHeaders)).not.toContain(BEARER_TOKEN);
      expect(JSON.stringify(captured.body)).not.toContain(BEARER_TOKEN);
      expect(captured.body).toEqual({
        model: 'test-model-v1',
        messages: adapterRequest().messages,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'arxic_stage4_inference_v1',
            schema: STRUCTURED_OUTPUT_SCHEMA,
            strict: true,
          },
        },
      });
    } finally {
      await stub.close();
    }
  });
});
