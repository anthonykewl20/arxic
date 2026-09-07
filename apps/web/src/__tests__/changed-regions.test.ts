import { describe, expect, it } from 'vitest';
import { changedRegionBoxes } from '../visual';

const WIDTH = 160;
const HEIGHT = 120;
function blank(channels: [number, number, number] = [10, 10, 10]) {
  const buffer = new Uint8Array(WIDTH * HEIGHT * 4);
  for (let offset = 0; offset < buffer.length; offset += 4) buffer.set([...channels, 255], offset);
  return buffer;
}
function paint(
  buffer: Uint8Array,
  x: number,
  y: number,
  width: number,
  height: number,
  channels: [number, number, number] = [220, 40, 40],
) {
  for (let row = y; row < y + height; row++)
    for (let column = x; column < x + width; column++) {
      const offset = (row * WIDTH + column) * 4;
      buffer.set([...channels, 255], offset);
    }
}

describe('changedRegionBoxes', () => {
  it('returns no boxes for identical images and filters specks below the minimum side', () => {
    expect(changedRegionBoxes(blank(), blank(), WIDTH, HEIGHT)).toEqual([]);
    const speck = blank();
    paint(speck, 10, 10, 3, 3);
    expect(changedRegionBoxes(blank(), speck, WIDTH, HEIGHT)).toEqual([]);
  });
  it('returns one exact box per isolated changed square', () => {
    const changed = blank();
    paint(changed, 20, 12, 16, 10);
    paint(changed, 60, 40, 12, 24);
    expect(changedRegionBoxes(blank(), changed, WIDTH, HEIGHT)).toEqual([
      { x: 20, y: 12, width: 16, height: 10 },
      { x: 60, y: 40, width: 12, height: 24 },
    ]);
  });
  it('merges runs bridged by a small gap into one box', () => {
    const changed = blank();
    paint(changed, 20, 30, 10, 10);
    paint(changed, 32, 30, 10, 10);
    expect(changedRegionBoxes(blank(), changed, WIDTH, HEIGHT)).toEqual([
      { x: 20, y: 30, width: 22, height: 10 },
    ]);
  });
  it('caps the reported boxes at 200 and keeps them deterministic', () => {
    const changed = blank();
    for (let row = 0; row < 19; row++)
      for (let column = 0; column < 19; column++) paint(changed, column * 8 + 1, row * 6 + 1, 4, 4);
    const boxes = changedRegionBoxes(blank(), changed, WIDTH, HEIGHT);
    expect(boxes.length).toBe(200);
    expect(new Set(boxes.map((box) => `${box.x},${box.y}`)).size).toBe(200);
  });
});
