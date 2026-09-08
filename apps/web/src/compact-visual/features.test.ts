import { expect, it } from 'vitest';
import { regionFeatures } from './features';

it('does not confuse excluded pixels and missing measurements with unchanged evidence', () => {
  const data = Buffer.alloc(4 * 4 * 4, 255);
  const empty = { box: null, clip: null, hit: null, overflowX: null, overflowY: null };
  const result = regionFeatures({
    before: data,
    current: data,
    changed: Buffer.alloc(64),
    width: 4,
    height: 4,
    valid: new Uint8Array(16),
    region: { x: 0, y: 0, width: 4, height: 4 },
    beforeMeasurement: empty,
    currentMeasurement: empty,
    viewport: { width: 4, height: 4 },
  });
  expect(result.values).toEqual(Array(96).fill(0));
  expect(result.usable).toBe(false);
});

it('keeps measured zero distinct from missing and matches a hand-calculated black-to-white cell', () => {
  const black = Buffer.alloc(64),
    white = Buffer.alloc(64, 255);
  for (let p = 0; p < 16; p++) black[p * 4 + 3] = 255;
  const empty = { box: null, clip: null, hit: null, overflowX: null, overflowY: null };
  const result = regionFeatures({
    before: black,
    current: white,
    changed: white,
    width: 4,
    height: 4,
    valid: new Uint8Array(16).fill(1),
    region: { x: 0, y: 0, width: 4, height: 4 },
    beforeMeasurement: { ...empty, clip: 0 },
    currentMeasurement: empty,
    viewport: { width: 4, height: 4 },
  });
  expect(result.values[8]).toBe(0);
  expect(result.values[24]).toBe(1);
  expect(result.values[25]).toBe(0);
  expect(result.values.slice(32, 36)).toEqual([1, 0, 1, 1]);
  expect(result.usable).toBe(true);
});
