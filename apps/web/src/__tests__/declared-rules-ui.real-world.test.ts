import { mkdtemp, rm } from 'node:fs/promises';
import { openInventoryTab } from './inventory-tabs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { makeRepository } from '../../../../packages/source-ua-adapter/src/__tests__/test-repo';
import { launchDashboardBrowser } from './dashboard-browser';
import { startWorkbench } from './workbench-runtime';

/**
 * Declared business rules + intent fusion in the real dashboard (refs #402):
 * after a real source discovery, the coverage section renders per-route
 * declared-rule chips (validation/authorization with counts) and the
 * intent-ledger fusion chip — 'no intent proposal yet' for routes no agent
 * run has proposed for.
 */
it('renders declared rule chips and intent omission next to route coverage', async () => {
  const repo = await makeRepository('reference-auth-app');
  const directory = await mkdtemp(join(tmpdir(), 'arxic-web-declared-rules-'));
  const app = await startWorkbench({
    roots: [repo.root],
    stateDirectory: directory,
    adminToken: 'test-administrator-token-32-characters',
    port: 0,
  });
  const browser = await launchDashboardBrowser();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.name));
  try {
    await page.goto(app.origin);
    await page.getByLabel('Administrator token').fill('test-administrator-token-32-characters');
    await page.getByRole('button', { name: 'Open workbench' }).click();
    await page.getByRole('heading', { name: 'Workspace overview' }).waitFor();
    await page.locator('#new-project').click();
    await page.getByLabel('Project folder', { exact: true }).fill(repo.root);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByLabel('Project name', { exact: true }).fill('Declared rules reference');
    await page.getByLabel('Running test app origin').fill('http://127.0.0.1:1');
    await page.getByRole('button', { name: 'Save project' }).click();
    await page.getByRole('button', { name: 'Discover intents', exact: true }).click();
    await expect
      .poll(() => page.locator('.run-detail').textContent(), { timeout: 60_000 })
      .toContain('source surfaces');
    await page.getByRole('button', { name: 'Intent inventory', exact: true }).click();
    await openInventoryTab(page, 'Declarations');

    const section = page.locator('[data-route-coverage]');
    const row = async (path: string) =>
      (await section
        .locator(`[data-route-rules="${path}"]`)
        .textContent()
        .catch(() => null)) ?? '';
    // The real /login route declares validation and authorization rules.
    await expect.poll(() => row('/login'), { timeout: 30_000 }).toContain('validation');
    await expect.poll(() => row('/login')).toContain('authorization');
    // No agent run has proposed for any route: an honest intent omission.
    await expect.poll(() => row('/login')).toContain('no intent proposal yet');
    // The runtime gap note reads as the configured-stub origin it is.
    const sectionText = async () => (await section.textContent().catch(() => null)) ?? '';
    await expect.poll(sectionText).toContain('origin-unreachable');
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
    await app.close();
    await rm(repo.root, { recursive: true, force: true });
    await rm(directory, { recursive: true, force: true });
  }
}, 180_000);
