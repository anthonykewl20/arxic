import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { launchDashboardBrowser } from './dashboard-browser';
import { expect, it } from 'vitest';
import {
  bootFixtureApp,
  stopApp,
  vulnerableAuthApp,
} from '../../../../packages/real-world-testkit/src';
import { Workbench } from '../workbench';
import { startWorkbench } from './workbench-runtime';
import { requireCompletedRun } from './run-outcome';

it('compares a changed capture through swipe and overlay view modes in a real browser', async () => {
  const root = resolve(import.meta.dirname, '../../../..');
  const target = await bootFixtureApp(root, vulnerableAuthApp, 'diff-viewer');
  let changed = false;
  // Controlled regression of the real reference response, not a synthetic UI oracle.
  const proxy = createServer(async (req, res) => {
    const upstream = await fetch(req.url === '/' ? target.origin : `${target.origin}${req.url}`);
    const html = await upstream.text();
    res.statusCode = upstream.status;
    res.setHeader('Content-Type', 'text/html');
    res.end(
      html.replace(
        '</head>',
        `<style>body{background:${changed ? '#5a2a10' : '#171717'};color:#fff}</style></head>`,
      ),
    );
  });
  await new Promise<void>((done) => proxy.listen(0, '127.0.0.1', done));
  const state = await mkdtemp(join(tmpdir(), 'arxic-diff-viewer-'));
  const wb = await Workbench.open(state, [root]);
  let app: Awaited<ReturnType<typeof startWorkbench>> | undefined;
  const browser = await launchDashboardBrowser();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.name));
  try {
    const project = await wb.saveProject({
      name: 'Diff viewer',
      folder: root,
      origin: `http://127.0.0.1:${(proxy.address() as { port: number }).port}`,
      captureConsent: true,
      browsers: ['chromium'],
      colorSchemes: ['light'],
      viewports: [{ width: 480, height: 600 }],
      paths: ['/'],
    });
    const first = wb.enqueue(project.id, 'visual');
    if (!first) throw new Error('first visual run was not queued');
    await wb.idle();
    const firstRun = requireCompletedRun(wb.store.run(first.id), 'first');
    const baselineCapture = firstRun.result?.captures?.[0];
    if (!baselineCapture) throw new Error('first visual run completed without captures');
    await wb.approveBaseline(first.id, baselineCapture.id);

    changed = true;
    const second = wb.enqueue(project.id, 'visual');
    if (!second) throw new Error('second visual run was not queued');
    await wb.idle();
    const secondRun = requireCompletedRun(wb.store.run(second.id), 'second');
    const compared = secondRun.result?.captures?.[0];
    expect(compared?.status).toBe('changed');
    expect(compared?.diffFile).toBeTruthy();
    await wb.close();

    app = await startWorkbench({
      roots: [root],
      stateDirectory: state,
      port: 0,
      adminToken: 'diff-viewer-test-administrator-token',
    });
    await page.goto(app.origin);
    await page.getByLabel('Administrator token').fill('diff-viewer-test-administrator-token');
    await page.getByRole('button', { name: 'Open workbench' }).click();
    await page.getByRole('heading', { name: 'Pages', exact: true }).waitFor();
    await page.goto(`${app.origin}?view=runs&run=${secondRun.id}`);
    await page.locator('.capture').first().waitFor();

    const viewer = page.getByRole('region', { name: 'Visual comparison', exact: true });
    await viewer.waitFor();
    await expect.poll(async () => (errors.length ? errors.join('; ') : true)).toBe(true);

    // Swipe mode: the baseline/current pair becomes one interactive pane with a divider.
    await viewer.getByRole('button', { name: 'Swipe', exact: true }).click();
    const divider = viewer.getByRole('slider', { name: 'Comparison position' });
    await expect.poll(() => divider.getAttribute('aria-valuenow')).toBe('50');
    await divider.focus();
    await page.keyboard.press('ArrowLeft');
    await expect.poll(() => divider.getAttribute('aria-valuenow')).toBe('45');
    await divider.focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => divider.getAttribute('aria-valuenow')).toBe('55');
    const pane = viewer.locator('.diff-swipe');
    const before = await pane
      .locator('img')
      .nth(1)
      .evaluate((img) => img.getAttribute('style'));
    const box = (await pane.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();
    await expect.poll(() => divider.getAttribute('aria-valuenow')).toBe('20');
    const after = await pane
      .locator('img')
      .nth(1)
      .evaluate((img) => img.getAttribute('style'));
    expect(after).not.toBe(before);

    // Overlay mode: onion-skin opacity over the same pair.
    await viewer.getByRole('button', { name: 'Overlay', exact: true }).click();
    const opacity = viewer.getByLabel('Overlay opacity');
    await opacity.fill('30');
    await expect
      .poll(() =>
        viewer
          .locator('.diff-overlay img')
          .nth(1)
          .evaluate((img) => img.style.opacity),
      )
      .toBe('0.3');

    // Side-by-side keeps both full images and the pixel difference reachable.
    await viewer.getByRole('button', { name: 'Side by side', exact: true }).click();
    expect(await viewer.getByRole('img', { name: 'Baseline used for this run' }).isVisible()).toBe(
      true,
    );
    expect(await viewer.getByRole('img', { name: 'Capture from this run' }).isVisible()).toBe(true);
    expect(await viewer.getByRole('img', { name: 'Pixel difference' }).isVisible()).toBe(true);

    // The approval action stays available from the card.
    expect(
      await page
        .getByRole('button', { name: 'Approve as baseline', exact: true })
        .first()
        .isVisible(),
    ).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
    if (app) await app.close();
    else await wb.close();
    await stopApp(target.child);
    await new Promise<void>((resolve) => proxy.close(() => resolve()));
    await rm(state, { recursive: true, force: true });
  }
}, 90_000);
