import { mkdtemp, rm } from 'node:fs/promises';
import { openInventoryTab } from './inventory-tabs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { makeRepository } from '../../../../packages/source-ua-adapter/src/__tests__/test-repo';
import { launchDashboardBrowser } from './dashboard-browser';
import { startWorkbench } from './workbench-runtime';

/**
 * Configuration omission exposure in the real dashboard (refs #402): the
 * intent inventory panel renders the flag/persona omission block fused from
 * the saved execution settings and the real discovery — a declared flag no
 * source file reads, and the configured persona login route (present here on
 * the real fixture), with the honesty boundary wording.
 */
it('renders configuration omissions beside the route coverage section', async () => {
  const repo = await makeRepository('reference-auth-app');
  const directory = await mkdtemp(join(tmpdir(), 'arxic-web-config-omissions-ui-'));
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
    await page.getByLabel('Project name', { exact: true }).fill('Config omissions reference');
    await page.getByLabel('Running test app origin').fill('http://127.0.0.1:1');
    await page.getByLabel('Configure AI execution in this dashboard').check();
    await page.getByLabel('Model name', { exact: true }).fill('gpt-4o-mini');
    await page.getByLabel('Frameworks', { exact: false }).fill('nextjs');
    await page.getByLabel('Domain declarations', { exact: false }).fill('authentication');
    await page.getByLabel('Persona strategy').selectOption('per-pass-login');
    await page
      .getByLabel('Email secret reference', { exact: true })
      .fill('ARXIC_SECRET_PERSONA_EMAIL');
    await page
      .getByLabel('Password secret reference', { exact: true })
      .fill('ARXIC_SECRET_PERSONA_PASSWORD');
    // The flag declaration lives inside the collapsed declarations details.
    await page
      .locator('details')
      .filter({ hasText: 'Login and deployment declarations' })
      .locator('summary')
      .click();
    await page.getByLabel('Feature flag declarations').fill('orphanFlag=false');
    await page.getByRole('button', { name: 'Save project' }).click();
    await page.getByRole('button', { name: 'Read the code', exact: true }).click();
    await expect
      .poll(() => page.locator('.run-detail').textContent(), { timeout: 60_000 })
      .toContain('source surfaces');
    await page.getByRole('button', { name: 'Coverage', exact: true }).click();
    await openInventoryTab(page, 'declarations');

    const block = page.locator('[data-config-omissions]');
    const blockText = async () => (await block.textContent().catch(() => null)) ?? '';
    await expect.poll(blockText, { timeout: 30_000 }).toContain('Configuration omissions');
    // The declared flag nothing in the reference fixture reads is exposed.
    await expect.poll(blockText).toContain('flag:orphanFlag');
    await expect.poll(blockText).toContain('declared-unreferenced');
    // The configured persona login route exists on the real fixture.
    await expect.poll(blockText).toContain('persona:login-route');
    await expect.poll(blockText).toContain('referenced');
    await expect.poll(blockText).toContain('not proof of absent behavior');
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
    await app.close();
    await rm(repo.root, { recursive: true, force: true });
    await rm(directory, { recursive: true, force: true });
  }
}, 240_000);
