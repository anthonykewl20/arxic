import { expect, it } from 'vitest';
import { comparePerceptual, describeDifference } from '../perceptual-diff';

const WIDTH = 64;
const HEIGHT = 64;

function canvas(fill: [number, number, number] = [255, 255, 255]) {
  const bytes = new Uint8Array(WIDTH * HEIGHT * 4);
  for (let i = 0; i < WIDTH * HEIGHT; i++) {
    bytes[i * 4] = fill[0];
    bytes[i * 4 + 1] = fill[1];
    bytes[i * 4 + 2] = fill[2];
    bytes[i * 4 + 3] = 255;
  }
  return bytes;
}

function box(
  bytes: Uint8Array,
  { x, y, width, height }: { x: number; y: number; width: number; height: number },
  fill: [number, number, number],
) {
  for (let row = y; row < y + height; row++)
    for (let column = x; column < x + width; column++) {
      const p = (row * WIDTH + column) * 4;
      bytes[p] = fill[0];
      bytes[p + 1] = fill[1];
      bytes[p + 2] = fill[2];
    }
  return bytes;
}

/** Changed-pixel ratio, the measure pixelmatch already reports. */
function changedRatio(a: Uint8Array, b: Uint8Array) {
  let changed = 0;
  for (let i = 0; i < WIDTH * HEIGHT; i++) {
    const p = i * 4;
    if (a[p] !== b[p] || a[p + 1] !== b[p + 1] || a[p + 2] !== b[p + 2]) changed++;
  }
  return changed / (WIDTH * HEIGHT);
}

it('scores an identical image as perfectly similar', () => {
  const image = box(canvas(), { x: 8, y: 8, width: 20, height: 20 }, [10, 20, 30]);
  const result = comparePerceptual(image, image, WIDTH, HEIGHT);
  expect(result.ssim).toBe(1);
  expect(result.minSsim).toBe(1);
  expect(result.degradedWindows).toBe(0);
});

it('separates a whole-page tint from a localised edit that changes the same pixel count', () => {
  const base = box(canvas(), { x: 8, y: 8, width: 32, height: 32 }, [40, 40, 40]);

  // Every pixel shifted one step: the widest possible change, structurally nil.
  const tinted = canvas([252, 252, 252]);
  box(tinted, { x: 8, y: 8, width: 32, height: 32 }, [37, 37, 37]);

  // A quarter of the page replaced outright: far fewer pixels, real structure.
  const edited = box(canvas(), { x: 8, y: 8, width: 32, height: 32 }, [40, 40, 40]);
  box(edited, { x: 0, y: 0, width: 32, height: 32 }, [255, 0, 0]);

  const tint = comparePerceptual(base, tinted, WIDTH, HEIGHT);
  const edit = comparePerceptual(base, edited, WIDTH, HEIGHT);

  // The tint touches strictly more pixels…
  expect(changedRatio(base, tinted)).toBeGreaterThan(changedRatio(base, edited));
  // …yet is structurally far closer, which is the whole point of the measure.
  expect(tint.ssim!).toBeGreaterThan(edit.ssim!);
  expect(tint.degradedWindows!).toBeLessThan(edit.degradedWindows!);
});

it('finds the worst window even when the page as a whole barely moves', () => {
  const base = canvas();
  const spotted = box(canvas(), { x: 24, y: 24, width: 10, height: 10 }, [0, 0, 0]);
  const result = comparePerceptual(base, spotted, WIDTH, HEIGHT);
  // Averaged over the page the change is small…
  expect(result.ssim!).toBeGreaterThan(0.5);
  // …but the window over the spot is unmistakable.
  expect(result.minSsim!).toBeLessThan(0.2);
  expect(result.degradedWindows!).toBeGreaterThan(0);
  expect(result.degradedWindows!).toBeLessThan(0.5);
});

it('sees a change straddling a window boundary', () => {
  // Windows step by half their width precisely so this is not missed.
  const base = canvas();
  const straddling = box(canvas(), { x: 6, y: 6, width: 4, height: 4 }, [0, 0, 0]);
  const result = comparePerceptual(base, straddling, WIDTH, HEIGHT);
  expect(result.minSsim!).toBeLessThan(0.9);
});

it('ignores an alpha-only difference, because luminance is what is compared', () => {
  const base = canvas();
  const transparent = canvas();
  for (let i = 3; i < transparent.length; i += 4) transparent[i] = 128;
  expect(comparePerceptual(base, transparent, WIDTH, HEIGHT).ssim).toBe(1);
});

it('reports nothing for an image smaller than one window', () => {
  const tiny = new Uint8Array(4 * 4 * 4);
  expect(comparePerceptual(tiny, tiny, 4, 4)).toEqual({});
});

it('describes the shape of a difference without judging it', () => {
  // Wide and shallow: a token or theme change.
  expect(describeDifference({ ssim: 0.99, minSsim: 0.97, degradedWindows: 0 }, 0.8)).toBe(
    'uniform',
  );
  // Narrow and deep: one component changed.
  expect(describeDifference({ ssim: 0.94, minSsim: 0.1, degradedWindows: 0.05 }, 0.02)).toBe(
    'localised',
  );
  // Both: a large part of the page is structurally different.
  expect(describeDifference({ ssim: 0.4, minSsim: 0.02, degradedWindows: 0.6 }, 0.7)).toBe(
    'substantial',
  );
  // Nothing measured, nothing claimed.
  expect(describeDifference({}, 0.5)).toBeUndefined();
});
