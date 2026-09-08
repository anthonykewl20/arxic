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
    const variants = [
      'clean',
      'clip-full',
      'clip-right-50',
      'content-change',
      'overflow-x',
      'occlusion-overlay',
      'missing-element',
      'text-truncate',
      'layout-shift',
    ];
    const manifest = await captureCorpusV2(root, directory, ['next', 'express'], [800], variants);
    expect(manifest.cases).toHaveLength(18);
    expect(manifest.skipped).toHaveLength(0);
    // The overflow regression really overflowed its scrollport; negatives did not.
    const overflowCase = manifest.cases.find((c) => c.variant === 'overflow-x')!;
    expect(overflowCase.measuredOverflowX).toBeGreaterThan(0.5);
    expect(overflowCase.labels[3]).toBe(1);
    expect(
      manifest.cases
        .filter((c) => c.variant !== 'overflow-x')
        .every((c) => c.measuredOverflowX === 0),
    ).toBe(true);
    // The four new heads carry their exact controlled label vectors.
    expect(manifest.cases.find((c) => c.variant === 'occlusion-overlay')!.labels).toEqual([
      0, 1, 0, 0, 0, 0,
    ]);
    expect(manifest.cases.find((c) => c.variant === 'missing-element')!.labels).toEqual([
      null,
      null,
      1,
      0,
      0,
      null,
    ]);
    expect(manifest.cases.find((c) => c.variant === 'text-truncate')!.labels).toEqual([
      0, 0, 0, 0, 1, 0,
    ]);
    expect(manifest.cases.find((c) => c.variant === 'layout-shift')!.labels).toEqual([
      0, 0, 0, 0, 0, 1,
    ]);

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
      // Direction comes from the independent measurement, never the intent;
      // heads that are not applicable (null) make no claim.
      if (entry.labels[0] !== null) expect(entry.measuredClip! < 1).toBe(entry.labels[0] === 1);
      if (entry.labels[0] === null) expect(entry.measuredClip).toBeNull();
      expect(entry.measuredOverflowX > 0 === (entry.labels[3] === 1)).toBe(true);
    }

    const report = await trainCorpusV2(root, directory, manifest);
    expect(report.rows).toBe(18);
    // All six heads carry positives and negatives on this corpus, so every
    // head trains. Calibration is a different question: the new-head rows are
    // hard negatives for clipping (moved/occluded/removed controls), and a
    // reduced two-family corpus cannot separate them — those heads honestly
    // stay disabled (null threshold) instead of shipping a miscalibrated one.
    // Training is seeded, so the qualifying set is deterministic here.
    expect(report.training.models.mlp.training.supported.every((s: boolean) => s)).toBe(true);
    const thresholds = report.training.models.mlp.positiveThresholds as (number | null)[];
    for (const head of [1, 2, 3]) expect(thresholds[head]).not.toBeNull();
    for (const head of [0, 4, 5]) expect(thresholds[head]).toBeNull();
    expect(report.parityMaximumError).toBeLessThanOrEqual(1e-5);
    expect(report.promotion).toBe('blocked-experimental-model');
    expect(report.reviews.every((r) => r.overallPass === false)).toBe(true);
    // Graded and full clips keep their deterministic hard failures in every review.
    const clipReviews = manifest.cases.filter((c) => c.labels[0] === 1);
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
    const labelById = new Map<string, import('./labels').VisualLabel>(
      provenance.evidence.map(
        (entry: { id: string; label: unknown }): [string, import('./labels').VisualLabel] => [
          entry.id,
          validateVisualLabel(entry.label),
        ],
      ),
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
