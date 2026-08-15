import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
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

  it('preserves the pre-extraction manifest bytes and source digest for a real staged tree', async () => {
    const root = await repository();
    await writeFile(join(root, 'z.ts'), 'export const z = true;\n');
    await writeFile(join(root, 'a.ts'), 'export const a = true;\n');
    const actual = await hashSourceTree(root);
    const oldBytes = Buffer.from(`${oldCanonicalPipelineJson(actual.manifest)}\n`, 'utf8');
    expect(actual.sourceSha256).toBe(createHash('sha256').update(oldBytes).digest('hex'));
  });
});

async function repository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'arxic-source-tree-'));
  await execute('git', ['init', '--quiet', root]);
  return root;
}

function oldCanonicalPipelineJson(value: unknown): string {
  const encoded = JSON.stringify(oldSortValue(value));
  if (encoded === undefined) throw new Error('PipelineResult is not JSON serializable');
  return encoded;
}

function oldSortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(oldSortValue);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, oldSortValue(item)]),
    );
  }
  return value;
}
