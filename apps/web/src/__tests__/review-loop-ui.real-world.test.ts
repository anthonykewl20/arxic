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

it('walks changed captures with j/k and approves the focused capture with a', async () => {
  const root = resolve(import.meta.dirname, '../../../..');
  const target = await bootFixtureApp(root, vulnerableAuthApp, 'review-loop');
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
  const state = await mkdtemp(join(tmpdir(), 'arxic-review-loop-'));
  const wb = await Workbench.open(state, [root]);
  let app: Awaited<ReturnType<typeof startWorkbench>> | undefined;
  const browser = await launchDashboardBrowser();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.name));
  try {
    const project = await wb.saveProject({
      name: 'Review loop',
      folder: root,
      origin: `http://127.0.0.1:${(proxy.address() as { port: number }).port}`,
      captureConsent: true,
      browsers: ['chromium'],
      colorSchemes: ['light'],
      viewports: [
        { width: 480, height: 600 },
        { width: 360, height: 640 },
      ],
      paths: ['/'],
    });
    const first = wb.enqueue(project.id, 'visual');
    if (!first) throw new Error('first visual run was not queued');
    await wb.idle();
    const firstRun = wb.store.run(first.id);
    if (!firstRun) throw new Error('first visual run is missing');
    const baselines = firstRun.result?.captures ?? [];
    expect(baselines).toHaveLength(2);
    for (const capture of baselines) await wb.approveBaseline(first.id, capture.id);

    changed = true;
    const second = wb.enqueue(project.id, 'visual');
    if (!second) throw new Error('second visual run was not queued');
    await wb.idle();
    const secondRun = wb.store.run(second.id);
    if (!secondRun) throw new Error('second visual run is missing');
    const changedCaptures = secondRun.result?.captures ?? [];
    expect(changedCaptures.map((capture) => capture.status)).toEqual(['changed', 'changed']);
    await wb.close();

    app = await startWorkbench({
      roots: [root],
      stateDirectory: state,
      port: 0,
      adminToken: 'review-loop-test-administrator-token',
    });
    await page.goto(app.origin);
    await page.getByLabel('Administrator token').fill('review-loop-test-administrator-token');
    await page.getByRole('button', { name: 'Open workbench' }).click();
    await page.getByRole('heading', { name: 'Workspace overview' }).waitFor();
    await page.goto(`${app.origin}?view=runs&run=${secondRun.id}`);
    await page.locator('.capture').first().waitFor();
    const cards = page.locator('.capture');
    expect(await cards.count()).toBe(2);
    const desktop = cards.filter({ hasText: '480 × 600' });
    const mobile = cards.filter({ hasText: '360 × 640' });
    expect(await desktop.count()).toBe(1);
    expect(await mobile.count()).toBe(1);
    expect(await page.locator('[data-review-loop-hint]').isVisible()).toBe(true);

    // Sad path first: a runs with nothing focused and must approve nothing.
    await page.keyboard.press('a');
    expect(await desktop.getByRole('button', { name: 'Approve as baseline' }).isVisible()).toBe(
      true,
    );
    expect(await mobile.getByRole('button', { name: 'Approve as baseline' }).isVisible()).toBe(
      true,
    );

    await expect.poll(() => desktop.getAttribute('aria-current')).toBe(null);
    await page.keyboard.press('j');
    await expect.poll(() => desktop.getAttribute('aria-current')).toBe('true');
    await page.keyboard.press('j');
    await expect.poll(() => desktop.getAttribute('aria-current')).toBe(null);
    await expect.poll(() => mobile.getAttribute('aria-current')).toBe('true');
    // j wraps from the last changed capture back to the first.
    await page.keyboard.press('j');
    await expect.poll(() => mobile.getAttribute('aria-current')).toBe(null);
    await expect.poll(() => desktop.getAttribute('aria-current')).toBe('true');
    // k walks backwards, wrapping from the first changed capture to the last.
    await page.keyboard.press('k');
    await expect.poll(() => desktop.getAttribute('aria-current')).toBe(null);
    await expect.poll(() => mobile.getAttribute('aria-current')).toBe('true');
    await page.keyboard.press('k');
    await expect.poll(() => desktop.getAttribute('aria-current')).toBe('true');

    // Typing in a gallery input must not move the review loop: the key filters
    // the list normally and the focused capture survives the round-trip.
    await page.getByLabel('Search capture paths').fill('/');
    await page.keyboard.press('j');
    await expect.poll(() => cards.count()).toBe(0);
    await page.getByLabel('Search capture paths').fill('');
    await expect.poll(() => cards.count()).toBe(2);
    await expect.poll(() => desktop.getAttribute('aria-current')).toBe('true');
    await page.getByRole('heading', { name: 'Review loop / visual' }).click();

    // a approves ONLY the focused capture.
    await page.keyboard.press('a');
    await expect.poll(() => desktop.getByText('current approved baseline').count()).toBe(1);
    expect(await desktop.getByRole('button', { name: 'Approve as baseline' }).count()).toBe(0);
    expect(await mobile.getByRole('button', { name: 'Approve as baseline' }).isVisible()).toBe(
      true,
    );
    await expect.poll(async () => (errors.length ? errors.join('; ') : true)).toBe(true);

    // Sad path: a run with no changed captures has no loop to drive.
    await page.goto(`${app.origin}?view=runs&run=${firstRun.id}`);
    await page.locator('.capture').first().waitFor();
    expect(await page.locator('[data-review-loop-hint]').count()).toBe(0);
    await page.keyboard.press('j');
    await page.keyboard.press('k');
    expect(await page.locator('.capture[aria-current]').count()).toBe(0);
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
    if (app) await app.close();
    else await wb.close();
    await stopApp(target.child);
    await new Promise<void>((resolveProxy) => proxy.close(() => resolveProxy()));
    await rm(state, { recursive: true, force: true });
  }
}, 150_000);
