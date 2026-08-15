import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, win32 } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  assertVersionProvenance,
  isProductionSourceFile,
  pnpmExecutable,
} from './assert-version-provenance.mjs';

async function makeWorkspace({ cliVersion = '0.1.1', producer = '0.1.1' } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'arxic-version-provenance-'));
  await Promise.all([
    mkdir(join(root, 'apps/cli/src'), { recursive: true }),
    mkdir(join(root, 'apps/worker/src'), { recursive: true }),
    mkdir(join(root, 'packages/example/src'), { recursive: true }),
    mkdir(join(root, 'test-fixtures/reference-auth-app'), { recursive: true }),
    mkdir(join(root, 'test-fixtures/vulnerable-auth-app'), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(root, 'VERSION'), '0.1.1\n'),
    writeFile(join(root, 'package.json'), JSON.stringify({ version: '0.1.1' })),
    writeFile(join(root, 'apps/cli/package.json'), JSON.stringify({ version: cliVersion })),
    writeFile(join(root, 'apps/worker/package.json'), JSON.stringify({ version: '0.1.1' })),
    writeFile(join(root, 'packages/example/package.json'), JSON.stringify({ version: '0.1.1' })),
    writeFile(
      join(root, 'test-fixtures/reference-auth-app/package.json'),
      JSON.stringify({ version: '0.0.0', private: true }),
    ),
    writeFile(
      join(root, 'test-fixtures/vulnerable-auth-app/package.json'),
      JSON.stringify({ version: '0.0.0', private: true }),
    ),
    writeFile(
      join(root, 'packages/example/src/producer.ts'),
      `export const manifest = { generator: { version: '${producer}' } };\n`,
    ),
  ]);
  return root;
}

describe('version provenance sad paths', () => {
  it('rejects a non-fixture workspace manifest that drifts from VERSION', async () => {
    const root = await makeWorkspace({ cliVersion: '0.1.2' });

    await expect(
      assertVersionProvenance({ root, buildCli: async () => {}, cliVersion: async () => '0.1.1' }),
    ).rejects.toThrow('apps/cli/package.json version 0.1.2 does not match VERSION 0.1.1');
  });

  it('rejects a production metadata producer that emits 0.0.0', async () => {
    const root = await makeWorkspace({ producer: '0.0.0' });

    await expect(
      assertVersionProvenance({ root, buildCli: async () => {}, cliVersion: async () => '0.1.1' }),
    ).rejects.toThrow('packages/example/src/producer.ts emits literal version 0.0.0');
  });

  it('rejects a built CLI whose --version output drifts from VERSION', async () => {
    const root = await makeWorkspace();

    await expect(
      assertVersionProvenance({ root, buildCli: async () => {}, cliVersion: async () => '0.1.2' }),
    ).rejects.toThrow('built arxic --version output 0.1.2 does not match VERSION 0.1.1');
  });
});

describe('version provenance allowed path', () => {
  it('excludes a Windows-style test fixture from production source scanning', () => {
    const fixturePath = win32.join('apps', 'cli', 'src', '__tests__', 'fixtures.ts');

    expect(isProductionSourceFile(fixturePath)).toBe(false);
    expect([fixturePath].filter(isProductionSourceFile)).toEqual([]);
  });

  it('uses the Windows pnpm command shim', () => {
    expect(pnpmExecutable('win32')).toBe('pnpm.cmd');
  });

  it('accepts matching production manifests and built CLI output', async () => {
    const root = await makeWorkspace();

    await expect(
      assertVersionProvenance({ root, buildCli: async () => {}, cliVersion: async () => '0.1.1' }),
    ).resolves.toBeUndefined();
  });
});
