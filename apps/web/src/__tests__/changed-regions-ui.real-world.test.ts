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

const REGION_STYLE = `<style>
body::before{content:'';position:fixed;z-index:2147483647;left:40px;top:40px;width:40px;height:40px;background:#e14b1f}
body::after{content:'';position:fixed;z-index:2147483647;right:60px;bottom:80px;width:48px;height:32px;background:#1fd3e1}
</style>`;

it('walks changed regions with an overlay and keyboard shortcuts in a real browser', async () => {
  const root = resolve(import.meta.dirname, '../../../..');
  const target = await bootFixtureApp(root, vulnerableAuthApp, 'changed-regions');
  let changed = false;
  // Controlled regression of the real reference response, not a synthetic UI oracle.
  const proxy = createServer(async (req, res) => {
    const upstream = await fetch(req.url === '/' ? target.origin : `${target.origin}${req.url}`);
    const html = await upstream.text();
    res.statusCode = upstream.status;
    res.setHeader('Content-Type', 'text/html');
    res.end(html.replace('</head>', changed ? `${REGION_STYLE}</head>` : '</head>'));
  });
  await new Promise<void>((done) => proxy.listen(0, '127.0.0.1', done));
  const state = await mkdtemp(join(tmpdir(), 'arxic-changed-regions-'));
  const wb = await Workbench.open(state, [root]);
  let app: Awaited<ReturnType<typeof startWorkbench>> | undefined;
  const browser = await launchDashboardBrowser();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.name));
  try {
    const project = await wb.saveProject({
      name: 'Changed regions',
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
      adminToken: 'changed-regions-test-administrator-token',
    });
    await page.goto(app.origin);
    await page.getByLabel('Administrator token').fill('changed-regions-test-administrator-token');
    await page.getByRole('button', { name: 'Open workbench' }).click();
    await page.getByRole('heading', { name: 'Pages', exact: true }).waitFor();
    await page.goto(`${app.origin}?view=runs&run=${secondRun.id}`);
    await page.locator('.capture').first().waitFor();

    const viewer = page.getByRole('region', { name: 'Visual comparison', exact: true });
    await viewer.waitFor();

    // Two isolated changed areas: the region count and geometry are deterministic.
    await expect
      .poll(() => viewer.getByText(/change regions/, { exact: true }).textContent())
      .toBe('2 change regions');
    await viewer.getByRole('button', { name: 'Changes', exact: true }).click();
    const regions = viewer.locator('.diff-region');
    await expect.poll(() => regions.count()).toBe(2);
    const firstBox = await regions.first().evaluate((element) => ({
      left: element.style.left,
      top: element.style.top,
      width: element.style.width,
      height: element.style.height,
    }));
    const near = (actual: string, expected: number) =>
      Math.abs(Number.parseFloat(actual) - expected) < 0.6;
    expect(near(firstBox.left, (40 / 480) * 100)).toBe(true);
    expect(near(firstBox.top, (40 / 600) * 100)).toBe(true);
    expect(near(firstBox.width, (40 / 480) * 100)).toBe(true);
    expect(near(firstBox.height, (40 / 600) * 100)).toBe(true);

    // Walk the regions with buttons, then with the keyboard.
    const counter = viewer.getByText(/^\d+ \/ \d+$/);
    await expect.poll(() => counter.isHidden()).toBe(true);
    await viewer.getByRole('button', { name: 'Next change', exact: true }).click();
    await expect.poll(() => counter.textContent()).toBe('1 / 2');
    await expect.poll(() => regions.first().getAttribute('aria-current')).toBe('true');
    await viewer.getByRole('button', { name: 'Next change', exact: true }).click();
    await expect.poll(() => counter.textContent()).toBe('2 / 2');
    await viewer.getByRole('button', { name: 'Previous change', exact: true }).click();
    await expect.poll(() => counter.textContent()).toBe('1 / 2');

    await viewer.focus();
    await page.keyboard.press('2');
    await expect
      .poll(() => viewer.getByRole('slider', { name: 'Comparison position' }).isVisible())
      .toBe(true);
    await page.keyboard.press('3');
    await expect.poll(() => viewer.getByLabel('Overlay opacity').isVisible()).toBe(true);
    await page.keyboard.press('1');
    await expect
      .poll(() => viewer.getByRole('img', { name: 'Baseline used for this run' }).isVisible())
      .toBe(true);
    await page.keyboard.press('n');
    await expect.poll(() => counter.textContent()).toBe('2 / 2');
    await page.keyboard.press('p');
    await expect.poll(() => counter.textContent()).toBe('1 / 2');
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
