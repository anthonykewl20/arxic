import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import {
  allocateSplits,
  evaluateOracle,
  validateCorpusPlan,
  VARIANT_IDS,
  VARIANT_REGISTRY,
  type CorpusPlan,
} from './corpus';

const plan = (over: Partial<CorpusPlan> = {}): CorpusPlan => ({
  version: 1,
  families: ['arxic', 'directus', 'express', 'koel', 'next'],
  viewports: [640, 1280],
  variants: [...VARIANT_IDS],
  allocationSeed: 423,
  criterion: 'required-submit-inside-viewport',
  ...over,
});

it('allocates the documented 60/20/20 group split deterministically with explicit rounding', () => {
  const first = allocateSplits(plan());
  const second = allocateSplits(plan());
  expect(first).toEqual(second);
  // Independent expectation: five groups sort, seed-shuffle stably by sha256(id+seed),
  // then 3 train / 1 calibration / 1 test (round(0.6*5)=3, round(0.2*5)=1, remainder 1).
  expect(first.train).toHaveLength(3);
  expect(first.calibration).toHaveLength(1);
  expect(first.test).toHaveLength(1);
  expect([...first.train, ...first.calibration, ...first.test].sort()).toEqual(
    plan().families.slice().sort(),
  );
  // Reduced two-family plans still satisfy the trainer: at least one train and one calibration.
  const reduced = allocateSplits(plan({ families: ['express', 'next'] }));
  expect(reduced.train.length).toBeGreaterThanOrEqual(1);
  expect(reduced.calibration.length).toBeGreaterThanOrEqual(1);
  expect(reduced.test).toHaveLength(0);
});

it('rejects corpus plans that cannot be split or carry unknown variants', () => {
  expect(() => validateCorpusPlan(plan({ families: ['next'] }))).toThrow('insufficient-families');
  expect(() => validateCorpusPlan(plan({ families: [] }))).toThrow('insufficient-families');
  expect(() =>
    validateCorpusPlan(plan({ variants: ['clean', 'clip-right-full', 'spin'] })),
  ).toThrow('unknown-variant');
  expect(() => validateCorpusPlan(plan({ viewports: [] }))).toThrow('invalid-viewport');
  expect(() => validateCorpusPlan(plan({ viewports: [0, 99999] }))).toThrow('invalid-viewport');
  expect(() =>
    validateCorpusPlan(plan({ families: ['next', 'next', 'express', 'koel', 'arxic'] })),
  ).toThrow('duplicate-family');
});

it('keeps every variant registry entry internally consistent', () => {
  for (const id of VARIANT_IDS) {
    const variant = VARIANT_REGISTRY[id];
    expect(variant.id).toBe(id);
    expect([0, 1]).toContain(variant.label);
    expect(variant.labelOrigin).toMatch(/^controlled-(regression|negative)$/);
    // A regression variant must move the required control; a negative must not.
    expect(Boolean(variant.moveControl)).toBe(variant.label === 1);
  }
  // The registry carries at least one graded partial clip and at least three negatives.
  expect(VARIANT_IDS.filter((id) => id.startsWith('clip-')).length).toBeGreaterThanOrEqual(4);
  expect(
    VARIANT_IDS.filter((id) => VARIANT_REGISTRY[id].label === 0).length,
  ).toBeGreaterThanOrEqual(4);
});

it('binds the frozen allocation into the manifest hash before any training', () => {
  const frozen = validateCorpusPlan(plan());
  const otherSeed = validateCorpusPlan(plan({ allocationSeed: 424 }));
  const digest = (value: unknown) =>
    createHash('sha256').update(JSON.stringify(value)).digest('hex');
  expect(frozen.frozenAllocationHash).toBe(digest(frozen.allocation));
  expect(frozen.frozenAllocationHash).not.toBe(otherSeed.frozenAllocationHash);
});

it('classifies measured clip fractions against the variant oracle independently', () => {
  // Worked expectations: clean needs clip 1; regressions need clip < 1; graded
  // clips must land within the documented 0.12 tolerance of their keep fraction.
  expect(evaluateOracle('clean', 1)).toEqual({ verdict: 'pass', ok: true });
  expect(evaluateOracle('clean', 0.9)).toEqual({
    verdict: 'fail',
    ok: false,
    reason: 'controlled-oracle-failed',
  });
  expect(evaluateOracle('clip-full', 0)).toEqual({ verdict: 'fail', ok: true });
  expect(evaluateOracle('clip-full', 1)).toEqual({
    verdict: 'pass',
    ok: false,
    reason: 'controlled-oracle-failed',
  });
  expect(evaluateOracle('clip-right-50', 0.55)).toEqual({ verdict: 'fail', ok: true });
  expect(evaluateOracle('clip-right-50', 0.7)).toEqual({
    verdict: 'fail',
    ok: false,
    reason: 'graded-clip-tolerance',
  });
  expect(evaluateOracle('content-change', 1)).toEqual({ verdict: 'pass', ok: true });
  expect(() => evaluateOracle('spin', 1)).toThrow('unknown-variant');
});
