import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';
import { captureCorpusV2, trainCorpusV2 } from './corpus-capture';
import { validateCorpusPlan } from './corpus';

it('captures a reduced multi-family corpus with a frozen allocation and trains with native parity', async () => {
  const root = resolve(import.meta.dirname, '../../../..');
  const directory = await mkdtemp(join(tmpdir(), 'visual-corpus-live-'));
  try {
    const variants = ['clean', 'clip-full', 'clip-right-50', 'content-change', 'overflow-x'];
    const manifest = await captureCorpusV2(root, directory, ['next', 'express'], [800], variants);
    expect(manifest.cases).toHaveLength(10);
    expect(manifest.skipped).toHaveLength(0);
    // The overflow regression really overflowed its scrollport; negatives did not.
    const overflowCase = manifest.cases.find((c) => c.variant === 'overflow-x')!;
    expect(overflowCase.measuredOverflowX).toBeGreaterThan(0.5);
    expect(overflowCase.overflowLabel).toBe(1);
    expect(
      manifest.cases
        .filter((c) => c.variant !== 'overflow-x')
        .every((c) => c.measuredOverflowX === 0),
    ).toBe(true);

    // The captured allocation must equal an independently re-derived freeze of
    // the same plan (deterministic sha256 order, seed 423, families together).
    const expected = validateCorpusPlan({
      version: 1,
      families: ['next', 'express'],
      viewports: [800],
      variants,
      allocationSeed: 423,
      criterion: 'required-submit-inside-viewport',
    });
    expect(manifest.plan.frozenAllocationHash).toBe(expected.frozenAllocationHash);
    expect(manifest.plan.frozenAllocationHash).toBe(
      createHash('sha256').update(JSON.stringify(manifest.plan.allocation)).digest('hex'),
    );
    const seen = new Map<string, Set<string>>();
    for (const entry of manifest.cases) {
      const splits = seen.get(entry.family) ?? new Set<string>();
      splits.add(entry.split);
      seen.set(entry.family, splits);
      expect(splits.size).toBe(1);
      expect(entry.labelOrigin).toBe(
        entry.variant === 'clean' || entry.variant === 'content-change'
          ? 'controlled-negative'
          : 'controlled-regression',
      );
      // Direction comes from the independent measurement, never the intent.
      expect(entry.measuredClip < 1).toBe(entry.label === 1);
      expect(entry.measuredOverflowX > 0 === (entry.overflowLabel === 1)).toBe(true);
    }

    const report = await trainCorpusV2(root, directory, manifest);
    expect(report.rows).toBe(10);
    // Both labeled heads trained and calibrated on this reduced corpus.
    expect(report.training.models.mlp.training.supported[3]).toBe(true);
    expect(report.training.models.mlp.positiveThresholds[3]).not.toBeNull();
    expect(report.parityMaximumError).toBeLessThanOrEqual(1e-5);
    expect(report.promotion).toBe('blocked-experimental-model');
    expect(report.reviews.every((r) => r.overallPass === false)).toBe(true);
    // Graded and full clips keep their deterministic hard failures in every review.
    const clipReviews = manifest.cases.filter((c) => c.label === 1);
    for (const clip of clipReviews) {
      const review = report.reviews.find((r) => r.caseId === clip.manifest.replace('.json', ''));
      expect(review?.hardChecks.some((h) => h.verdict === 'fail')).toBe(true);
    }
    const dataset = JSON.parse(await readFile(join(directory, 'dataset.json'), 'utf8'));
    expect(
      dataset.every(
        (row: { features: number[]; labels: (0 | 1 | null)[] }) =>
          row.features.length === 96 && row.labels.length === 6,
      ),
    ).toBe(true);

    // Every emitted label is a contract-valid VisualLabelV1 record whose
    // adjudicated mapping matches the trainer row it produced.
    const { validateVisualLabel, toTrainingLabels } = await import('./labels');
    const provenance = JSON.parse(
      await readFile(join(directory, 'dataset-provenance.json'), 'utf8'),
    );
    const labelById = new Map(
      provenance.evidence.map((entry: { id: string; label: unknown }) => [
        entry.id,
        validateVisualLabel(entry.label),
      ]),
    );
    expect(labelById.size).toBe(report.rows);
    for (const row of dataset) {
      const record = labelById.get(row.id)!;
      expect(toTrainingLabels(record)).toEqual(row.labels);
      expect(record.labelOrigin).toBe('deterministic_predicate');
      expect(record.adjudication).toBe('adjudicated');
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 300000);
