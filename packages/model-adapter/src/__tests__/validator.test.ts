import { describe, expect, it } from 'vitest';
import { assertSchemaVersion } from '..';

describe('assertSchemaVersion', () => {
  it('fails closed when an object is missing schemaVersion', () => {
    const result = assertSchemaVersion({ candidates: [] }, 'schema-v1');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected schema-version drift');
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'ARXIC-MODEL-SCHEMA-VERSION-DRIFT',
    ]);
  });

  it('fails closed when schemaVersion does not match', () => {
    const result = assertSchemaVersion({ schemaVersion: 'schema-v2' }, 'schema-v1');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected schema-version drift');
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'ARXIC-MODEL-SCHEMA-VERSION-DRIFT',
    ]);
  });

  it('accepts a matching schemaVersion', () => {
    expect(assertSchemaVersion({ schemaVersion: 'schema-v1' }, 'schema-v1')).toEqual({ ok: true });
  });

  it('fails closed when non-object output cannot declare schemaVersion', () => {
    expect(assertSchemaVersion('schema-v1', 'schema-v1').ok).toBe(false);
    expect(assertSchemaVersion(null, 'schema-v1').ok).toBe(false);
  });
});
