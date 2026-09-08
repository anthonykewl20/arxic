import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
import { loadVisualCase, validateCase } from './evidence';

it('rejects incomplete, unknown and unsafe evidence before opening images', async () => {
  for (const input of [null, {}, { version: 1, verified: true }, { images: ['../secret'] }]) {
    expect(() => validateCase(input)).toThrow('invalid-case');
  }
  const root = await mkdtemp(join(tmpdir(), 'visual-case-'));
  try {
    await writeFile(join(root, 'case.json'), '{"version":1}');
    await expect(loadVisualCase(root, 'case.json')).rejects.toThrow('invalid-case');
    await expect(loadVisualCase(root, '../case.json')).rejects.toThrow('unsafe-path');
    await writeFile(join(root, 'large.json'), ' '.repeat(1024 * 1024 + 1));
    await expect(loadVisualCase(root, 'large.json')).rejects.toThrow('file-bound');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
