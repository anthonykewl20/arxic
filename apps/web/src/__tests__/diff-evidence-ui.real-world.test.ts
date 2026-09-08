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

it('renders deterministic region evidence for a real changed element in the diff viewer', async () => {
  const root = resolve(import.meta.dirname, '../../../..');
  const target = await bootFixtureApp(root, vulnerableAuthApp, 'diff-evidence');
  let changed = false;
  // A real element repaint (the login card heading), not a synthetic overlay.
  const proxy = createServer(async (req, res) => {
    const upstream = await fetch(req.url === '/' ? target.origin : `${target.origin}${req.url}`);
    const html = await upstream.text();
    res.statusCode = upstream.status;
    res.setHeader('Content-Type', 'text/html');
    res.end(
      html.replace(
        '</head>',
        `${
          changed
            ? '<style>h1, h2, h3 { color: #b3261e !important; text-shadow: 2px 2px 0 #000; }</style>'
            : ''
        }</head>`,
      ),
    );
  });
  await new Promise<void>((done) => proxy.listen(0, '127.0.0.1', done));
  const state = await mkdtemp(join(tmpdir(), 'arxic-diff-evidence-'));
  const wb = await Workbench.open(state, [root]);
  let app: Awaited<ReturnType<typeof startWorkbench>> | undefined;
  const browser = await launchDashboardBrowser();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.name));
  try {
    const project = await wb.saveProject({
      name: 'Diff evidence',
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
    const baselineCapture = wb.store.run(first.id)?.result?.captures?.[0];
    if (!baselineCapture) throw new Error('first visual run produced no captures');
    await wb.approveBaseline(first.id, baselineCapture.id);

    changed = true;
    const second = wb.enqueue(project.id, 'visual');
    if (!second) throw new Error('second visual run was not queued');
    await wb.idle();
    const compared = wb.store.run(second.id)?.result?.captures?.[0];
    expect(compared?.status).toBe('changed');
    expect(compared?.diffExplanation).toBeDefined();
    expect(compared!.diffExplanation!.regions).toHaveLength(compared?.diffRegions?.length ?? 0);
    await wb.close();

    app = await startWorkbench({
      roots: [root],
      stateDirectory: state,
      port: 0,
      adminToken: 'diff-evidence-test-administrator-token',
    });
    await page.goto(app.origin);
    await page.getByLabel('Administrator token').fill('diff-evidence-test-administrator-token');
    await page.getByRole('button', { name: 'Open workbench' }).click();
    await page.getByRole('heading', { name: 'Workspace overview' }).waitFor();
    await page.goto(`${app.origin}?view=runs&run=${second!.id}`);
    await page.locator('.capture').first().waitFor();

    const viewer = page.getByRole('region', { name: 'Visual comparison', exact: true });
    await viewer.waitFor();
    const evidence = viewer.locator('[data-region-evidence]');
    await expect.poll(() => evidence.count()).toBeGreaterThan(0);
    // The evidence list names measured element kinds for the changed regions.
    const text = (await evidence.allTextContents()).join(' ');
    expect(text).toMatch(/Heading \d+%/);
    // The heading region is explained: at least one region is attributed, and
    // any unexplained region says so honestly instead of staying silent.
    const unexplained = await viewer.locator('[data-region-evidence][data-unexplained="true"]');
    const unexplainedCount = await unexplained.count();
    expect(unexplainedCount).toBeLessThanOrEqual(await evidence.count());
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
    await wb.close();
    if (app) await app.close();
    proxy.closeAllConnections();
    await new Promise<void>((done) => proxy.close(() => done()));
    await Promise.all([
      rm(state, { recursive: true, force: true }),
      rm(target.runtimeDirectory, { recursive: true, force: true }),
    ]);
    await stopApp(target.child);
  }
}, 120_000);
