import { mkdtemp, rm } from 'node:fs/promises';
import { openInventoryTab } from './inventory-tabs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { makeRepository } from '../../../../packages/source-ua-adapter/src/__tests__/test-repo';
import { launchDashboardBrowser } from './dashboard-browser';
import { startWorkbench } from './workbench-runtime';

/**
 * Route omission coverage in the real dashboard (refs #402): after a real
 * source discovery, the intent inventory panel exposes per-route omission
 * chips — the real /login route references an error state through its own
 * ternary while loading/empty/tests/docs stay absent, and the home route is
 * absent on every dimension.
 */
it('renders per-route omission coverage in the inventory panel', async () => {
  const repo = await makeRepository('reference-auth-app');
  const directory = await mkdtemp(join(tmpdir(), 'arxic-web-route-coverage-'));
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
    await page.getByLabel('Project name', { exact: true }).fill('Route omission coverage');
    await page.getByLabel('Running test app origin').fill('http://127.0.0.1:1');
    await page.getByRole('button', { name: 'Save project' }).click();
    await page.getByRole('button', { name: 'Read the code', exact: true }).click();
    await expect
      .poll(() => page.locator('.run-detail').textContent(), { timeout: 60_000 })
      .toContain('source surfaces');
    await page.getByRole('button', { name: 'Code scan', exact: true }).click();
    await openInventoryTab(page, 'declarations');

    const section = page.locator('[data-route-coverage]');
    const sectionText = async () => (await section.textContent().catch(() => null)) ?? '';
    await expect.poll(sectionText, { timeout: 30_000 }).toContain('GET /login');

    const loginRow = async () =>
      (await section
        .locator('[data-route="/login"]')
        .textContent()
        .catch(() => null)) ?? '';
    await expect.poll(loginRow).toContain('error referenced');
    await expect.poll(loginRow).toContain('loading absent');
    await expect.poll(loginRow).toContain('empty absent');
    await expect.poll(loginRow).toContain('tests absent');

    const homeRow = async () =>
      (await section
        .locator('[data-route="/"]')
        .textContent()
        .catch(() => null)) ?? '';
    await expect.poll(homeRow).toContain('loading absent');
    await expect.poll(homeRow).toContain('error absent');
    await expect.poll(homeRow).toContain('empty absent');

    // The omission wording keeps the source-tier honesty boundary.
    await expect.poll(sectionText).toContain('not proof of absent behavior');
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
    await app.close();
    await rm(repo.root, { recursive: true, force: true });
    await rm(directory, { recursive: true, force: true });
  }
}, 180_000);
