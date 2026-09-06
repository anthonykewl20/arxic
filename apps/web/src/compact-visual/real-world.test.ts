import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';
import { captureCorpus, trainCorpus } from './workflow';
import { loadVisualCase } from './evidence';
import { reviewCase } from './model';

it('rejects altered real screenshots then trains and compares actual native inference across held-out apps', async () => {
  const root = resolve(import.meta.dirname, '../../../..');
  const directory = await mkdtemp(join(tmpdir(), 'visual-live-'));
  try {
    const corpus = await captureCorpus(root, directory, [800]);
    const file = join(directory, corpus.cases[0]!.manifest);
    const manifest = JSON.parse(await readFile(file, 'utf8'));
    const imagePath = join(directory, manifest.before.path);
    const original = await readFile(imagePath);
    await writeFile(imagePath, Buffer.from('changed image'));
    await expect(loadVisualCase(directory, corpus.cases[0]!.manifest)).rejects.toThrow(
      'evidence-hash-mismatch',
    );
    await writeFile(imagePath, original);
    const privacyPath = join(directory, manifest.currentPrivacy.path);
    const privacyBytes = await readFile(privacyPath);
    await writeFile(privacyPath, '{}');
    await expect(loadVisualCase(directory, corpus.cases[0]!.manifest)).rejects.toThrow(
      'evidence-hash-mismatch',
    );
    await writeFile(privacyPath, privacyBytes);
    const report = await trainCorpus(root, directory, corpus, 3);
    expect(report.parityMaximumError).toBeLessThanOrEqual(1e-5);
    expect(report.rows).toBe(6);
    expect(report.reviews.every((r) => r.overallPass === false)).toBe(true);
    expect(
      report.reviews.filter((r) => r.hardChecks.some((h) => h.verdict === 'fail')),
    ).toHaveLength(3);
    await writeFile(join(directory, 'training/mlp.bin'), Buffer.from('altered weights'));
    await expect(
      reviewCase(directory, corpus.cases[0]!.manifest, 'mlp-model.json', '/does-not-exist'),
    ).rejects.toThrow('model-hash-mismatch');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 300000);
