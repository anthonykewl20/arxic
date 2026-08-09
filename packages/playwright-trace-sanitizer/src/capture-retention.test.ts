import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { retainCaptureArtifacts } from './capture-retention';

describe('capture artifact retention service', () => {
  it('returns a structured failure instead of throwing when discovery fails', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'arxic-capture-service-'));
    const invalidRoot = join(workspace, 'not-a-directory');
    await writeFile(invalidRoot, 'ordinary file');

    await expect(
      retainCaptureArtifacts({
        roots: [invalidRoot],
        destination: join(workspace, 'retained'),
      }),
    ).resolves.toMatchObject({
      ok: false,
      code: 'CAPTURE_FAILED',
      message: 'Artifact discovery root must be a real directory',
    });
  });

  it('returns structured refs for an empty capture', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'arxic-capture-service-'));

    await expect(
      retainCaptureArtifacts({
        roots: [join(workspace, 'absent')],
        destination: join(workspace, 'retained'),
      }),
    ).resolves.toEqual({ ok: true, refs: [] });
  });
});
