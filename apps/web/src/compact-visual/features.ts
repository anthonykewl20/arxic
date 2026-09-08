import sharp from 'sharp';
import { comparePixels } from '../visual-pixels';
import { loadVisualCase, type Box, type Measurement } from './evidence';

type Input = {
  before: Uint8Array;
  current: Uint8Array;
  changed: Uint8Array;
  valid: Uint8Array;
  width: number;
  height: number;
  region: Box;
  beforeMeasurement: Measurement;
  currentMeasurement: Measurement;
  viewport: { width: number; height: number };
};
const luminance = (data: Uint8Array, pixel: number) =>
  (0.2126 * data[pixel * 4]! + 0.7152 * data[pixel * 4 + 1]! + 0.0722 * data[pixel * 4 + 2]!) / 255;

export function regionFeatures(input: Input) {
  const { before, current, changed, valid, width, height, region, viewport } = input;
  const geometry = (m: Measurement) =>
    m.box
      ? [
          m.box.x / viewport.width,
          m.box.y / viewport.height,
          m.box.width / viewport.width,
          m.box.height / viewport.height,
        ]
      : [null, null, null, null];
  const b = input.beforeMeasurement,
    c = input.currentMeasurement;
  const numeric = [
    ...geometry(b),
    ...geometry(c),
    b.clip,
    c.clip,
    b.hit,
    c.hit,
    b.overflowX,
    c.overflowX,
    b.overflowY,
    c.overflowY,
  ];
  const values = [...numeric.map((n) => n ?? 0), ...numeric.map((n) => (n === null ? 0 : 1))];
  const edgeCounts: number[] = [];
  let validCount = 0;
  for (let row = 0; row < 4; row++)
    for (let col = 0; col < 4; col++) {
      const x0 = Math.floor(region.x + (col * region.width) / 4),
        x1 = Math.floor(region.x + ((col + 1) * region.width) / 4);
      const y0 = Math.floor(region.y + (row * region.height) / 4),
        y1 = Math.floor(region.y + ((row + 1) * region.height) / 4);
      let count = 0,
        light = 0,
        edges = 0,
        edgeCount = 0,
        changes = 0;
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++) {
          const p = y * width + x;
          if (!valid[p]) continue;
          count++;
          light += Math.abs(luminance(before, p) - luminance(current, p));
          changes += changed[p * 4 + 3]! > 0 ? 1 : 0;
          if (x + 1 < width && y + 1 < height && valid[p + 1] && valid[p + width]) {
            const edge = (data: Uint8Array) =>
              (Math.abs(luminance(data, p + 1) - luminance(data, p)) +
                Math.abs(luminance(data, p + width) - luminance(data, p))) /
              2;
            edges += Math.abs(edge(before) - edge(current));
            edgeCount++;
          }
        }
      validCount += count;
      edgeCounts.push(edgeCount);
      values.push(
        count ? light / count : 0,
        edgeCount ? edges / edgeCount : 0,
        count ? changes / count : 0,
        (x1 - x0) * (y1 - y0) ? count / ((x1 - x0) * (y1 - y0)) : 0,
      );
    }
  return { values: values.map(Math.fround), usable: validCount > 0, edgeCounts };
}

export async function extractCase(root: string, path: string) {
  const evidence = await loadVisualCase(root, path);
  const { width, height, dpr } = evidence.manifest.context;
  const imageWidth = Math.round(width * dpr),
    imageHeight = Math.round(height * dpr);
  const decode = (bytes: Buffer) =>
    sharp(bytes, { limitInputPixels: 2097152 }).ensureAlpha().raw().toBuffer();
  const before = await decode(evidence.before),
    current = await decode(evidence.current);
  const valid = new Uint8Array(imageWidth * imageHeight).fill(1);
  for (const mask of evidence.masks) {
    for (let y = Math.floor(mask.y); y < Math.ceil(mask.y + mask.height); y++)
      for (let x = Math.floor(mask.x); x < Math.ceil(mask.x + mask.width); x++)
        valid[y * imageWidth + x] = 0;
  }
  for (let p = 0; p < valid.length; p++) {
    if (before[p * 4 + 3] !== 255 || current[p * 4 + 3] !== 255) valid[p] = 0;
    if (!valid[p]) {
      before.fill(0, p * 4, p * 4 + 4);
      current.fill(0, p * 4, p * 4 + 4);
    }
  }
  const comparison = comparePixels(before, current, imageWidth, imageHeight, true);
  return {
    version: 1,
    featureSchema: 'arxic-visual-features-v1',
    caseId: evidence.manifest.id,
    group: evidence.manifest.group,
    manifestSha256: evidence.manifestSha256,
    changedPixels: comparison.changedPixels,
    excludedPixels: valid.length - valid.reduce((a, b) => a + b, 0),
    hardChecks: evidence.scene.hardChecks,
    regions: evidence.scene.regions.map((r) => ({
      id: r.id,
      criterion: r.criterion,
      eligible: r.eligible.map(
        (requested, index) =>
          requested &&
          [
            r.before.clip !== null && r.current.clip !== null,
            r.before.hit !== null && r.current.hit !== null,
            false,
            r.current.overflowX !== null && r.current.overflowY !== null,
            false,
            r.before.box !== null && r.current.box !== null,
          ][index],
      ),
      ...regionFeatures({
        before,
        current,
        changed: comparison.diff,
        valid,
        width: imageWidth,
        height: imageHeight,
        region: r.box,
        beforeMeasurement: r.before,
        currentMeasurement: r.current,
        viewport: { width, height },
      }),
    })),
    coverage: 'supplied-regions-only',
  };
}
