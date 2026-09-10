import { mkdtemp, rm } from 'node:fs/promises';
import { openInventoryTab } from './inventory-tabs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { makeRepository } from '../../../../packages/source-ua-adapter/src/__tests__/test-repo';
import { launchDashboardBrowser } from './dashboard-browser';
import { startWorkbench } from './workbench-runtime';

/**
 * State checkpoints in the real dashboard (refs #402): the wizard's state
 * checkpoint editor saves a declared state provocation through the real API,
 * and the intent inventory renders the state-checkpoint matrix — /login's
 * declared error state covered by the checkpoint.
 */
it('saves a state checkpoint through the wizard and renders the coverage matrix', async () => {
  const repo = await makeRepository('reference-auth-app');
  const directory = await mkdtemp(join(tmpdir(), 'arxic-web-state-checkpoints-ui-'));
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
    await page.getByRole('heading', { name: 'Pages', exact: true }).waitFor();
    await page.locator('#new-project').click();
    await page.getByLabel('Project folder', { exact: true }).fill(repo.root);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByLabel('Project name', { exact: true }).fill('State checkpoints reference');
    await page.getByLabel('Running test app origin').fill('http://127.0.0.1:1');
    await page.getByLabel('State checkpoints').fill('/login error error=Invalid%20credentials');
    await page.getByLabel('I authorize screenshot capture', { exact: false }).check();
    await page.getByRole('button', { name: 'Save project' }).click();
    await page.getByRole('button', { name: 'Read the code', exact: true }).click();
    await expect
      .poll(() => page.locator('.run-detail').textContent(), { timeout: 60_000 })
      .toContain('source surfaces');
    await page.getByRole('button', { name: 'Coverage', exact: true }).click();
    await openInventoryTab(page, 'declarations');

    const block = page.locator('[data-state-checkpoints]');
    const text = async () => (await block.textContent().catch(() => null)) ?? '';
    await expect.poll(text, { timeout: 30_000 }).toContain('State checkpoints');
    const loginRow = async () =>
      (await block
        .locator('[data-checkpoint-route="/login"]')
        .textContent()
        .catch(() => null)) ?? '';
    await expect.poll(loginRow).toContain('error');
    await expect.poll(loginRow).toContain('checkpoint');
    // The honesty boundary is pinned in the matrix copy.
    await expect.poll(text).toContain('plain navigation');
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
    await app.close();
    await rm(repo.root, { recursive: true, force: true });
    await rm(directory, { recursive: true, force: true });
  }
}, 180_000);
