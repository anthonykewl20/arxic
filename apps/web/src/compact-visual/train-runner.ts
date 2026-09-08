import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sha256 } from '@arxic/contracts';
import { nativeScores, reviewCase, type ModelManifest } from './model';

const execute = promisify(execFile);

export type TrainingRow = {
  id: string;
  group: string;
  split: string;
  features: number[];
  labels: (0 | 1 | null)[];
};

/**
 * Shared training mechanics for compact-visual corpora (service block): run the
 * Python CPU trainer, compile the native kernel, verify Python/native parity on
 * every exported row, write hash-bound model manifests, and produce shadow
 * reviews. Orchestration (labels, splits, promotion policy) stays with callers;
 * the dataset itself must already be written to OUTPUT/dataset.json with its
 * sha256 passed in so both model manifests bind it.
 */
export async function runTraining(
  root: string,
  output: string,
  rows: TrainingRow[],
  reviews: { manifest: string }[],
  datasetSha256: string,
  epochs = 30,
) {
  if (!/^[a-f0-9]{64}$/.test(datasetSha256)) throw new Error('invalid-dataset-hash');
  await execute(
    process.env.ARXIC_VISUAL_PYTHON ?? 'python3',
    [
      join(root, 'scripts/visual-slm/train.py'),
      join(output, 'dataset.json'),
      join(output, 'training'),
      '--epochs',
      String(epochs),
    ],
    { timeout: 1800000, maxBuffer: 65536, env: { PATH: process.env.PATH, PYTHONHASHSEED: '423' } },
  );
  const native = join(output, 'visual-native');
  await execute(
    process.env.ARXIC_VISUAL_RUSTC ?? 'rustc',
    ['-O', join(root, 'scripts/visual-slm/native.rs'), '-o', native],
    { timeout: 60000, maxBuffer: 65536 },
  );
  const training = JSON.parse(
    await readFile(join(output, 'training/training-report.json'), 'utf8'),
  );
  let parityMaximumError = 0;
  for (const kind of ['logistic', 'mlp']) {
    const bytes = await readFile(join(output, `training/${kind}.bin`));
    // The native kernel accepts at most 128 feature rows per invocation (the
    // per-pair region bound); corpus-wide parity chunks to that bound.
    const rowFeatures = rows.map((row) => row.features);
    const nativeResults: number[][] = [];
    for (let start = 0; start < rowFeatures.length; start += 128) {
      nativeResults.push(
        ...(await nativeScores(native, bytes, rowFeatures.slice(start, start + 128))),
      );
    }
    for (const [i, scores] of nativeResults.entries())
      for (const [j, score] of scores.entries())
        parityMaximumError = Math.max(
          parityMaximumError,
          Math.abs(score - training.models[kind].scores[rows[i]!.id][j]),
        );
    const model: ModelManifest = {
      version: 1,
      featureSchema: 'arxic-visual-features-v1',
      artifact: { path: `training/${kind}.bin`, sha256: sha256(bytes) },
      thresholds: training.models[kind].positiveThresholds,
      supported: training.models[kind].training.supported,
      experimental: true,
      datasetSha256,
    };
    await writeFile(
      join(output, `${kind}-model.json`),
      Buffer.from(JSON.stringify(model, null, 2) + '\n'),
      { mode: 0o600, flag: 'wx' },
    );
  }
  if (parityMaximumError > 1e-5) throw new Error('native-parity-failed');
  const shadowReviews = [];
  for (const entry of reviews)
    shadowReviews.push(await reviewCase(output, entry.manifest, 'mlp-model.json', native));
  return { training, parityMaximumError, reviews: shadowReviews };
}
