import { createServer, type Server } from 'node:http';
import { afterEach, expect, it } from 'vitest';
import { chromium, firefox, webkit, type Browser } from 'playwright';
import {
  applyDeterminism,
  clockScript,
  launchArgs,
  DECODE_IMAGES_SCRIPT,
  FROZEN_CLOCK_MS,
} from '../determinism';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});

/**
 * A page built to be non-reproducible: it prints the wall clock, fades content
 * in over a second, and animates a bar's width. Captured without the
 * deterministic profile, two runs a moment apart differ.
 */
const PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  body { margin: 0; font: 16px/1.4 monospace; background: #fff; color: #111; width: 400px; }
  #stamp { padding: 8px; }
  #fade { opacity: 0; animation: fade 1s linear forwards; padding: 8px; background: #eee; }
  @keyframes fade { to { opacity: 1; } }
  #bar { height: 20px; width: 0; background: #345; transition: width 2s linear; }
</style></head>
<body>
  <div id="stamp"></div>
  <div id="fade">faded in</div>
  <div id="bar"></div>
  <script>
    document.getElementById('stamp').textContent = new Date().toISOString();
    requestAnimationFrame(() => { document.getElementById('bar').style.width = '300px'; });
  </script>
</body></html>`;

async function serve(body: string) {
  const server: Server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(body);
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  cleanup.push(() => new Promise<void>((done) => server.close(() => done())));
  const { port } = server.address() as { port: number };
  return `http://127.0.0.1:${port}`;
}

async function open(browser: Browser, origin: string, deterministic: boolean) {
  const context = await browser.newContext({
    viewport: { width: 400, height: 200 },
    deviceScaleFactor: 1,
    locale: 'en-US',
    timezoneId: 'UTC',
    colorScheme: 'light',
    reducedMotion: 'reduce',
  });
  if (deterministic) await applyDeterminism(context);
  const page = await context.newPage();
  await page.goto(origin, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  return { context, page };
}

it.each(['chromium', 'firefox', 'webkit'] as const)(
  'captures the same non-reproducible page identically twice under %s',
  async (name) => {
    const origin = await serve(PAGE);
    const browser = await { chromium, firefox, webkit }[name].launch({
      headless: true,
      args: launchArgs(name),
    });
    cleanup.push(() => browser.close());

    const shots: Buffer[] = [];
    const stamps: string[] = [];
    for (let run = 0; run < 2; run++) {
      const { context, page } = await open(browser, origin, true);
      // A real gap between runs: without a frozen clock the printed timestamp
      // differs, and without the animation override the fade and the bar are
      // caught at different points.
      await new Promise((resolve) => setTimeout(resolve, 1100));
      stamps.push(await page.locator('#stamp').innerText());
      shots.push(await page.screenshot());
      await context.close();
    }
    expect(stamps[0]).toBe(stamps[1]);
    expect(new Date(stamps[0]!).getTime()).toBe(FROZEN_CLOCK_MS);
    expect(shots[0]!.equals(shots[1]!)).toBe(true);
  },
  120_000,
);

it('leaves the page non-reproducible without the profile, so the test above proves something', async () => {
  const origin = await serve(PAGE);
  const browser = await chromium.launch({ headless: true, args: launchArgs('chromium') });
  cleanup.push(() => browser.close());
  const first = await open(browser, origin, false);
  const firstStamp = await first.page.locator('#stamp').innerText();
  await first.context.close();
  await new Promise((resolve) => setTimeout(resolve, 1100));
  const second = await open(browser, origin, false);
  const secondStamp = await second.page.locator('#stamp').innerText();
  await second.context.close();
  expect(firstStamp).not.toBe(secondStamp);
}, 60_000);

it('holds animations at their end state rather than their start', async () => {
  const origin = await serve(PAGE);
  const browser = await chromium.launch({ headless: true, args: launchArgs('chromium') });
  cleanup.push(() => browser.close());
  const { context, page } = await open(browser, origin, true);
  // No wait at all: the fade would still be at opacity 0 and the bar at 0px if
  // the override were merely asking the page to reduce motion.
  const state = await page.evaluate(() => ({
    opacity: getComputedStyle(document.getElementById('fade')!).opacity,
    width: getComputedStyle(document.getElementById('bar')!).width,
  }));
  expect(Number(state.opacity)).toBe(1);
  expect(state.width).toBe('300px');
  await context.close();
}, 60_000);

it('freezes the wall clock without stalling timers or animation frames', async () => {
  const origin = await serve('<!doctype html><meta charset="utf-8"><body>x</body>');
  const browser = await chromium.launch({ headless: true, args: launchArgs('chromium') });
  cleanup.push(() => browser.close());
  const context = await browser.newContext();
  await applyDeterminism(context);
  const page = await context.newPage();
  await page.goto(origin, { waitUntil: 'load' });
  const observed = await page.evaluate(async () => {
    const before = performance.now();
    // A page that waits on a timer must still boot, and rAF must still advance
    // — freezing those is what breaks single-page applications.
    const timerRan = await new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 20));
    const frame = await new Promise<number>((resolve) => requestAnimationFrame(resolve));
    return {
      timerRan,
      frameAdvanced: frame > 0,
      performanceMoved: performance.now() > before,
      dateNow: Date.now(),
      constructed: new Date().toISOString(),
      // An explicit argument must still build the date it was given.
      explicit: new Date('2031-05-04T03:02:01.000Z').toISOString(),
    };
  });
  expect(observed.timerRan).toBe(true);
  expect(observed.frameAdvanced).toBe(true);
  expect(observed.performanceMoved).toBe(true);
  expect(observed.dateNow).toBe(FROZEN_CLOCK_MS);
  expect(observed.constructed).toBe('2020-01-01T00:00:00.000Z');
  expect(observed.explicit).toBe('2031-05-04T03:02:01.000Z');
  await context.close();
}, 60_000);

it('reports images that cannot be decoded instead of capturing them blank', async () => {
  const origin = await serve(
    `<!doctype html><meta charset="utf-8"><body>
      <img src="data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==">
      <img src="/broken.png">
    </body>`,
  );
  const browser = await chromium.launch({ headless: true, args: launchArgs('chromium') });
  cleanup.push(() => browser.close());
  const page = await (await browser.newContext()).newPage();
  await page.goto(origin, { waitUntil: 'load' });
  expect(await page.evaluate(DECODE_IMAGES_SCRIPT)).toBe(1);
}, 60_000);

it('builds Chromium-only raster flags', () => {
  expect(launchArgs('chromium')).toContain('--force-color-profile=srgb');
  expect(launchArgs('chromium')).toContain('--font-render-hinting=none');
  // Firefox and WebKit reject unknown switches; they get none.
  expect(launchArgs('firefox')).toEqual([]);
  expect(launchArgs('webkit')).toEqual([]);
});

it('accepts an explicit instant for the frozen clock', () => {
  expect(clockScript(1234)).toContain('const fixed = 1234;');
});
