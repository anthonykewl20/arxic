import { createServer, type Server } from 'node:http';
import { afterEach, expect, it } from 'vitest';
import { chromium } from 'playwright';
import sharp from 'sharp';
import {
  componentTargetsScript,
  cropCapture,
  deviceBox,
  OVERLAY_TARGETS_SCRIPT,
  type IsolatedTarget,
} from '../element-capture';
import { applyDeterminism, launchArgs } from '../determinism';
import { comparePixels } from '../visual-pixels';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});

/**
 * A page whose header can grow. The card below it is unchanged in content but
 * is pushed down — the exact situation that makes a whole-viewport comparison
 * report an untouched component as altered.
 */
const page = (headerHeight: number, overlay: boolean) => `<!doctype html>
<html><head><meta charset="utf-8"><style>
  body { margin: 0; font: 14px system-ui; background: #fff; width: 400px; }
  #header { height: ${headerHeight}px; background: #dde; }
  #card { margin: 10px; padding: 10px; border: 1px solid #345; background: #fff; }
  #toast { position: fixed; right: 10px; bottom: 10px; width: 160px; padding: 8px;
           background: #333; color: #fff; }
</style></head>
<body>
  <div id="header"></div>
  <div id="card">unchanged component</div>
  ${overlay ? '<div id="toast" role="alert">Saved</div>' : ''}
</body></html>`;

async function serve(body: string) {
  const server: Server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(body);
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  cleanup.push(() => new Promise<void>((done) => server.close(() => done())));
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}

async function shoot(body: string, selectors: string[]) {
  const origin = await serve(body);
  const browser = await chromium.launch({ headless: true, args: launchArgs('chromium') });
  cleanup.push(() => browser.close());
  const viewport = { width: 400, height: 300 };
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  await applyDeterminism(context);
  const tab = await context.newPage();
  await tab.goto(origin, { waitUntil: 'load' });
  const bytes = await tab.screenshot({ type: 'png' });
  const overlays = (await tab.evaluate(OVERLAY_TARGETS_SCRIPT)) as IsolatedTarget[];
  const components = selectors.length
    ? ((await tab.evaluate(componentTargetsScript(selectors))) as IsolatedTarget[])
    : [];
  await context.close();
  return { bytes, overlays, components, viewport };
}

async function size(bytes: Buffer) {
  const { width = 0, height = 0 } = await sharp(bytes).metadata();
  return { width, height };
}

it('reports a component as unchanged when only a sibling above it moved', async () => {
  const before = await shoot(page(40, false), ['#card']);
  const after = await shoot(page(90, false), ['#card']);

  // The viewport comparison sees the whole page below the header shift.
  const wholePage = comparePixels(
    new Uint8Array(await sharp(before.bytes).raw().ensureAlpha().toBuffer()),
    new Uint8Array(await sharp(after.bytes).raw().ensureAlpha().toBuffer()),
    before.viewport.width,
    before.viewport.height,
  );
  expect(wholePage.changedPixels).toBeGreaterThan(0);

  // The component compared against itself is byte-identical.
  const crop = async (shot: Awaited<ReturnType<typeof shoot>>) => {
    const box = deviceBox(shot.components[0]!.box, shot.viewport, 1)!;
    return cropCapture(shot.bytes, box);
  };
  const beforeCard = await crop(before);
  const afterCard = await crop(after);
  expect(await size(beforeCard)).toEqual(await size(afterCard));
  expect(beforeCard.equals(afterCard)).toBe(true);
}, 120_000);

it('isolates an overlay without being told it exists', async () => {
  const shot = await shoot(page(40, true), []);
  expect(shot.overlays).toHaveLength(1);
  expect(shot.overlays[0]!.kind).toBe('overlay');
  expect(shot.overlays[0]!.key).toContain('alert');
  const box = deviceBox(shot.overlays[0]!.box, shot.viewport, 1)!;
  const bytes = await cropCapture(shot.bytes, box);
  // 160px wide plus 8px padding each side, as declared in the page.
  expect((await size(bytes)).width).toBe(176);
}, 60_000);

it('keeps only the outermost of nested overlays', async () => {
  const shot = await shoot(
    `<!doctype html><meta charset="utf-8"><body style="margin:0">
       <div role="dialog" style="width:200px;height:100px">
         <div role="alert" style="width:80px;height:20px">inner</div>
       </div>
     </body>`,
    [],
  );
  expect(shot.overlays).toHaveLength(1);
  expect(shot.overlays[0]!.key).toContain('dialog');
}, 60_000);

it('crops at device pixels so a high-density capture is not half-sized', () => {
  const box = { x: 10, y: 20, width: 100, height: 50 };
  const viewport = { width: 400, height: 300 };
  expect(deviceBox(box, viewport, 1)).toEqual({ x: 10, y: 20, width: 100, height: 50 });
  expect(deviceBox(box, viewport, 2)).toEqual({ x: 20, y: 40, width: 200, height: 100 });
});

it('clamps a region that runs past the viewport and drops one that is off screen', () => {
  const viewport = { width: 400, height: 300 };
  expect(deviceBox({ x: 380, y: 10, width: 100, height: 50 }, viewport, 1)).toEqual({
    x: 380,
    y: 10,
    width: 20,
    height: 50,
  });
  expect(deviceBox({ x: 500, y: 10, width: 100, height: 50 }, viewport, 1)).toBeUndefined();
  // Too small to compare meaningfully.
  expect(deviceBox({ x: 0, y: 0, width: 2, height: 2 }, viewport, 1)).toBeUndefined();
});

it('never extracts past the real image, even when the box was rounded outward', async () => {
  const source = await sharp({
    create: { width: 20, height: 20, channels: 4, background: '#fff' },
  })
    .png()
    .toBuffer();
  const bytes = await cropCapture(source, { x: 18, y: 18, width: 40, height: 40 });
  expect(await size(bytes)).toEqual({ width: 2, height: 2 });
}, 30_000);

it('ignores a selector that matches nothing and one that is not valid CSS', async () => {
  const shot = await shoot(page(40, false), ['#card', '#absent', 'not a selector((']);
  expect(shot.components.map((item) => item.key)).toEqual(['component:#card']);
}, 60_000);
