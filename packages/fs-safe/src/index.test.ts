import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readSafeSource } from './index';

describe('readSafeSource', () => {
  it('rejects traversal, escaping links, and oversized files before reading them', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arxic-fs-safe-root-'));
    const outside = await mkdtemp(join(tmpdir(), 'arxic-fs-safe-outside-'));
    await mkdir(join(root, 'src'));
    await writeFile(join(root, 'src', 'large.ts'), 'x'.repeat(129));
    await writeFile(join(outside, 'secret.ts'), 'DO_NOT_READ');
    await symlink(join(outside, 'secret.ts'), join(root, 'src', 'escape.ts'));

    await expect(readSafeSource(root, '../outside.ts', 128)).resolves.toMatchObject({
      ok: false,
      kind: 'unsafe',
      sizeBytes: 0,
    });
    await expect(readSafeSource(root, 'src/escape.ts', 128)).resolves.toMatchObject({
      ok: false,
      kind: 'unsafe',
      detail: expect.stringContaining('escapes resolved source root'),
    });
    await expect(readSafeSource(root, 'src/large.ts', 128)).resolves.toEqual({
      ok: false,
      kind: 'oversize',
      sizeBytes: 129,
      detail: '129 bytes exceeds quota 128.',
    });
  });

  it('returns the exact bounded bytes and size for a regular in-root file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arxic-fs-safe-root-'));
    await writeFile(join(root, 'safe.ts'), 'export const safe = true;\n');
    await expect(readSafeSource(root, 'safe.ts', 128)).resolves.toMatchObject({
      ok: true,
      bytes: Buffer.from('export const safe = true;\n'),
      sizeBytes: 26,
    });
  });
});
