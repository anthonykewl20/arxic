import { execFile } from 'node:child_process';
import { mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { hashSourceTree } from './source-tree-hash';

const execute = promisify(execFile);

describe('hashSourceTree', () => {
  it('changes when one staged source file byte changes', async () => {
    const root = await repository();
    await writeFile(join(root, 'source.ts'), 'first\n');
    const first = await hashSourceTree(root);
    await writeFile(join(root, 'source.ts'), 'second\n');
    const second = await hashSourceTree(root);
    expect(second.sourceSha256).not.toBe(first.sourceSha256);
    expect(second.manifest[0]?.blobSha256).not.toBe(first.manifest[0]?.blobSha256);
  });

  it('hashes empty source deterministically', async () => {
    const root = await repository();
    expect(await hashSourceTree(root)).toEqual(await hashSourceTree(root));
    expect((await hashSourceTree(root)).manifest).toEqual([]);
  });

  it('hashes large real bytes deterministically without omitting them', async () => {
    const root = await repository();
    const bytes = Buffer.alloc(2 * 1024 * 1024, 0xa5);
    await writeFile(join(root, 'large.bin'), bytes);
    const first = await hashSourceTree(root);
    const second = await hashSourceTree(root);
    expect(second).toEqual(first);
    expect(first.manifest[0]?.sizeBytes).toBe(bytes.length);
  });

  it('binds a symlink as link-text bytes without following its target', async () => {
    const root = await repository();
    await writeFile(join(root, 'target.ts'), 'export const value = 1;\n');
    await symlink('target.ts', join(root, 'alias.ts'));
    const first = await hashSourceTree(root);
    await writeFile(join(root, 'target.ts'), 'export const value = 2;\n');
    const second = await hashSourceTree(root);
    expect(second.manifest.find(({ path }) => path === 'alias.ts')).toEqual(
      first.manifest.find(({ path }) => path === 'alias.ts'),
    );
    expect(second.sourceSha256).not.toBe(first.sourceSha256);
  });
});

async function repository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'arxic-source-tree-'));
  await execute('git', ['init', '--quiet', root]);
  return root;
}
