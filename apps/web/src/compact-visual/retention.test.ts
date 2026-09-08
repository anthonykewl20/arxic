import { mkdir, mkdtemp, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { enforceRetention } from './retention';

const ago = async (path: string, days: number) =>
  utimes(path, new Date(Date.now() - days * 86400_000), new Date(Date.now() - days * 86400_000));

it('evicts oldest files first until the byte cap holds, never touching paths outside the spool', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'visual-retention-'));
  try {
    await writeFile(join(dir, 'old.bin'), Buffer.alloc(600));
    await writeFile(join(dir, 'new.bin'), Buffer.alloc(600));
    await ago(join(dir, 'old.bin'), 9);
    await ago(join(dir, 'new.bin'), 1);
    const result = await enforceRetention(dir, { byteCap: 1024, pins: [] });
    expect(result.deleted.map((entry) => entry.path)).toEqual(['old.bin']);
    expect(result.bytesAfter).toBe(600);
    await expect(stat(join(dir, 'old.bin'))).rejects.toThrow();
    await expect(stat(join(dir, 'new.bin'))).resolves.toBeTruthy();
    expect(result.reason).toBeNull();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it('never deletes pinned evidence; unreclaimable pins are reported, not silently dropped', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'visual-retention-'));
  try {
    await writeFile(join(dir, 'pinned-old.bin'), Buffer.alloc(900));
    await writeFile(join(dir, 'pinned-new.bin'), Buffer.alloc(900));
    await writeFile(join(dir, 'free.bin'), Buffer.alloc(100));
    await ago(join(dir, 'pinned-old.bin'), 9);
    await ago(join(dir, 'pinned-new.bin'), 8);
    await ago(join(dir, 'free.bin'), 1);
    const result = await enforceRetention(dir, {
      byteCap: 1024,
      pins: ['pinned-old.bin', 'pinned-new.bin'],
    });
    // The only unpinned file is deleted, then the cap still cannot hold:
    // the report says so; pinned bytes remain on disk untouched.
    expect(result.deleted.map((entry) => entry.path)).toEqual(['free.bin']);
    expect(result.reason).toBe('pinned-exceeds-cap');
    await expect(stat(join(dir, 'pinned-old.bin'))).resolves.toBeTruthy();
    await expect(stat(join(dir, 'pinned-new.bin'))).resolves.toBeTruthy();
    expect(result.pinnedBytes).toBe(1800);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it('rejects unsafe spool paths and pin references outside the spool', async () => {
  const root = await mkdtemp(join(tmpdir(), 'visual-retention-'));
  try {
    // The filesystem root would put arbitrary system files in scope.
    await expect(enforceRetention('/', { byteCap: 1, pins: [] })).rejects.toThrow('unsafe-path');
    await mkdir(join(root, 'spool'));
    await writeFile(join(root, 'spool', 'a.bin'), Buffer.alloc(10));
    await expect(
      enforceRetention(join(root, 'spool'), { byteCap: 1, pins: ['../secret.bin'] }),
    ).rejects.toThrow('unsafe-path');
    await expect(
      enforceRetention(join(root, 'spool'), { byteCap: 1, pins: ['/etc/passwd'] }),
    ).rejects.toThrow('unsafe-path');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
