import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { launchDashboardBrowser } from './dashboard-browser';
import { expect, it } from 'vitest';
import { collectVisualScene } from '../visual-oracle';
import { startWorkbench } from './workbench-runtime';
import { dashboardProof } from './dashboard-proof';

it('collects native and declared kinds from real dashboard controls without retaining their names', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'element-kinds-'));
  const token = 'kind-classification-test-administrator-token';
  const app = await startWorkbench({
    roots: [resolve(import.meta.dirname, '../../../..')],
    stateDirectory: directory,
    adminToken: token,
    port: 0,
  });
  const browser = await launchDashboardBrowser({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  const proof = dashboardProof(
    page,
    process.env.ARXIC_ELEMENTS_EVIDENCE_DIR
      ? join(process.env.ARXIC_ELEMENTS_EVIDENCE_DIR, 'classification')
      : undefined,
  );
  try {
    await page.goto(app.origin);
    await page.getByLabel('Administrator token').fill(token);
    await page.getByRole('button', { name: 'Open workbench' }).click();
    await page.getByRole('heading', { name: 'Pages', exact: true }).waitFor();
    const radio = await page
      .getByRole('radio', { name: 'Follow system theme' })
      .evaluate((element) => {
        const { x, y, width, height } = element.getBoundingClientRect();
        return { x, y, width, height };
      });
    const button = await page
      .getByRole('button', { name: 'Connect project', exact: true })
      .first()
      .evaluate((element) => {
        const { x, y, width, height } = element.getBoundingClientRect();
        return { x, y, width, height };
      });
    const scene = await collectVisualScene(page);
    expect(scene.kindSchemaVersion).toBe(1);
    const kindsAt = (box: typeof radio) =>
      scene.nodes
        .filter(
          (n) => n.x === box.x && n.y === box.y && n.width === box.width && n.height === box.height,
        )
        .map((n) => n.kind);
    expect(kindsAt(radio)).toContain(3);
    expect(kindsAt(button)).toContain(1);
    expect(scene.nodes.length).toBeGreaterThan(50);
    for (const forbidden of [token, 'Follow system theme', 'Pages', 'aria-label', 'radiogroup'])
      expect(JSON.stringify(scene)).not.toContain(forbidden);
    const audit = await proof.audit(
      '01-native-and-declared-kinds',
      'Actual dashboard native button and declared radio have bounded browsing kinds',
    );
    expect(audit.details).toEqual([]);
    expect(audit.overflow).toBe(0);
  } finally {
    await proof.finish();
    await browser.close();
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);

it('keeps a persistent stylesheet overflow as a failed audit after render settling', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dashboard-overflow-'));
  const app = await startWorkbench({
    roots: [directory],
    stateDirectory: directory,
    adminToken: 'overflow-probe-administrator-token-32',
    port: 0,
  });
  const browser = await launchDashboardBrowser();
  const context = await browser.newContext({
    viewport: { width: 320, height: 1000 },
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  const proof = dashboardProof(
    page,
    process.env.ARXIC_ELEMENTS_EVIDENCE_DIR
      ? join(process.env.ARXIC_ELEMENTS_EVIDENCE_DIR, 'intentional-overflow-guard')
      : undefined,
  );
  try {
    let alteredStylesheet = false;
    await page.route(
      (url) => url.pathname === '/app.css',
      async (route) => {
        alteredStylesheet = true;
        const response = await route.fetch();
        await route.fulfill({
          response,
          body:
            (await response.text()) +
            '\n.login-card{width:1000px!important;max-width:none!important}',
        });
      },
    );
    await page.goto(app.origin);
    expect(alteredStylesheet).toBe(true);
    const result = await proof.audit(
      'intentional-overflow',
      'Controlled stylesheet regression must remain detectable',
    );
    expect(result.verdict).toBe('failed');
    expect(result.overflow).toBeGreaterThan(0);
    expect(result.overflowNodes.some((node) => node.width === 1000)).toBe(true);
  } finally {
    await proof.finish();
    await browser.close();
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 30000);
