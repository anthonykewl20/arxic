import pixelmatch from 'pixelmatch';

/** Shared comparison profile for retained screenshots and compact-model features. */
export function comparePixels(
  before: Uint8Array,
  current: Uint8Array,
  width: number,
  height: number,
  diffMask = false,
) {
  const diff = Buffer.alloc(width * height * 4);
  const changedPixels = pixelmatch(before, current, diff, width, height, {
    threshold: 0.1,
    diffMask,
  });
  return { diff, changedPixels };
}
