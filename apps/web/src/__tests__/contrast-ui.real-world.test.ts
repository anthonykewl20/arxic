import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { launchDashboardBrowser, resizeDashboard } from './dashboard-browser';
import { expect, it } from 'vitest';
import {
  bootFixtureApp,
  stopApp,
  vulnerableAuthApp,
} from '../../../../packages/real-world-testkit/src';
import { startWorkbench } from './workbench-runtime';
import { dashboardProof } from './dashboard-proof';

it('shows a real low-contrast finding with its ratio, threshold and captured region', async () => {
  const root = resolve(import.meta.dirname, '../../../..');
  const target = await bootFixtureApp(root, vulnerableAuthApp, 'contrast-inspector');
  const proxy = createServer(async (_request, response) => {
    const html = await (await fetch(target.origin)).text();
    response.setHeader('Content-Type', 'text/html');
    response.end(
      html.replace('</head>', '<style>body{background:white}h1{color:#ccc}</style></head>'),
    );
  });
  let app: Awaited<ReturnType<typeof startWorkbench>> | undefined;
  let browser: Awaited<ReturnType<typeof launchDashboardBrowser>> | undefined;
  let proof: ReturnType<typeof dashboardProof> | undefined;
  const state = await mkdtemp(join(tmpdir(), 'contrast-inspector-'));
  try {
    await new Promise<void>((done) => proxy.listen(0, '127.0.0.1', done));
    const targetOrigin = `http://127.0.0.1:${(proxy.address() as { port: number }).port}`;
    app = await startWorkbench({
      roots: [root],
      stateDirectory: state,
      port: 0,
      adminToken: 'contrast-inspector-test-token-32-characters',
    });
    const workbenchOrigin = app.origin;
    browser = await launchDashboardBrowser({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 1000 },
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    proof = dashboardProof(page, process.env.ARXIC_CONTRAST_UI_EVIDENCE_DIR);
    await page.goto(app.origin);
    await page
      .getByLabel('Administrator token')
      .fill('contrast-inspector-test-token-32-characters');
    await page.getByRole('button', { name: 'Open workbench' }).click();
    await page.getByRole('heading', { name: 'Workspace overview' }).waitFor();
    // Setup uses the public authenticated API; the existing full journeys cover GUI onboarding.
    const saved = await page.request.post(`${workbenchOrigin}/api/projects`, {
      headers: { origin: app.origin },
      data: {
        name: 'Reference contrast regression',
        folder: join(root, 'test-fixtures/vulnerable-auth-app'),
        origin: targetOrigin,
        captureConsent: true,
        viewports: [{ width: 800, height: 600 }],
      },
    });
    expect(saved.status()).toBe(201);
    const project = await saved.json();
    const queued = await page.request.post(`${workbenchOrigin}/api/projects/${project.id}/runs`, {
      headers: { origin: app.origin },
      data: { mode: 'visual' },
    });
    expect(queued.status()).toBe(202);
    const run = await queued.json();
    await expect
      .poll(
        async () =>
          (await (await page.request.get(`${workbenchOrigin}/api/runs/${run.id}`)).json()).state,
        { timeout: 30_000 },
      )
      .toBe('completed');
    await page.goto(`${workbenchOrigin}/?view=runs&run=${run.id}`);
    await page.getByText('Measured checks and coverage', { exact: true }).click();
    await page.getByLabel('Measurement verdict').selectOption('fail');
    await expect.poll(() => page.locator('.measurement-checks > li').count()).toBe(1);
    await page
      .getByText(
        'Measured ratio: 1.606:1 (display rounded) · Required: 3:1. Verdict uses the unrounded ratio.',
        { exact: true },
      )
      .waitFor();
    await page.getByRole('button', { name: 'Locate measured text' }).click();
    await page.getByRole('img', { name: 'Measured text region in captured viewport' }).waitFor();
    const audit = await proof.audit(
      '01-failed-contrast',
      'Real reference-app CSS regression: 1.606:1 heading fails 3:1; locate its retained region',
    );
    expect(audit.details).toEqual([]);
    expect(audit.overflow).toBe(0);
    await resizeDashboard(page, { width: 390, height: 844 });
    await page
      .getByRole('img', { name: 'Measured text region in captured viewport' })
      .scrollIntoViewIfNeeded();
    const mobile = await proof.audit(
      '02-mobile-failed-contrast',
      'Mobile inspector retains the measured failure and scaled screenshot region',
    );
    expect(mobile.details).toEqual([]);
    expect(mobile.overflow).toBe(0);
    await resizeDashboard(page, { width: 1280, height: 1000 });
    await page
      .getByText(
        'Measured ratio: 1.606:1 (display rounded) · Required: 3:1. Verdict uses the unrounded ratio.',
        { exact: true },
      )
      .scrollIntoViewIfNeeded();
    const ratio = await proof.audit(
      '03-contrast-ratio',
      'Inspect the failed 1.606:1 numeric ratio, independent 3:1 threshold and measurement IDs',
    );
    expect(ratio.details).toEqual([]);
    expect(ratio.overflow).toBe(0);
  } finally {
    await proof?.finish();
    await browser?.close();
    await app?.close();
    proxy.closeAllConnections();
    await new Promise<void>((done) => proxy.close(() => done()));
    await stopApp(target.child);
    await rm(target.runtimeDirectory, { recursive: true, force: true });
    await rm(state, { recursive: true, force: true });
  }
}, 90_000);
