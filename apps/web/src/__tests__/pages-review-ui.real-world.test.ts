import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';
import {
  bootFixtureApp,
  stopApp,
  vulnerableAuthApp,
} from '../../../../packages/real-world-testkit/src';
import { launchDashboardBrowser } from './dashboard-browser';
import { Workbench } from '../workbench';
import { startWorkbench } from './workbench-runtime';
import { dashboardProof } from './dashboard-proof';
import { trackDashboardErrors } from './dashboard-errors';

/**
 * The product's centre of gravity, end to end: a person opens the dashboard,
 * sees their own pages, opens one, and decides on what changed.
 *
 * Real browser, real captures, real pixel comparison. The target is the
 * vulnerable-auth fixture behind a proxy that serves it at several paths and
 * can be made to change between runs — the same controlled-regression pattern
 * the capture gallery journey uses, so the diff under review is a genuine
 * rendering difference rather than a synthetic one.
 */
it('shows a person their pages, and lets them decide on what changed', async () => {
  const root = resolve(import.meta.dirname, '../../../..');
  const target = await bootFixtureApp(root, vulnerableAuthApp, 'pages-review');
  let changed = false;
  const titles: Record<string, string> = {
    '/': 'Home',
    '/login': 'Sign in',
    '/pricing': 'Pricing',
  };
  const proxy = createServer(async (request, response) => {
    const path = new URL(request.url ?? '/', 'http://proxy.invalid').pathname;
    const upstream = await fetch(target.origin);
    const html = await upstream.text();
    response.statusCode = Object.hasOwn(titles, path) ? 200 : 404;
    response.setHeader('Content-Type', 'text/html');
    response.end(
      html.replace(
        '</head>',
        `<style>body{background:#fff;color:#111}h1{color:${changed ? '#0b7285' : '#111'}}</style></head>`,
      ),
    );
  });
  await new Promise<void>((done) => proxy.listen(0, '127.0.0.1', done));
  const state = await mkdtemp(join(tmpdir(), 'pages-review-'));
  const wb = await Workbench.open(state, [root]);
  const browser = await launchDashboardBrowser();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const proof = dashboardProof(
    page,
    process.env.ARXIC_WEB_EVIDENCE_DIR
      ? join(process.env.ARXIC_WEB_EVIDENCE_DIR, 'pages-review')
      : undefined,
  );
  const errors = trackDashboardErrors(page);
  let app: Awaited<ReturnType<typeof startWorkbench>> | undefined;
  try {
    const project = await wb.saveProject({
      name: 'Aurora',
      folder: root,
      origin: `http://127.0.0.1:${(proxy.address() as { port: number }).port}`,
      environment: 'staging',
      paths: ['/', '/login', '/pricing'],
      captureConsent: true,
      browsers: ['chromium'],
      colorSchemes: ['light'],
      viewports: [{ width: 1280, height: 800 }],
    });
    const first = wb.store.run(wb.enqueue(project.id, 'visual').id)!;
    await wb.idle();
    const baseline = wb.store.run(first.id)!;
    expect(baseline.result!.captures).toHaveLength(3);
    // Approve every picture so the next run has something to compare against.
    for (const capture of baseline.result!.captures!)
      await wb.approveBaseline(baseline.id, capture.id);
    changed = true;
    const second = wb.store.run(wb.enqueue(project.id, 'visual').id)!;
    await wb.idle();
    const compared = wb.store.run(second.id)!;
    expect(compared.result!.captures!.filter((c) => c.status === 'changed').length).toBe(3);
    await wb.close();

    app = await startWorkbench({
      roots: [root],
      stateDirectory: state,
      port: 0,
      adminToken: 'pages-review-test-administrator-token',
    });
    await page.goto(app.origin);
    await page.getByLabel('Administrator token').fill('pages-review-test-administrator-token');
    await page.getByRole('button', { name: 'Open workbench' }).click();

    // 1. Home is Pages, and the pages are named the way a person says them.
    await page.getByRole('heading', { name: 'Pages', exact: true }).waitFor();
    for (const name of Object.values(titles))
      await page.getByRole('heading', { name, exact: true }).waitFor();
    // Not one HTTP method, source path or engine truth-state on the way in.
    const grid = await page.locator('.page-grid').innerText();
    expect(grid).not.toMatch(/\b(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|ANY)\b/u);
    expect(grid).not.toMatch(/hypothesized|needs-baseline|unchanged|disposition/iu);
    expect(grid).toContain('Needs your decision');
    // Every card carries a real screenshot and the same one action.
    expect(await page.locator('.page-card img').count()).toBe(3);
    expect(await page.getByRole('button', { name: 'Run test', exact: true }).count()).toBe(3);

    // 2. The navigation says how many decisions are waiting.
    expect(await page.locator('[data-nav-badge="changes"]').textContent()).toBe('3');

    await proof
      .audit('01-pages', 'Pages home lists real pages with screenshots and one action each')
      .then((result) => {
        expect(result.details).toEqual([]);
        expect(result.overflow).toBe(0);
      });

    // 3. A page explains itself: how it looks, what it has, what was checked,
    //    where it comes from — the four things the brief asked a page to say.
    await page.locator('[data-open-page="/login"]').click();
    await page.getByRole('heading', { name: 'Sign in', exact: true }).waitFor();
    for (const section of [
      'How it looks',
      // Rendered with a typographic apostrophe, as the copy is written.
      'What\u2019s on this page',
      'Checks',
      'Where it comes from',
      'History',
    ])
      await page.getByRole('heading', { name: section, exact: true }).waitFor();
    await page
      .getByText(/\d+ (?:form fields?|links?|buttons?)/u)
      .first()
      .waitFor();
    // Checks read as sentences, and the engine's own names stay one click away.
    // The check reads as a sentence in the list, and again beside its engine
    // name in the disclosure — which is closed, so the name is not on screen.
    await page.getByText('No JavaScript errors', { exact: true }).first().waitFor();
    expect(await page.getByText('script-errors', { exact: true }).isVisible()).toBe(false);
    await page.getByRole('button', { name: 'Show technical names' }).click();
    await page.getByText('script-errors', { exact: true }).waitFor();
    // The project's environment travels with the page.
    await page.getByText('Staging', { exact: true }).first().waitFor();

    await proof
      .audit('02-page', 'One page explains what it has, what was checked and what changed')
      .then((result) => {
        expect(result.details).toEqual([]);
        expect(result.overflow).toBe(0);
      });

    // 4. The review queue is a decision, with both pictures in front of it.
    await page.locator('[data-nav="changes"]').click();
    await page.getByRole('heading', { name: 'Changes', exact: true }).waitFor();
    expect(await page.locator('[data-change]').count()).toBe(3);
    await page.getByText('What you approved', { exact: true }).first().waitFor();
    await page.getByText('Now', { exact: true }).first().waitFor();
    // The measurement is available, not imposed.
    expect(
      await page
        .getByRole('region', { name: 'Visual comparison', exact: true })
        .first()
        .isVisible(),
    ).toBe(false);
    await page.getByText('Compare them closely', { exact: true }).first().click();
    await page.getByRole('region', { name: 'Visual comparison', exact: true }).first().waitFor();

    await proof
      .audit('03-changes', 'Review queue shows before and after with one decision')
      .then((result) => {
        expect(result.details).toEqual([]);
        expect(result.overflow).toBe(0);
      });

    // 5. Approving one clears it from the queue, and the badge follows.
    await page.locator('[data-change] [data-approve]').first().click();
    await expect.poll(() => page.locator('[data-change]').count(), { timeout: 30_000 }).toBe(2);
    await expect
      .poll(() => page.locator('[data-nav-badge="changes"]').textContent(), { timeout: 30_000 })
      .toBe('2');
    expect(errors.hard()).toEqual([]);
  } finally {
    await browser.close();
    await wb.close().catch(() => {});
    if (app) await app.close();
    proxy.closeAllConnections();
    await new Promise<void>((done) => proxy.close(() => done()));
    await Promise.all([
      rm(state, { recursive: true, force: true }),
      rm(target.runtimeDirectory, { recursive: true, force: true }),
    ]);
    await stopApp(target.child);
  }
}, 240_000);
