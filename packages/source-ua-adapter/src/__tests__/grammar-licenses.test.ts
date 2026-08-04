import { access, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);

describe('grammar license verification', () => {
  it('verifies each installed grammar package independently as MIT with a license file', async () => {
    for (const name of ['tree-sitter-javascript', 'tree-sitter-typescript']) {
      const packagePath = require.resolve(`${name}/package.json`);
      const pkg = JSON.parse(await readFile(packagePath, 'utf8')) as { license?: string };
      expect(pkg.license, name).toBe('MIT');
      await expect(access(join(dirname(packagePath), 'LICENSE'))).resolves.toBeUndefined();
    }
  });
});
