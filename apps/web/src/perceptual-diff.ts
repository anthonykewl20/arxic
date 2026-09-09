/**
 * Structural similarity, alongside the pixel count.
 *
 * pixelmatch answers "how many pixels differ", and keeps owning the comparison
 * verdict. It cannot distinguish a whole page nudged half a shade — millions of
 * barely-different pixels — from one control that changed completely. Those two
 * results have the same changed-pixel count and mean opposite things to a
 * reviewer.
 *
 * SSIM compares local luminance, contrast and structure over a sliding window,
 * so a uniform tint scores close to 1 while a genuine structural edit scores
 * far below it. It is reported as evidence, never as a gate: nothing here
 * changes whether a capture counts as changed.
 */

/** Standard SSIM stabilisers for 8-bit data (Wang et al. 2004): (0.01·255)², (0.03·255)². */
const C1 = 6.5025;
const C2 = 58.5225;
/** 8×8 windows: small enough to localise a change, large enough for stable statistics. */
const WINDOW = 8;

/**
 * Rec. 709 luma. SSIM is defined on luminance; comparing channels separately
 * would report a hue-only change three times over.
 */
function luma(rgba: Uint8Array, width: number, height: number): Float64Array {
  const out = new Float64Array(width * height);
  for (let i = 0, p = 0; i < out.length; i++, p += 4)
    out[i] = 0.2126 * rgba[p]! + 0.7152 * rgba[p + 1]! + 0.0722 * rgba[p + 2]!;
  return out;
}

export type PerceptualComparison = {
  /**
   * Mean structural similarity over every window. 1 is identical; lower is
   * structurally further apart. Undefined when the image is smaller than one
   * window, where the measure is not meaningful.
   */
  ssim?: number;
  /** The least similar window, which is where a localised change shows up. */
  minSsim?: number;
  /**
   * Fraction of windows below 0.9 — a localised edit affects few windows badly,
   * while a global tint affects every window slightly.
   */
  degradedWindows?: number;
};

/**
 * Mean and worst-window SSIM between two same-sized RGBA buffers.
 *
 * Windows step by half their width, so a change straddling a boundary is still
 * seen whole by a neighbouring window.
 */
export function comparePerceptual(
  baseline: Uint8Array,
  current: Uint8Array,
  width: number,
  height: number,
): PerceptualComparison {
  if (width < WINDOW || height < WINDOW) return {};
  const a = luma(baseline, width, height);
  const b = luma(current, width, height);
  const step = WINDOW / 2;
  let total = 0;
  let windows = 0;
  let worst = 1;
  let degraded = 0;
  for (let top = 0; top + WINDOW <= height; top += step) {
    for (let left = 0; left + WINDOW <= width; left += step) {
      let sumA = 0;
      let sumB = 0;
      let sumAA = 0;
      let sumBB = 0;
      let sumAB = 0;
      for (let y = top; y < top + WINDOW; y++) {
        const row = y * width;
        for (let x = left; x < left + WINDOW; x++) {
          const va = a[row + x]!;
          const vb = b[row + x]!;
          sumA += va;
          sumB += vb;
          sumAA += va * va;
          sumBB += vb * vb;
          sumAB += va * vb;
        }
      }
      const n = WINDOW * WINDOW;
      const meanA = sumA / n;
      const meanB = sumB / n;
      // Sample variance and covariance (n − 1), as the reference implementation uses.
      const varA = (sumAA - n * meanA * meanA) / (n - 1);
      const varB = (sumBB - n * meanB * meanB) / (n - 1);
      const covariance = (sumAB - n * meanA * meanB) / (n - 1);
      const score =
        ((2 * meanA * meanB + C1) * (2 * covariance + C2)) /
        ((meanA * meanA + meanB * meanB + C1) * (varA + varB + C2));
      total += score;
      windows++;
      if (score < worst) worst = score;
      if (score < 0.9) degraded++;
    }
  }
  if (!windows) return {};
  const round = (value: number) => Math.round(value * 1e6) / 1e6;
  return {
    ssim: round(total / windows),
    minSsim: round(worst),
    degradedWindows: round(degraded / windows),
  };
}

/**
 * How a reviewer should read the pair of measures.
 *
 * `uniform` — many pixels differ but structure is intact almost everywhere: a
 *   tint, a theme token, an anti-aliasing shift. Wide and shallow.
 * `localised` — few windows are badly degraded while the rest are untouched:
 *   something specific changed. Narrow and deep.
 * `substantial` — both: a large part of the page is structurally different.
 *
 * A description of the shape of the difference, not a verdict on it.
 */
export type DifferenceShape = 'uniform' | 'localised' | 'substantial';

export function describeDifference(
  comparison: PerceptualComparison,
  changedRatio: number,
): DifferenceShape | undefined {
  const { ssim, degradedWindows } = comparison;
  if (ssim === undefined || degradedWindows === undefined) return undefined;
  const wide = changedRatio > 0.2;
  const deep = degradedWindows > 0.2;
  if (wide && deep) return 'substantial';
  if (wide) return 'uniform';
  return 'localised';
}
