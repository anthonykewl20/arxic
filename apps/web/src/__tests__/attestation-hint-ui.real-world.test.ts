import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { launchDashboardBrowser } from './dashboard-browser';
import { startWorkbench } from './workbench-runtime';
import { makeRepository } from '../../../../packages/source-ua-adapter/src/__tests__/test-repo';

/**
 * Issue #473 AC2: the guided-execution setup surface must document the
 * target-attestation prerequisite — the running app serves the attestation at
 * the configured path without redirecting — with the route-recipe doc link,
 * right where the attestation path is configured.
 */
it('documents the target-attestation prerequisite next to the attestation path setting', async () => {
  const repo = await makeRepository('reference-auth-app');
  const directory = await mkdtemp(join(tmpdir(), 'arxic-web-attestation-hint-'));
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
    await page.getByLabel('Project name', { exact: true }).fill('Attestation hint reference');
    await page.getByLabel('Running test app origin').fill('http://127.0.0.1:1');
    await page.getByRole('button', { name: 'Save project' }).click();
    await page.getByRole('button', { name: 'Discover intents', exact: true }).click();
    await expect
      .poll(() => page.locator('.run-detail').textContent(), { timeout: 60_000 })
      .toContain('source surfaces');
    await page.getByRole('button', { name: 'Intent inventory', exact: true }).click();
    await expect
      .poll(() => page.locator('#content').textContent())
      .toContain('Save guided AI settings to start a campaign');
    await page.getByRole('button', { name: 'Configure campaign settings' }).click();
    await page.getByLabel('Configure AI execution in this dashboard').check();

    // The prerequisite note lives with the attestation path declaration.
    // <summary> carries no button role — click it directly.
    const declarations = page
      .locator('details')
      .filter({ hasText: 'Login and deployment declarations' });
    await declarations.locator('summary').click();
    const declarationsText = async () => (await declarations.textContent().catch(() => null)) ?? '';
    await expect.poll(declarationsText).toContain('must serve the attestation document');
    await expect.poll(declarationsText).toContain('docs/attestation-for-your-app.md');
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
    await app.close();
    await rm(repo.root, { recursive: true, force: true });
    await rm(directory, { recursive: true, force: true });
  }
}, 180_000);
