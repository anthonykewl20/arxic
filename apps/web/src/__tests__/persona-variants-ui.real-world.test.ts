import { createHash } from 'node:crypto';
import { openInventoryTab } from './inventory-tabs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { launchDashboardBrowser } from './dashboard-browser';
import { expect, it } from 'vitest';
import { captureMaskedViewport } from '@arxic/playwright-screenshot-privacy';
import { makeRepository } from '../../../../packages/source-ua-adapter/src/__tests__/test-repo';
import { startWorkbench } from './workbench-runtime';

it('creates a mixed persona/flag variant campaign through the real dialog and attributes outcomes per variant', async () => {
  const root = resolve(import.meta.dirname, '../../../..');
  const sourceCommit = (
    await promisify(execFile)('git', ['rev-parse', 'HEAD'], { cwd: root })
  ).stdout.trim();
  const repo = await makeRepository('reference-auth-app');
  const directory = await mkdtemp(join(tmpdir(), 'arxic-web-persona-variants-ui-'));
  const app = await startWorkbench({
    roots: [repo.root],
    stateDirectory: directory,
    adminToken: 'test-administrator-token-32-characters',
    port: 0,
  });
  const browser = await launchDashboardBrowser({ headless: true });
  const browserIdentity = { name: browser.browserType().name(), version: browser.version() };
  const dirty = !!(
    await promisify(execFile)('git', ['status', '--porcelain'], { cwd: root })
  ).stdout.trim();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.name));
  const evidence = process.env.ARXIC_CAMPAIGN_EVIDENCE_DIR;
  const timeline: Array<{ action: string; result: 'passed' }> = [];
  const capture = async (name: string, action: string) => {
    timeline.push({ action, result: 'passed' });
    if (!evidence) return;
    await mkdir(evidence, { recursive: true });
    const bytes = await captureMaskedViewport(page, {
      automaticMasks: ['input[type="password"]'],
      requiredMasks: [],
    });
    await writeFile(join(evidence, name + '.png'), bytes);
    await writeFile(
      join(evidence, name + '.png.privacy.json'),
      JSON.stringify(
        {
          sha256: createHash('sha256').update(bytes).digest('hex'),
          sourceCommit,
          browser: browserIdentity,
          dirty,
          policy: 'persona-free dashboard; password inputs masked',
          rawTraceRetained: false,
          humanInspection: 'not performed',
        },
        null,
        2,
      ),
    );
  };
  try {
    await page.goto(app.origin);
    await page.getByLabel('Administrator token').fill('test-administrator-token-32-characters');
    await page.getByRole('button', { name: 'Open workbench' }).click();
    await page.getByRole('heading', { name: 'Pages', exact: true }).waitFor();
    await page.locator('#new-project').click();
    await page.getByLabel('Project folder', { exact: true }).fill(repo.root);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByLabel('Project name', { exact: true }).fill('Persona variants reference');
    await page.getByLabel('Running test app origin').fill('http://127.0.0.1:1');
    await page.getByRole('button', { name: 'Save project' }).click();
    await page.getByRole('button', { name: 'Read the code', exact: true }).click();
    await expect
      .poll(() => page.locator('.run-detail').textContent(), { timeout: 60_000 })
      .toContain('source surfaces');
    await page.getByRole('button', { name: 'Coverage', exact: true }).click();
    await openInventoryTab(page, 'workflows');
    await expect
      .poll(() => page.locator('#content').textContent())
      .toContain('Save guided AI settings to start a campaign');
    await page.getByRole('button', { name: 'Configure campaign settings' }).click();
    await page.getByLabel('Configure AI execution in this dashboard').check();
    await page.getByLabel('Model name', { exact: true }).fill('gpt-4o-mini');
    await page.getByLabel('Frameworks', { exact: false }).fill('nextjs');
    await page.getByLabel('Domain declarations', { exact: false }).fill('authentication');
    await page.getByRole('button', { name: 'Save project' }).click();
    await page.getByRole('checkbox', { name: 'Select GET /login', exact: true }).check();
    await page.waitForResponse((r) => r.url().endsWith('/api/state') && r.ok());

    // Variants editor: add two persona variants through the real dialog inputs.
    for (const [index, label] of ['Persona A', 'Persona B'].entries()) {
      await page.getByRole('button', { name: 'Add variant' }).click();
      await page.getByLabel('Variant label').nth(index).fill(label);
      await page
        .getByLabel('Variant email secret reference')
        .nth(index)
        .fill(`ARXIC_SECRET_PERSONA_${index === 0 ? 'A' : 'B'}_EMAIL`);
      await page
        .getByLabel('Variant password secret reference')
        .nth(index)
        .fill(`ARXIC_SECRET_PERSONA_${index === 0 ? 'A' : 'B'}_PASSWORD`);
    }
    // Mixed kinds in one campaign: a feature-flag variant (kind select + one
    // flag name/value pair — the dashboard exposes one flag per variant row).
    await page.getByRole('button', { name: 'Add variant' }).click();
    await page.getByLabel('Variant label').nth(2).fill('Checkout Flag');
    await page.getByLabel('Variant kind').nth(2).selectOption('flag');
    await page.getByLabel('Flag name', { exact: true }).fill('new-checkout');
    // A select wrapped in its label folds the option texts into the accessible
    // name, so exact matching would miss it.
    await page.getByLabel('Flag value').selectOption('true');
    await page.locator('.workflow-selection').scrollIntoViewIfNeeded();
    await capture(
      '01-variant-editor',
      'Two persona variants plus a flag variant entered; ref names and flag names only',
    );

    // Sad path through the real error alert flow: a label that slugs to an
    // empty variant key is refused by the server's 400, surfaced verbatim.
    await page.getByRole('button', { name: 'Add variant' }).click();
    await page.getByLabel('Variant label').nth(3).fill('!!!');
    await page.getByRole('button', { name: 'Start selected campaign', exact: true }).click();
    await expect
      .poll(() => page.locator('#notice').textContent())
      .toContain('Variant keys use lowercase letters, digits and dashes');
    await page.getByRole('button', { name: 'Remove variant' }).nth(3).click();
    await capture(
      '02-variant-key-rejected',
      'Server 400 for an unusable variant key surfaces through the existing error alert',
    );

    await page.getByRole('button', { name: 'Start selected campaign', exact: true }).click();
    await page.getByRole('button', { name: 'Open journeys', exact: true }).click();
    await expect
      .poll(() => page.locator('.campaign-detail').textContent(), { timeout: 120_000 })
      .toContain('Persona A');
    const detail = page.locator('.campaign-detail');
    // The server accepted the mixed-kind campaign (label + slug survive the API round trip).
    await expect.poll(() => detail.textContent()).toContain('Checkout Flag');
    // Per-variant outcome attribution: one deterministic element per variant key,
    // ending in a settled (non-queued) state alongside the default run.
    await expect
      .poll(async () => page.locator('[data-variant-outcome]').count(), { timeout: 120_000 })
      .toBe(3);
    for (const key of ['persona-a', 'persona-b', 'checkout-flag'])
      await expect
        .poll(
          async () =>
            (await page.locator(`[data-variant-outcome="${key}:blocked"]`).count()) +
            (await page.locator(`[data-variant-outcome="${key}:completed"]`).count()),
          { timeout: 120_000 },
        )
        .toBe(1);
    await detail.scrollIntoViewIfNeeded();
    await capture(
      '03-variant-attribution',
      'Campaign detail attributes each variant run outcome next to the default run',
    );
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
    await app.close();
    await rm(repo.root, { recursive: true, force: true });
    await rm(directory, { recursive: true, force: true });
  }
  expect(timeline.every((entry) => entry.result === 'passed')).toBe(true);
}, 300_000);
