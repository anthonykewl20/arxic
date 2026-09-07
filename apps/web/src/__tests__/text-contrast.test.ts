import { expect, it } from 'vitest';
import { assessTextContrast, type TextPaint } from '../text-contrast';

const paint: TextPaint = {
  id: 0,
  box: { x: 8, y: 8, width: 80, height: 20 },
  foreground: [119, 119, 119],
  background: [255, 255, 255],
  fontSize: 16,
  fontWeight: 400,
  unavailable: null,
};
it('does not round a below-threshold pair into a pass', () => {
  const check = assessTextContrast([paint], true)[0];
  expect(check.verdict).toBe('fail');
  expect(check.observed).toBeCloseTo(4.478089453577214, 12);
  expect(check.threshold).toBe(4.5);
});
it('keeps unsupported paint and unstable evidence unverified', () => {
  expect(assessTextContrast([{ ...paint, unavailable: 'complex-paint' }], true)[0].verdict).toBe(
    'unverified',
  );
  expect(assessTextContrast([paint], false)[0].verdict).toBe('unverified');
});
it('uses large-text thresholds only at the actual CSS pixel and bold boundaries', () => {
  const inputs = [
    { ...paint, fontSize: 24 },
    { ...paint, fontSize: 23.99 },
    { ...paint, fontSize: 56 / 3, fontWeight: 700 },
    { ...paint, fontSize: 18.66, fontWeight: 700 },
    { ...paint, fontSize: 20, fontWeight: 699 },
  ];
  expect(
    assessTextContrast(
      inputs.map((value, id) => ({ ...value, id })),
      true,
    ).map((c) => c.verdict),
  ).toEqual(['pass', 'fail', 'pass', 'fail', 'fail']);
});
it('measures black and white without making a whole-page claim', () => {
  expect(assessTextContrast([{ ...paint, foreground: [0, 0, 0] }], true)[0]).toMatchObject({
    verdict: 'pass',
    observed: 21,
    threshold: 4.5,
  });
});

it('rejects malformed and duplicate measurement records', () => {
  for (const records of [
    [{ ...paint, fontSize: NaN }],
    [paint, paint],
    [{ ...paint, foreground: [300, 0, 0] }],
  ]) {
    expect(
      assessTextContrast(records as TextPaint[], true).every((c) => c.verdict === 'unverified'),
    ).toBe(true);
  }
});
