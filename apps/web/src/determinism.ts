import type { BrowserContext } from 'playwright';
import type { VisualEnvironment } from './types';

/**
 * Rendering determinism: everything that makes the same page produce the same
 * pixels on a second run, on a different host, at a different moment.
 *
 * Kept out of `visual.ts` so the same profile can be applied by any capture
 * path and so each decision below can be stated, tested and argued with. Two of
 * them are deliberate deviations from the obvious recipe; both are documented
 * where they are made rather than in a commit message.
 */

/**
 * The instant every captured page believes it is. A fixed, obviously-synthetic
 * date: an operator seeing it in a screenshot should recognise it as the
 * harness rather than mistake it for real data.
 */
export const FROZEN_CLOCK_ISO = '2020-01-01T00:00:00.000Z';
export const FROZEN_CLOCK_MS = Date.parse(FROZEN_CLOCK_ISO);

/**
 * Chromium raster and font flags. Chromium only — Firefox and WebKit reject
 * unknown switches, and their own rendering is already stable enough for the
 * byte-comparison loop.
 *
 *  --font-render-hinting=none, --disable-font-subpixel-positioning,
 *  --disable-lcd-text  remove host font-hinting and subpixel antialiasing, the
 *      largest source of one-pixel text differences between machines.
 *  --force-color-profile=srgb  pins colour management, so a wide-gamut display
 *      profile on the host cannot shift captured colours.
 *  --disable-partial-raster, --disable-skia-runtime-opts  remove two
 *      raster-path optimisations that vary with GPU and CPU feature detection.
 */
export function launchArgs(browser: VisualEnvironment['browser']): string[] {
  if (browser !== 'chromium') return [];
  return [
    '--font-render-hinting=none',
    '--disable-font-subpixel-positioning',
    '--disable-lcd-text',
    '--force-color-profile=srgb',
    '--disable-partial-raster',
    '--disable-skia-runtime-opts',
  ];
}

/**
 * Forces every CSS animation and transition to its end state.
 *
 * `reducedMotion: 'reduce'` is already set on the context, but that only asks:
 * a page is free to ignore the media query, and many do. This does not ask.
 *
 * The end state, not the start: a page that animates content in would otherwise
 * be captured mid-fade or fully invisible, which is neither what a user sees
 * nor stable between runs.
 */
export const FREEZE_ANIMATIONS_CSS = `*, *::before, *::after {
  animation-delay: -1ms !important;
  animation-duration: 1ms !important;
  animation-iteration-count: 1 !important;
  transition-delay: 0s !important;
  transition-duration: 0s !important;
  scroll-behavior: auto !important;
  caret-color: transparent !important;
}`;

/**
 * Freezes the wall clock so rendered dates, "3 minutes ago" strings and
 * copyright years are the same on every run.
 *
 * Deliberately NOT frozen: `performance.now`, `requestAnimationFrame` and the
 * timer functions. Stubbing those is the usual recipe and it is wrong here.
 * Freezing `performance.now` pins every rAF callback to one timestamp, so a
 * JavaScript-driven animation renders its FIRST frame forever, while the CSS
 * rule above has already forced CSS animations to their LAST — a page captured
 * in two contradictory states, which is less faithful than either. Replacing
 * the timers outright also stalls the boot of any application that waits on one.
 *
 * Script-driven motion is settled instead by the capture loop in `visual.ts`,
 * which re-captures until consecutive screenshots and element geometry agree.
 * That handles a running animation correctly and needs no lie about time.
 */
export function clockScript(nowMs: number = FROZEN_CLOCK_MS): string {
  return `(() => {
  const fixed = ${nowMs};
  const RealDate = Date;
  const FrozenDate = function (...args) {
    if (!(this instanceof FrozenDate)) return new RealDate(fixed).toString();
    return args.length === 0 ? new RealDate(fixed) : new RealDate(...args);
  };
  FrozenDate.prototype = RealDate.prototype;
  FrozenDate.now = () => fixed;
  FrozenDate.parse = RealDate.parse;
  FrozenDate.UTC = RealDate.UTC;
  Object.defineProperty(globalThis, 'Date', {
    value: FrozenDate,
    writable: true,
    configurable: true,
  });
  // A page that reads the zone offset directly should agree with the UTC
  // context Playwright already applies.
  try {
    Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    /* not available in this context */
  }
})();`;
}

/**
 * The style injection, as an init script so it survives every navigation.
 *
 * An init script runs before the document exists, so the first attempt usually
 * has nowhere to append. The listeners are registered BEFORE that attempt:
 * appending to a null root throws, and a throw here would abandon the
 * registration and leave the page unfrozen for the rest of its life.
 */
function animationScript(): string {
  return `(() => {
  const apply = () => {
    try {
      const root = document.head || document.documentElement;
      if (!root) return false;
      if (document.getElementById('arxic-freeze-animations')) return true;
      const style = document.createElement('style');
      style.id = 'arxic-freeze-animations';
      style.textContent = ${JSON.stringify(FREEZE_ANIMATIONS_CSS)};
      root.appendChild(style);
      return true;
    } catch {
      return false;
    }
  };
  document.addEventListener('DOMContentLoaded', apply);
  document.addEventListener('readystatechange', apply);
  apply();
})();`;
}

/**
 * Applies the deterministic profile to a context. Init scripts run before any
 * page script on every navigation, including documents the application pushes
 * itself, so a single-page application cannot outrun them.
 */
export async function applyDeterminism(
  context: BrowserContext,
  options: { clockMs?: number; freezeClock?: boolean; freezeAnimations?: boolean } = {},
) {
  if (options.freezeAnimations !== false) await context.addInitScript(animationScript());
  if (options.freezeClock !== false) await context.addInitScript(clockScript(options.clockMs));
}

/**
 * Waits for every already-loaded image to finish decoding. `img.complete` only
 * promises the bytes arrived; the first paint can still land before the decode,
 * which shows up as a blank or partially drawn image in a capture.
 *
 * Returns the number of images that failed to decode — a real page defect worth
 * recording, not a reason to refuse the capture.
 */
export const DECODE_IMAGES_SCRIPT = `(async () => {
  const images = [...document.images].filter((image) => image.getAttribute('src'));
  const results = await Promise.all(
    images.map((image) => image.decode().then(() => true, () => false)),
  );
  return results.filter((ok) => !ok).length;
})()`;
