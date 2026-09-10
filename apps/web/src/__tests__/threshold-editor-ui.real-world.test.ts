import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { launchDashboardBrowser } from './dashboard-browser';
import { trackDashboardErrors } from './dashboard-errors';
import { expect, it } from 'vitest';
import { Workbench } from '../workbench';
import { startWorkbench } from './workbench-runtime';

it('edits the per-project visual change ratio through the real project settings dialog', async () => {
  const root = resolve(import.meta.dirname, '../../../..');
  const state = await mkdtemp(join(tmpdir(), 'arxic-threshold-editor-'));
  const wb = await Workbench.open(state, [root]);
  await wb.saveProject({ name: 'Threshold editor', folder: root });
  await wb.close();
  const app = await startWorkbench({
    roots: [root],
    stateDirectory: state,
    port: 0,
    adminToken: 'threshold-editor-administrator-token',
  });
  const browser = await launchDashboardBrowser();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(10_000);
  const errors = trackDashboardErrors(page);
  try {
    await page.goto(app.origin);
    await page.getByLabel('Administrator token').fill('threshold-editor-administrator-token');
    await page.getByRole('button', { name: 'Open workbench' }).click();
    await page.getByRole('heading', { name: 'Pages', exact: true }).waitFor();
    // The project's name opens its settings; the row carries no separate
    // Settings button.
    await page.getByRole('button', { name: 'Threshold editor', exact: true }).click();
    const ratio = page.getByLabel('Visual change ratio');
    expect(await ratio.inputValue()).toBe('0');
    await ratio.fill('0.005');
    await page.getByRole('button', { name: 'Save project' }).click();
    await expect
      .poll(() => page.locator('#notice').textContent())
      .toContain('Project settings saved.');
    // The persisted value round-trips through the real PUT and back into the dialog.
    await page.getByRole('button', { name: 'Threshold editor', exact: true }).click();
    expect(await page.getByLabel('Visual change ratio').inputValue()).toBe('0.005');
    // Sad path: an out-of-range ratio is rejected without replacing the stored value.
    await page.getByLabel('Visual change ratio').fill('7');
    await page.getByRole('button', { name: 'Save project' }).click();
    await expect
      .poll(() => page.locator('#project-error').textContent())
      .toContain('visualChangeRatio must be a number from 0 to 0.5');
    await page.locator('#close-dialog').click();
    await page.getByRole('button', { name: 'Threshold editor', exact: true }).click();
    expect(await page.getByLabel('Visual change ratio').inputValue()).toBe('0.005');
    expect(errors.hard()).toEqual([]);
  } finally {
    await browser.close();
    await app.close();
    await rm(state, { recursive: true, force: true });
  }
}, 300_000);
