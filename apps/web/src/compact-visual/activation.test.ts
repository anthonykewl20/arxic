import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { activateModel, activeModel, rollbackModel, stageArtifact } from './activation';

const setup = async () => {
  const modelsDir = await mkdtemp(join(tmpdir(), 'visual-models-'));
  await mkdir(join(modelsDir, 'artifacts'), { recursive: true });
  return modelsDir;
};

it('activates a validated model atomically, keeps the prior known-good, and rolls back', async () => {
  const modelsDir = await setup();
  try {
    const first = await stageArtifact(modelsDir, Buffer.from('weights-v1'));
    const second = await stageArtifact(modelsDir, Buffer.from('weights-v2'));
    await activateModel(modelsDir, first, { validate: async () => {} });
    expect((await activeModel(modelsDir))!.sha256).toBe(first);
    await activateModel(modelsDir, second, { validate: async () => {} });
    const active = await activeModel(modelsDir);
    expect(active!.sha256).toBe(second);
    await rollbackModel(modelsDir);
    expect((await activeModel(modelsDir))!.sha256).toBe(first);
    // Content survives for reproducing the newer model after rollback.
    expect(await readFile(join(modelsDir, 'artifacts', second), 'utf8')).toBe('weights-v2');
  } finally {
    await rm(modelsDir, { recursive: true, force: true });
  }
});

it('refuses activation when validation or the content hash fails, leaving the active model untouched', async () => {
  const modelsDir = await setup();
  try {
    const good = await stageArtifact(modelsDir, Buffer.from('weights-v1'));
    await activateModel(modelsDir, good, { validate: async () => {} });
    const bad = await stageArtifact(modelsDir, Buffer.from('broken-weights'));
    await expect(
      activateModel(modelsDir, bad, {
        validate: async () => {
          throw new Error('parity-failed');
        },
      }),
    ).rejects.toThrow('validation-failed');
    expect((await activeModel(modelsDir))!.sha256).toBe(good);
    // Tampered artifact bytes after staging: hash no longer matches the name.
    await writeFile(join(modelsDir, 'artifacts', bad), Buffer.from('tampered'));
    await expect(activateModel(modelsDir, bad, { validate: async () => {} })).rejects.toThrow(
      'artifact-hash-mismatch',
    );
    expect((await activeModel(modelsDir))!.sha256).toBe(good);
  } finally {
    await rm(modelsDir, { recursive: true, force: true });
  }
});

it('ignores a torn activation pointer and refuses rollback without a prior model', async () => {
  const modelsDir = await setup();
  try {
    const good = await stageArtifact(modelsDir, Buffer.from('weights-v1'));
    await activateModel(modelsDir, good, { validate: async () => {} });
    // Crash artifact: a half-written pointer must never become active.
    await writeFile(join(modelsDir, 'active.json.tmp'), '{"sha256": "torn');
    const active = await activeModel(modelsDir);
    expect(active!.sha256).toBe(good);
    // No prior activation exists: rollback refuses and leaves the active model.
    await expect(rollbackModel(modelsDir)).rejects.toThrow('no-previous-model');
    expect((await activeModel(modelsDir))!.sha256).toBe(good);
  } finally {
    await rm(modelsDir, { recursive: true, force: true });
  }
});
