import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';
import { captureMaskedViewport } from '@arxic/playwright-screenshot-privacy';
import {
  bootFixtureApp,
  stopApp,
  vulnerableAuthApp,
} from '../../../../packages/real-world-testkit/src';
import { makeRepository } from '../../../../packages/source-ua-adapter/src/__tests__/test-repo';
import type { FrontendInventory } from '@arxic/source-ua-adapter';
import { startWorkbench } from './workbench-runtime';
import { launchDashboardBrowser, resizeDashboard, settleDashboard } from './dashboard-browser';
import { dashboardProof } from './dashboard-proof';

it('shows source-bound EJS controls in the real dashboard and corroborates the reference page without promoting source truth', async () => {
  const root = resolve(import.meta.dirname, '../../../..');
  const repo = await makeRepository('vulnerable-auth-app');
  const target = await bootFixtureApp(root, vulnerableAuthApp, 'frontend-template');
  const state = await mkdtemp(join(tmpdir(), 'frontend-template-ui-'));
  const app = await startWorkbench({
    roots: [repo.root],
    stateDirectory: state,
    port: 0,
    adminToken: 'frontend-template-test-administrator',
  });
  const browser = await launchDashboardBrowser();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  const evidence =
    process.env.ARXIC_TEMPLATE_EVIDENCE_DIR ??
    (process.env.ARXIC_WEB_EVIDENCE_DIR
      ? join(process.env.ARXIC_WEB_EVIDENCE_DIR, 'frontend-template')
      : undefined);
  const proof = dashboardProof(page, evidence);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.name));
  try {
    const targetContext = await browser.newContext({
      viewport: { width: 900, height: 900 },
      reducedMotion: 'reduce',
    });
    const targetPage = await targetContext.newPage();
    await targetPage.goto(target.origin);
    const observed = {
      forms: await targetPage.locator('form').count(),
      inputs: await targetPage.locator('input').count(),
      buttons: await targetPage.locator('button').count(),
    };
    expect(observed).toEqual({ forms: 4, inputs: 5, buttons: 4 });
    const sourceBytes = await readFile(
      join(root, 'test-fixtures/vulnerable-auth-app/src/views/index.ejs'),
    );
    const sourceHash = createHash('sha256').update(sourceBytes).digest('hex');
    if (evidence) {
      await mkdir(evidence, { recursive: true });
      const png = await captureMaskedViewport(targetPage, {
        automaticMasks: ['input,textarea'],
        requiredMasks: [],
      });
      await writeFile(join(evidence, 'reference-controls.png'), png);
      await writeFile(
        join(evidence, 'reference-controls.png.privacy.json'),
        JSON.stringify(
          {
            sha256: createHash('sha256').update(png).digest('hex'),
            policy: 'reference test app; all inputs masked',
            rawTraceRetained: false,
            humanInspection: 'not performed',
            browser: { name: browser.browserType().name(), version: browser.version() },
          },
          null,
          2,
        ),
      );
    }
    await targetContext.close();
    await page.goto(app.origin);
    await page.getByLabel('Administrator token').fill('frontend-template-test-administrator');
    await page.getByRole('button', { name: 'Open workbench' }).click();
    await page.locator('#new-project').click();
    await page.getByLabel('Project folder', { exact: true }).fill(repo.root);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByLabel('Project name', { exact: true }).fill('Express template discovery');
    await page.getByLabel('Running test app origin').fill(target.origin);
    await page.getByRole('button', { name: 'Save project', exact: true }).click();
    await page.getByRole('heading', { name: 'Express template discovery', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Discover intents', exact: true }).click();
    await expect
      .poll(() => page.locator('.run-detail').textContent(), { timeout: 30000 })
      .toContain('source surfaces');
    const runId = new URL(page.url()).searchParams.get('run')!;
    const response = await page.request.get(`${app.origin}/api/runs/${runId}`);
    expect(response.status()).toBe(200);
    const inventory = (await response.json()).result.frontend as FrontendInventory;
    const controls = inventory.rows.filter(
      (row) => row.source.path === 'src/views/index.ejs' && row.kind === 'control',
    );
    expect(controls).toHaveLength(observed.forms + observed.inputs + observed.buttons);
    expect(
      controls.every(
        (row) =>
          row.truthState === 'hypothesized' &&
          row.source.commit === repo.commit &&
          row.source.blobSha256 === sourceHash,
      ),
    ).toBe(true);
    expect(inventory.gaps).toContainEqual({
      path: 'src/views/index.ejs',
      reason: 'template-expressions-not-evaluated',
    });
    expect(inventory.coverage.complete).toBe(false);
    if (evidence)
      await writeFile(
        join(evidence, 'source-runtime-check.json'),
        JSON.stringify(
          {
            observed,
            sourceHash,
            sourceCommit: repo.commit,
            controls,
            gaps: inventory.gaps.filter((gap) => gap.path === 'src/views/index.ejs'),
            complete: false,
            runtimeScope: 'default reference page only',
          },
          null,
          2,
        ),
      );
    await page.getByRole('button', { name: 'Intent inventory', exact: true }).click();
    await page.getByLabel('Declaration kind').selectOption('control');
    await page.getByLabel('Search declarations').fill('src/views/index.ejs');
    await page
      .locator('#declaration-search')
      .getByRole('button', { name: 'Search', exact: true })
      .click();
    await settleDashboard(page);
    const shown = await page.locator('[data-frontend-rows] tbody tr').count();
    const kindSelected = (await page.getByLabel('Declaration kind').inputValue()) === 'control';
    await proof.audit(
      '00-filter-result',
      'Control filter must retain its selection and show only source controls',
      [
        {
          id: 'kind-filter-selected',
          passed: kindSelected,
          values: { selected: kindSelected ? 1 : 0 },
        },
        { id: 'kind-filter-count', passed: shown === 13, values: { expected: 13, actual: shown } },
      ],
    );
    await expect.poll(() => page.locator('[data-frontend-rows] tbody tr').count()).toBe(13);
    await page.getByText('Coverage gaps', { exact: true }).click();
    await page.getByText('template-expressions-not-evaluated', { exact: false }).waitFor();
    for (const width of [1440, 390]) {
      await resizeDashboard(page, { width, height: 1000 });
      await page
        .getByRole('heading', { name: 'Frontend declarations', exact: true })
        .scrollIntoViewIfNeeded();
      const audit = await proof.audit(
        `01-source-controls-${width}`,
        'Find all thirteen literal EJS controls while template runtime coverage remains a gap',
        [
          {
            id: 'literal-control-count',
            passed: controls.length === 13,
            values: {
              declared: controls.length,
              rendered: observed.forms + observed.inputs + observed.buttons,
            },
          },
        ],
      );
      expect(audit.violations).toEqual([]);
      expect(audit.overflow).toBe(0);
    }
    await page.locator('[data-frontend-rows] tbody tr').last().scrollIntoViewIfNeeded();
    const bottom = await proof.audit(
      '02-last-control-mobile',
      'Scroll to the final source-bound control on mobile',
    );
    expect(bottom.violations).toEqual([]);
    expect(bottom.overflow).toBe(0);
    expect(errors).toEqual([]);
  } finally {
    await proof.finish();
    await browser.close();
    await app.close();
    await stopApp(target.child);
    await rm(target.runtimeDirectory, { recursive: true, force: true });
    await rm(state, { recursive: true, force: true });
    await rm(repo.root, { recursive: true, force: true });
  }
}, 120_000);
