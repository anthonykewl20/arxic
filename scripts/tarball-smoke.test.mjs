import { describe, expect, it } from 'vitest';

import { assertTarballSmoke, packageManagerSpawnOptions } from './tarball-smoke.mjs';

const packagedFiles = [
  'package/dist/cli.js',
  'package/LICENSE',
  'package/NOTICE',
  'package/package.json',
];

function configFailure({
  code = 2,
  stdout = '',
  stderr = 'ARXIC-CONFIG-PARSE [config] invalid YAML',
} = {}) {
  return Object.assign(new Error('process failed'), { code, stdout, stderr });
}

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

  it('rejects a packed CLI whose malformed-config run crashes instead of returning a diagnostic', async () => {
    await expect(
      assertTarballSmoke({
        version: '0.1.1',
        buildCli: async () => {},
        pack: async () => '/tmp/arxic.tgz',
        listTarball: async () => packagedFiles,
        install: async () => {},
        runCli: async (args) => {
          if (args[0] === '--version') return '0.1.1';
          if (args[0] === 'run' && args[1] === '--config') {
            throw configFailure({
              stderr: 'Error: unexpected packed runtime failure\n    at runCli',
            });
          }
          return 'Usage: arxic';
        },
      }),
    ).rejects.toThrow('packed arxic malformed-config run crashed');
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
  it('uses a shell for Windows package-manager command shims', () => {
    expect(packageManagerSpawnOptions('win32')).toEqual({ shell: true });
    expect(packageManagerSpawnOptions('linux')).toEqual({});
  });

  it('accepts Windows-style tar entry separators', async () => {
    await expect(
      assertTarballSmoke({
        version: '0.1.1',
        buildCli: async () => {},
        pack: async () => '/tmp/arxic.tgz',
        listTarball: async () =>
          packagedFiles.map((entry) =>
            entry === 'package/dist/cli.js' ? 'package\\dist\\cli.js' : entry,
          ),
        install: async () => {},
        runCli: async (args) => {
          if (args[0] === '--version') return '0.1.1';
          if (args[0] === 'run' && args[1] === '--config') throw configFailure();
          return 'Usage: arxic';
        },
      }),
    ).resolves.toBeUndefined();
  });

  it('accepts a tarball whose CLI reports VERSION and serves help', async () => {
    await expect(
      assertTarballSmoke({
        version: '0.1.1',
        buildCli: async () => {},
        pack: async () => '/tmp/arxic.tgz',
        listTarball: async () => packagedFiles,
        install: async () => {},
        runCli: async (args) => {
          if (args[0] === '--version') return '0.1.1';
          if (args[0] === 'run' && args[1] === '--config') throw configFailure();
          return 'Usage: arxic';
        },
      }),
    ).resolves.toBeUndefined();
  });
});
