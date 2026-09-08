import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import {
  addressedHeads,
  allocateSplits,
  DEFECT_HEADS,
  evaluateLayoutShiftOracle,
  evaluateMissingOracle,
  evaluateOcclusionOracle,
  evaluateOracle,
  evaluateOverflowOracle,
  evaluateTextTruncationOracle,
  LAYOUT_SHIFT_MIN_PX,
  TEXT_TRUNCATION_TOLERANCE_PX,
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

it('keeps every variant registry entry internally consistent across heads', () => {
  for (const id of VARIANT_IDS) {
    const variant = VARIANT_REGISTRY[id];
    expect(variant.id).toBe(id);
    expect(variant.labels).toHaveLength(DEFECT_HEADS.length);
    // Heads that cannot be measured for a case (e.g. clipping when the control
    // is removed) stay null = not applicable; every addressed head is labeled.
    expect(variant.labelOrigin).toMatch(/^controlled-(regression|negative)$/);
    // A clipping regression or a layout-shift regression moves the required
    // control; every other variant must leave it in place (or remove it whole).
    expect(Boolean(variant.moveControl)).toBe(variant.labels[0] === 1 || variant.labels[5] === 1);
    // Every variant addresses at least one head; addressed heads are labeled 0/1.
    expect(addressedHeads(id).length).toBeGreaterThanOrEqual(1);
    for (const head of addressedHeads(id)) {
      expect([0, 1]).toContain(variant.labels[head]);
    }
  }
  // Graded partial clips, negatives, and at least one overflow regression exist.
  expect(VARIANT_IDS.filter((id) => id.startsWith('clip-')).length).toBeGreaterThanOrEqual(4);
  expect(
    VARIANT_IDS.filter((id) => VARIANT_REGISTRY[id].labels[0] === 0).length,
  ).toBeGreaterThanOrEqual(4);
  expect(
    VARIANT_IDS.filter((id) => VARIANT_REGISTRY[id].labels[3] === 1).length,
  ).toBeGreaterThanOrEqual(1);
});

it('labels all six defect heads with a positive and a negative variant each', () => {
  expect(DEFECT_HEADS).toEqual([
    'clipping',
    'occlusion',
    'missing_element',
    'overflow',
    'text_truncation',
    'layout_shift',
  ]);
  for (const head of DEFECT_HEADS.keys()) {
    expect(
      VARIANT_IDS.filter((id) => VARIANT_REGISTRY[id].labels[head] === 1).length,
      `head ${DEFECT_HEADS[head]} needs a controlled regression`,
    ).toBeGreaterThanOrEqual(1);
    expect(
      VARIANT_IDS.filter((id) => VARIANT_REGISTRY[id].labels[head] === 0).length,
      `head ${DEFECT_HEADS[head]} needs a controlled negative`,
    ).toBeGreaterThanOrEqual(1);
  }
  // The four new-head regressions label every other measurable head negative.
  expect(VARIANT_REGISTRY['occlusion-overlay'].labels).toEqual([0, 1, 0, 0, 0, 0]);
  expect(VARIANT_REGISTRY['missing-element'].labels).toEqual([null, null, 1, 0, 0, null]);
  expect(VARIANT_REGISTRY['text-truncate'].labels).toEqual([0, 0, 0, 0, 1, 0]);
  expect(VARIANT_REGISTRY['layout-shift'].labels).toEqual([0, 0, 0, 0, 0, 1]);
});

it('classifies measured occlusion hit-tests against the occlusion oracle independently', () => {
  expect(evaluateOcclusionOracle('occlusion-overlay', true)).toEqual({
    verdict: 'fail',
    ok: true,
  });
  expect(evaluateOcclusionOracle('occlusion-overlay', false)).toEqual({
    verdict: 'pass',
    ok: false,
    reason: 'occlusion-oracle-failed',
  });
  expect(evaluateOcclusionOracle('clean', false)).toEqual({ verdict: 'pass', ok: true });
  expect(evaluateOcclusionOracle('clean', true)).toEqual({
    verdict: 'fail',
    ok: false,
    reason: 'occlusion-oracle-failed',
  });
  expect(() => evaluateOcclusionOracle('spin', false)).toThrow('unknown-variant');
});

it('classifies control presence against the missing-element oracle independently', () => {
  expect(evaluateMissingOracle('missing-element', false)).toEqual({ verdict: 'fail', ok: true });
  expect(evaluateMissingOracle('missing-element', true)).toEqual({
    verdict: 'pass',
    ok: false,
    reason: 'missing-oracle-failed',
  });
  expect(evaluateMissingOracle('clean', true)).toEqual({ verdict: 'pass', ok: true });
  expect(evaluateMissingOracle('clean', false)).toEqual({
    verdict: 'fail',
    ok: false,
    reason: 'missing-oracle-failed',
  });
});

it('classifies measured text overflow beyond the truncation tolerance independently', () => {
  expect(evaluateTextTruncationOracle('text-truncate', TEXT_TRUNCATION_TOLERANCE_PX + 1)).toEqual({
    verdict: 'fail',
    ok: true,
  });
  // At or below the tolerance no truncation is measured: for a regression
  // variant that means the mutation did not take, which is an oracle failure.
  expect(evaluateTextTruncationOracle('text-truncate', TEXT_TRUNCATION_TOLERANCE_PX)).toEqual({
    verdict: 'pass',
    ok: false,
    reason: 'text-truncation-oracle-failed',
  });
  expect(evaluateTextTruncationOracle('clean', 0)).toEqual({ verdict: 'pass', ok: true });
  expect(evaluateTextTruncationOracle('clean', 40)).toEqual({
    verdict: 'fail',
    ok: false,
    reason: 'text-truncation-oracle-failed',
  });
});

it('classifies measured control-box movement against the layout-shift oracle independently', () => {
  expect(evaluateLayoutShiftOracle('layout-shift', LAYOUT_SHIFT_MIN_PX, 0)).toEqual({
    verdict: 'fail',
    ok: true,
  });
  expect(evaluateLayoutShiftOracle('layout-shift', 0, LAYOUT_SHIFT_MIN_PX + 5)).toEqual({
    verdict: 'fail',
    ok: true,
  });
  expect(evaluateLayoutShiftOracle('layout-shift', LAYOUT_SHIFT_MIN_PX - 1, 2)).toEqual({
    verdict: 'pass',
    ok: false,
    reason: 'layout-shift-oracle-failed',
  });
  expect(evaluateLayoutShiftOracle('clean', 0, 0)).toEqual({ verdict: 'pass', ok: true });
  expect(evaluateLayoutShiftOracle('clean', 30, 30)).toEqual({
    verdict: 'fail',
    ok: false,
    reason: 'layout-shift-oracle-failed',
  });
});

it('classifies measured scrollport overflow against the overflow oracle independently', () => {
  expect(evaluateOverflowOracle('clean', 0, 0)).toEqual({ verdict: 'pass', ok: true });
  expect(evaluateOverflowOracle('overflow-x', 0.9, 0)).toEqual({ verdict: 'fail', ok: true });
  expect(evaluateOverflowOracle('overflow-x', 0, 0.4)).toEqual({ verdict: 'fail', ok: true });
  expect(evaluateOverflowOracle('overflow-x', 0, 0)).toEqual({
    verdict: 'pass',
    ok: false,
    reason: 'overflow-oracle-failed',
  });
  expect(evaluateOverflowOracle('clean', 0.5, 0)).toEqual({
    verdict: 'fail',
    ok: false,
    reason: 'overflow-oracle-failed',
  });
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
