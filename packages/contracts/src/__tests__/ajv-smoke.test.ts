import { describe, it, expect } from 'vitest';
import Ajv from 'ajv';

const evidenceKindSchema = {
  type: 'object',
  required: ['kind'],
  properties: { kind: { type: 'string', enum: ['source', 'runtime', 'document'] } },
  additionalProperties: false,
} as const;

describe('AJV contract-validation harness (seed for issues #2-#5)', () => {
  it('accepts a valid instance against a strict schema', () => {
    const validate = new Ajv({ strict: true }).compile(evidenceKindSchema);
    expect(validate({ kind: 'source' })).toBe(true);
  });

  it('rejects an invalid kind (independent expected value)', () => {
    const validate = new Ajv({ strict: true }).compile(evidenceKindSchema);
    expect(validate({ kind: 'nope' })).toBe(false);
  });

  it('rejects a missing required field', () => {
    const validate = new Ajv({ strict: true }).compile(evidenceKindSchema);
    expect(validate({})).toBe(false);
  });
});
