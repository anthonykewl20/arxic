import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readArtifactWithinQuota, type ArtifactReadBudget } from '../artifact-quota';

const directories: string[] = [];

async function artifact(name: string, bytes: number): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'arxic-artifact-quota-'));
  directories.push(directory);
  const path = join(directory, name);
  await writeFile(path, Buffer.alloc(bytes, 0x61));
  return path;
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('streaming artifact quota service', () => {
  it('rejects a single oversized file before retaining the over-limit chunk', async () => {
    const budget: ArtifactReadBudget = { totalBytes: 0, fileCount: 1 };
    const result = await readArtifactWithinQuota(await artifact('large.bin', 65_537), budget, {
      perFileBytes: 65_536,
      totalBytes: 1_000_000,
    });
    expect(result).toEqual({ accepted: false, reason: 'file-size', budget });
    expect(budget.totalBytes).toBe(65_536);
  });

  it('checks cumulative bytes on every chunk across files', async () => {
    const budget: ArtifactReadBudget = { totalBytes: 0, fileCount: 1 };
    const first = await readArtifactWithinQuota(await artifact('first.bin', 65_536), budget, {
      perFileBytes: 100_000,
      totalBytes: 65_536,
    });
    expect(first.accepted).toBe(true);
    budget.fileCount += 1;
    const second = await readArtifactWithinQuota(await artifact('second.bin', 1), budget, {
      perFileBytes: 100_000,
      totalBytes: 65_536,
    });
    expect(second).toEqual({ accepted: false, reason: 'total-bytes', budget });
    expect(budget).toEqual({ totalBytes: 65_536, fileCount: 2 });
  });
});
