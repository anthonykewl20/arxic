import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';
import { activateTrainedModel, activeModel, rollbackModel } from './model-store';

const execute = promisify(execFile);

async function trainInto(
  root: string,
  work: string,
  directory: string,
  epochs: string,
): Promise<{ artifact: Buffer; dataset: Buffer; report: unknown; manifestPath: string }> {
  await execute(
    process.env.ARXIC_VISUAL_PYTHON ?? 'python3',
    [
      join(root, 'scripts/visual-slm/gen_timing_dataset.py'),
      join(work, 'dataset.json'),
      '--rows',
      '60',
    ],
    { timeout: 30000 },
  );
  await execute(
    process.env.ARXIC_VISUAL_PYTHON ?? 'python3',
    [
      join(root, 'scripts/visual-slm/train.py'),
      join(work, 'dataset.json'),
      join(work, directory),
      '--epochs',
      epochs,
    ],
    { timeout: 60000, env: { PATH: process.env.PATH, PYTHONHASHSEED: '423' } },
  );
  const { sha256 } = await import('@arxic/contracts');
  const artifact = await readFile(join(work, `${directory}/mlp.bin`));
  const dataset = await readFile(join(work, 'dataset.json'));
  const report = JSON.parse(
    await readFile(join(work, `${directory}/training-report.json`), 'utf8'),
  );
  const manifestPath = `${directory}-model.json`;
  await writeFile(
    join(work, manifestPath),
    JSON.stringify({
      version: 1,
      featureSchema: 'arxic-visual-features-v1',
      artifact: { path: `${directory}/mlp.bin`, sha256: sha256(artifact) },
      thresholds: report.models.mlp.positiveThresholds,
      supported: report.models.mlp.training.supported,
      experimental: true,
      datasetSha256: sha256(dataset),
    }),
  );
  return { artifact, dataset, report, manifestPath };
}

it('activates a real trained model through the parity gate, refuses tampering, and rolls back', async () => {
  const root = resolve(import.meta.dirname, '../../../..');
  const work = await mkdtemp(join(tmpdir(), 'visual-model-store-'));
  try {
    await execute(
      process.env.ARXIC_VISUAL_RUSTC ?? 'rustc',
      ['-O', join(root, 'scripts/visual-slm/native.rs'), '-o', join(work, 'visual-native')],
      { timeout: 60000 },
    );
    const first = await trainInto(root, work, 'training-a', '3');
    const { sha256 } = await import('@arxic/contracts');
    const modelsDir = join(work, 'models');
    const native = join(work, 'visual-native');

    const firstPointer = await activateTrainedModel(work, first.manifestPath, modelsDir, native, {
      reportPath: 'training-a/training-report.json',
    });
    expect(firstPointer.sha256).toBe(sha256(first.artifact));

    // Tampered artifact bytes: the hash gate refuses, active model untouched.
    await writeFile(
      join(work, 'training-a/mlp.bin'),
      Buffer.concat([first.artifact.subarray(0, 100), Buffer.from('x')]),
    );
    await expect(
      activateTrainedModel(work, first.manifestPath, modelsDir, native, {
        reportPath: 'training-a/training-report.json',
      }),
    ).rejects.toThrow('artifact-hash-mismatch');
    expect((await activeModel(modelsDir))!.sha256).toBe(firstPointer.sha256);

    // Restored bytes but corrupted parity expectations: the gate refuses.
    await writeFile(join(work, 'training-a/mlp.bin'), first.artifact);
    const corrupted = JSON.parse(JSON.stringify(first.report));
    corrupted.models.mlp.scores[Object.keys(corrupted.models.mlp.scores)[0]][0] = 12345;
    await writeFile(
      join(work, 'training-a/training-report.json'),
      Buffer.from(JSON.stringify(corrupted)),
    );
    await expect(
      activateTrainedModel(work, first.manifestPath, modelsDir, native, {
        reportPath: 'training-a/training-report.json',
      }),
    ).rejects.toThrow('validation-failed');
    expect((await activeModel(modelsDir))!.sha256).toBe(firstPointer.sha256);

    // A second, genuinely different model activates; rollback restores the first.
    await writeFile(
      join(work, 'training-a/training-report.json'),
      Buffer.from(JSON.stringify(first.report)),
    );
    const second = await trainInto(root, work, 'training-b', '2');
    expect(sha256(second.artifact)).not.toBe(sha256(first.artifact));
    const secondPointer = await activateTrainedModel(work, second.manifestPath, modelsDir, native, {
      reportPath: 'training-b/training-report.json',
    });
    expect(secondPointer.sha256).toBe(sha256(second.artifact));
    await rollbackModel(modelsDir);
    expect((await activeModel(modelsDir))!.sha256).toBe(firstPointer.sha256);
    // Re-activating the identical second artifact is idempotent staging.
    const again = await activateTrainedModel(work, second.manifestPath, modelsDir, native, {
      reportPath: 'training-b/training-report.json',
    });
    expect(again.sha256).toBe(secondPointer.sha256);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}, 180000);
