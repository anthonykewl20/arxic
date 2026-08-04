import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { evaluateGraph } from './license-gate.mjs';
import { classifyExpression, classifyPackage } from './license-policy.mjs';

describe('license policy sad paths', () => {
  it.each([
    'AGPL-3.0-or-later',
    'GPL-3.0',
    'SSPL',
    'Commons-Clause',
    'BSL-1.1',
    'Unknown',
    'EUPL-1.2',
  ])('rejects %s', (license) => {
    expect(classifyPackage({ name: 'blocked-package', license }).disposition).toBe('rejected');
  });

  it('distinguishes LGPL from GPL', () => {
    expect(classifyExpression('GPL-3.0')).toBe('rejected');
    expect(classifyExpression('LGPL-3.0-or-later')).toBe('allowed');
  });
});

describe('license policy allowed paths', () => {
  it.each([
    'MIT',
    'Apache-2.0',
    'ISC',
    'BSD-3-Clause',
    '0BSD',
    'MPL-2.0',
    '(MIT OR Apache-2.0)',
    '(BSD-2-Clause OR MIT OR Apache-2.0)',
    'CC-BY-4.0',
    'Python-2.0',
  ])('allows %s', (license) => {
    expect(classifyExpression(license)).toBe('allowed');
  });

  it('allows the thirty-two detection exception', () => {
    expect(classifyPackage({ name: 'thirty-two', license: 'Unknown' }).disposition).toBe('allowed');
  });

  it('loads well-formed license exceptions', () => {
    const exceptions = JSON.parse(
      readFileSync(new URL('../license-exceptions.json', import.meta.url), 'utf8'),
    );
    expect(exceptions).toBeTypeOf('object');
    expect(exceptions).not.toBeNull();
    for (const exception of Object.values(exceptions)) {
      expect(exception.license).toBeTypeOf('string');
      expect(exception.reason).toBeTypeOf('string');
    }
  });

  it('passes the real Arxic dependency graph with zero rejected packages', () => {
    const graph = JSON.parse(
      execFileSync('pnpm', ['licenses', 'list', '--json'], {
        encoding: 'utf8',
      }),
    );
    expect(evaluateGraph(graph).rejected).toEqual([]);
  });
});
