import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';
import { captureCorpusV2, trainCorpusV2 } from './corpus-capture';
import { evaluateCorpusV2 } from './corpus-evaluate';

const sha256 = async (path: string) =>
  createHash('sha256')
    .update(await readFile(path))
    .digest('hex');

it('fails closed before capturing or writing when no trained artifact exists', async () => {
  const root = resolve(import.meta.dirname, '../../../..');
  const directory = await mkdtemp(join(tmpdir(), 'visual-evaluate-red-'));
  try {
    await expect(
      evaluateCorpusV2(root, directory, { reuseManifest: 'corpus-v2.json' }),
    ).rejects.toThrow(/no-trained-artifact/);
    // The refused path captured nothing and wrote no report.
    await expect(stat(join(directory, 'corpus-v2.json'))).rejects.toThrow();
    await expect(stat(join(directory, 'corpus-evaluation.json'))).rejects.toThrow();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it('scores a corpus against the already-trained artifact without retraining anything', async () => {
  const root = resolve(import.meta.dirname, '../../../..');
  const directory = await mkdtemp(join(tmpdir(), 'visual-evaluate-live-'));
  try {
    const variants = ['clean', 'overflow-x', 'missing-element'];
    const manifest = await captureCorpusV2(root, directory, ['next', 'express'], [800], variants);
    await trainCorpusV2(root, directory, manifest);
    const before = {
      dataset: await sha256(join(directory, 'dataset.json')),
      logistic: await sha256(join(directory, 'training/logistic.bin')),
      mlp: await sha256(join(directory, 'training/mlp.bin')),
      trainingReport: await sha256(join(directory, 'training/training-report.json')),
    };
    const evaluation = await evaluateCorpusV2(root, directory, {
      reuseManifest: 'corpus-v2.json',
    });
    // No retraining side effects: every trained artifact stays byte-identical.
    expect(await sha256(join(directory, 'dataset.json'))).toBe(before.dataset);
    expect(await sha256(join(directory, 'training/logistic.bin'))).toBe(before.logistic);
    expect(await sha256(join(directory, 'training/mlp.bin'))).toBe(before.mlp);
    expect(await sha256(join(directory, 'training/training-report.json'))).toBe(
      before.trainingReport,
    );
    // The result binds to the exact artifact that produced the scores.
    expect(evaluation.models.logisticSha256).toBe(before.logistic);
    expect(evaluation.models.mlpSha256).toBe(before.mlp);
    // All six heads are reported; only heads the artifact can score (trained
    // threshold + supported) carry cases. This minimal corpus trains
    // thresholds solely for the heads whose variants produce positive
    // examples (overflow-x, missing-element), so the other four must be
    // reported unscored — never fabricated as zero-accuracy results.
    expect(evaluation.heads).toHaveLength(6);
    for (const head of evaluation.heads) {
      expect(head.cases).toBe(
        head.truePositives + head.falsePositives + head.trueNegatives + head.falseNegatives,
      );
      if (!head.scoreable) expect(head.cases).toBe(0);
      if (head.cases > 0) expect(head.accuracy).not.toBeNull();
    }
    const scored = evaluation.heads.filter((head) => head.scoreable);
    expect(scored.length).toBeGreaterThan(0);
    expect(scored.map((head) => head.head)).toEqual(['missing_element', 'overflow']);
    for (const head of scored) expect(head.cases).toBeGreaterThan(0);
    expect(evaluation.corpusManifestSha256).toMatch(/^[a-f0-9]{64}$/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 900000);
