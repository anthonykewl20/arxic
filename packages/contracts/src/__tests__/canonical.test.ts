import { canonicalJson, sha256 } from '..';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const exec = promisify(execFile);

// Generated fixture runtimes cannot resolve workspace packages. The remaining
// exemptions are domain serializers whose normalization/redaction semantics are
// intentionally outside the generic JSON contract.
const STRUCTURAL_GATE_EXEMPTIONS = new Set([
  'packages/contracts/src/canonical.ts',
  'packages/playwright-compiler/src/transition-receipt-runtime.ts',
  'packages/playwright-screenshot-privacy/src/standalone-runtime.ts',
  'packages/policy-engine/src/snapshot.ts',
  'packages/playwright-agent-adapter/src/exploration-driver.ts',
  'packages/bundle-promoter/src/bundle-assembler.ts',
]);

describe('canonical JSON capability', () => {
  it.each([
    ['undefined', undefined],
    ['Date', new Date('2026-08-15T00:00:00.000Z')],
    ['Map', new Map([['a', 1]])],
    ['Set', new Set(['a'])],
    ['BigInt', 1n],
  ])('rejects lossy %s input', (_kind, value) => {
    expect(() => canonicalJson(value)).toThrow(TypeError);
  });

  it('rejects undefined members and cyclic records', () => {
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(() => canonicalJson({ absent: undefined })).toThrow('undefined');
    expect(() => canonicalJson(cyclic)).toThrow('cyclic');
  });

  it('sorts nested records and hashes the exact canonical bytes', () => {
    const bytes = canonicalJson({ z: [3, { y: true, a: null }], a: 'first' });
    expect(bytes).toBe('{"a":"first","z":[3,{"a":null,"y":true}]}');
    expect(sha256(bytes)).toBe('aa5b57b84362a73916774d3a4d118a8f2ee5d8b738c6241a9d275284dea18edc');
  });

  it('has no duplicate production canonical JSON or SHA-256 implementation outside contracts', async () => {
    let stdout = '';
    try {
      ({ stdout } = await exec('rg', [
        '-l',
        '(?:function|const)\\s+(?:canonicalJson|sha256|stableStringify|canonicalizeSbom)\\b|createHash\\((?:\'|")sha256(?:\'|")\\)',
        'packages',
        'apps',
        '-g',
        '*.ts',
        '-g',
        '!**/*.test.ts',
        '-g',
        '!**/__tests__/**',
      ]));
    } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 1)) throw error;
    }
    const duplicateImplementations = stdout
      .split('\n')
      .filter(Boolean)
      .filter((path) => !STRUCTURAL_GATE_EXEMPTIONS.has(path));
    expect(duplicateImplementations).toEqual([]);
  });
});
