import sharp from 'sharp';

/**
 * Isolated captures: one region of a page, cropped out of the page's own
 * screenshot.
 *
 * Cropping the already-masked viewport bytes rather than taking a second,
 * element-scoped screenshot is the whole design. An isolated capture is then a
 * strict subset of pixels that already passed the privacy pipeline — every
 * required mask was present and applied before this module sees anything — so
 * isolation cannot introduce a disclosure the viewport capture did not have.
 * A second screenshot would have to re-derive that guarantee, and could drift
 * from it.
 *
 * The point of isolating is diff blast radius: when a sibling above a component
 * changes height, a viewport comparison reports the whole page below it as
 * changed. A component compared against its own baseline reports only itself.
 */

export type CaptureBox = { x: number; y: number; width: number; height: number };

/** A region worth isolating, as measured in the page. */
export type IsolatedTarget = {
  /** Stable identity for the capture: the declared selector, or the overlay's role. */
  key: string;
  kind: 'component' | 'overlay';
  box: CaptureBox;
};

/**
 * Clamps a CSS-pixel box to the viewport and converts it to device pixels.
 *
 * Returns undefined when nothing of the element is on screen, or when the
 * region is too small to compare meaningfully — a one-pixel crop is noise, not
 * evidence.
 */
export function deviceBox(
  box: CaptureBox,
  viewport: { width: number; height: number },
  deviceScaleFactor: number,
  minimum = 4,
): CaptureBox | undefined {
  const left = Math.max(0, Math.min(box.x, viewport.width));
  const top = Math.max(0, Math.min(box.y, viewport.height));
  const right = Math.max(0, Math.min(box.x + box.width, viewport.width));
  const bottom = Math.max(0, Math.min(box.y + box.height, viewport.height));
  const width = right - left;
  const height = bottom - top;
  if (width < minimum || height < minimum) return undefined;
  const scale = (value: number) => Math.round(value * deviceScaleFactor);
  return { x: scale(left), y: scale(top), width: scale(width), height: scale(height) };
}

/**
 * Crops a region out of a PNG. The box is in device pixels and is clamped again
 * against the real image, because a rounded box can land one pixel past the
 * edge and sharp refuses an out-of-bounds extract.
 */
export async function cropCapture(bytes: Buffer, box: CaptureBox): Promise<Buffer> {
  const image = sharp(bytes);
  const { width = 0, height = 0 } = await image.metadata();
  const left = Math.max(0, Math.min(box.x, Math.max(0, width - 1)));
  const top = Math.max(0, Math.min(box.y, Math.max(0, height - 1)));
  return image
    .extract({
      left,
      top,
      width: Math.max(1, Math.min(box.width, width - left)),
      height: Math.max(1, Math.min(box.height, height - top)),
    })
    .png()
    .toBuffer();
}

/**
 * Finds the overlay and portal containers a page has actually raised.
 *
 * Automatic rather than declared: an overlay is the surface least likely to be
 * declared and most likely to regress, and its container is recognisable from
 * the same accessibility vocabulary a screen reader uses. Nested overlays are
 * dropped in favour of their outermost container, so a dialog and its own alert
 * do not produce two overlapping captures of the same thing.
 */
export const OVERLAY_TARGETS_SCRIPT = `(() => {
  const selector = [
    'dialog[open]',
    '[role="dialog"]',
    '[role="alertdialog"]',
    '[aria-live="assertive"]',
    '[role="alert"]',
    '#modal-root',
    '#portal-root',
    '[data-sonner-toaster]',
    '.toast-container, .toast, .Toastify, .snackbar, .notification',
  ].join(',');
  const found = [];
  for (const element of document.querySelectorAll(selector)) {
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    if (box.width < 4 || box.height < 4) continue;
    if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') continue;
    found.push({ element, box });
  }
  const outermost = found.filter(
    (candidate) => !found.some((other) => other !== candidate && other.element.contains(candidate.element)),
  );
  return outermost.slice(0, 10).map(({ element, box }, index) => ({
    key: 'overlay:' + (element.getAttribute('role') || element.tagName.toLowerCase()) + ':' + index,
    kind: 'overlay',
    box: { x: box.x, y: box.y, width: box.width, height: box.height },
  }));
})()`;

/** Measures the operator's declared component selectors, first match each. */
export function componentTargetsScript(selectors: readonly string[]): string {
  return `((selectors) => {
  const found = [];
  for (const selector of selectors) {
    let element = null;
    try {
      element = document.querySelector(selector);
    } catch {
      continue;
    }
    if (!element) continue;
    const box = element.getBoundingClientRect();
    if (box.width < 4 || box.height < 4) continue;
    found.push({
      key: 'component:' + selector,
      kind: 'component',
      box: { x: box.x, y: box.y, width: box.width, height: box.height },
    });
  }
  return found;
})(${JSON.stringify(selectors)})`;
}
