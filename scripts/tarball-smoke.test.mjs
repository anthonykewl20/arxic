import { describe, expect, it } from 'vitest';

import { assertTarballSmoke } from './tarball-smoke.mjs';

const packagedFiles = [
  'package/dist/cli.js',
  'package/LICENSE',
  'package/NOTICE',
  'package/package.json',
];

describe('tarball smoke sad paths', () => {
  it('rejects a packed CLI whose --version output drifts from VERSION', async () => {
    await expect(
      assertTarballSmoke({
        version: '0.1.1',
        buildCli: async () => {},
        pack: async () => '/tmp/arxic.tgz',
        listTarball: async () => packagedFiles,
        install: async () => {},
        runCli: async (args) => (args[0] === '--version' ? '0.1.2' : ''),
      }),
    ).rejects.toThrow('packed arxic --version output 0.1.2 does not match VERSION 0.1.1');
  });

  it('rejects a packed CLI whose help command fails', async () => {
    await expect(
      assertTarballSmoke({
        version: '0.1.1',
        buildCli: async () => {},
        pack: async () => '/tmp/arxic.tgz',
        listTarball: async () => packagedFiles,
        install: async () => {},
        runCli: async (args) => {
          if (args[0] === '--version') return '0.1.1';
          throw new Error('help failed');
        },
      }),
    ).rejects.toThrow('help failed');
  });

  it('rejects a tarball missing the required LICENSE file', async () => {
    await expect(
      assertTarballSmoke({
        version: '0.1.1',
        buildCli: async () => {},
        pack: async () => '/tmp/arxic.tgz',
        listTarball: async () => packagedFiles.filter((path) => path !== 'package/LICENSE'),
        install: async () => {},
        runCli: async () => '0.1.1',
      }),
    ).rejects.toThrow('tarball is missing required entry package/LICENSE');
  });
});

describe('tarball smoke allowed path', () => {
  it('accepts a tarball whose CLI reports VERSION and serves help', async () => {
    await expect(
      assertTarballSmoke({
        version: '0.1.1',
        buildCli: async () => {},
        pack: async () => '/tmp/arxic.tgz',
        listTarball: async () => packagedFiles,
        install: async () => {},
        runCli: async (args) => (args[0] === '--version' ? '0.1.1' : 'Usage: arxic'),
      }),
    ).resolves.toBeUndefined();
  });
});
