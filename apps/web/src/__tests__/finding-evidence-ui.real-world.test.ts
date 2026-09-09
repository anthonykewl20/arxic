import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it, vi } from 'vitest';
import { launchDashboardBrowser } from './dashboard-browser';
import {
  bootFixtureApp,
  stopApp,
  vulnerableAuthApp,
} from '../../../../packages/real-world-testkit/src';
import { startWorkbench } from './workbench-runtime';

/**
 * Per-finding grounding in the real dashboard (refs #402): each asserted
 * defect renders its own screenshot link, reproduction recipe and independent
 * acceptance status — the administrator criterion when supplied, the explicit
 * gap wording when not.
 */
it('renders per-finding screenshot, reproduction and acceptance links', async () => {
  const root = resolve(import.meta.dirname, '../../../..');
  const state = await mkdtemp(join(tmpdir(), 'arxic-finding-evidence-ui-'));
  const target = await bootFixtureApp(root, vulnerableAuthApp, 'finding-evidence-ui');
  const provider = createServer(async (request, response) => {
    if (request.method === 'GET' && request.url === '/models') {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ data: [{ id: 'vendor/vision:local' }] }));
      return;
    }
    response.setHeader('Content-Type', 'application/json');
    response.end(
      JSON.stringify({
        id: 'finding-evidence-ui-stub',
        model: 'vendor/vision:local',
        choices: [
          {
            message: {
              role: 'assistant',
              content: JSON.stringify({
                schemaVersion: 'arxic-web-visual-review-v1',
                findings: [
                  {
                    title: 'Inspect form alignment',
                    description: 'Form controls appear unevenly aligned in this viewport.',
                    severity: 'warning',
                    region: { x: 8, y: 100, width: 700, height: 250 },
                    suggestedCheck: 'Compare label and control alignment at this viewport.',
                  },
                ],
              }),
            },
          },
        ],
        usage: { prompt_tokens: 90, completion_tokens: 40, total_tokens: 130 },
      }),
    );
  });
  await new Promise<void>((done) => provider.listen(0, '127.0.0.1', done));
  vi.stubEnv('ARXIC_MODEL_PROVIDER', 'http');
  vi.stubEnv(
    'ARXIC_MODEL_BASE_URL',
    `http://127.0.0.1:${(provider.address() as { port: number }).port}`,
  );
  vi.stubEnv('ARXIC_SECRET_REVIEW_UI', 'finding-evidence-ui-canary');
  const providerPort = (provider.address() as { port: number }).port;
  vi.stubEnv(
    'ARXIC_MODEL_CONNECTIONS',
    JSON.stringify([
      {
        id: 'image-provider',
        label: 'Image model provider',
        transport: 'http',
        baseUrl: `http://127.0.0.1:${providerPort}`,
        credentialRef: 'ARXIC_SECRET_REVIEW_UI',
        models: [
          {
            id: 'vendor/vision:local',
            prices: { promptPerMillion: 0.1, completionPerMillion: 0.2 },
          },
        ],
        customModelPrices: { promptPerMillion: 0.1, completionPerMillion: 0.2 },
      },
    ]),
  );
  const app = await startWorkbench({
    roots: [root],
    stateDirectory: state,
    adminToken: 'test-administrator-token-32-characters',
    port: 0,
  });
  const browser = await launchDashboardBrowser({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.name));
  try {
    await page.goto(app.origin);
    await page.getByLabel('Administrator token').fill('test-administrator-token-32-characters');
    await page.getByRole('button', { name: 'Open workbench' }).click();
    await page.getByRole('heading', { name: 'Workspace overview' }).waitFor();
    await page.locator('#new-project').click();
    await page
      .getByLabel('Project folder', { exact: true })
      .fill(join(root, 'test-fixtures/vulnerable-auth-app'));
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByLabel('Project name', { exact: true }).fill('Finding evidence reference');
    await page.getByLabel('Running test app origin').fill(target.origin);
    await page.getByLabel('Viewport sizes').fill('800x600');
    await page.getByLabel('I authorize screenshot capture', { exact: false }).check();
    await page.getByRole('button', { name: 'Save project' }).click();
    await page.getByRole('button', { name: 'Visual test', exact: true }).click();
    await expect
      .poll(() => page.locator('.run-detail').textContent(), { timeout: 30_000 })
      .toContain('viewport checkpoints captured');
    await page.getByText('Ask AI to review this screenshot', { exact: true }).click();
    await page.waitForTimeout(5500);
    await page.getByLabel('Review provider', { exact: true }).selectOption('image-provider');
    await page.getByLabel('Review model', { exact: true }).fill('vendor/vision:local');
    await page
      .getByLabel('Independent acceptance criterion', { exact: false })
      .fill('Labels and fields should align at the configured viewport.');
    await page.getByLabel('I inspected this screenshot', { exact: false }).check();
    await page.getByRole('button', { name: 'Review these pixels' }).click();

    const finding = page.locator('[data-finding="finding-1"]');
    const findingText = async () => (await finding.textContent().catch(() => null)) ?? '';
    await expect.poll(findingText, { timeout: 60_000 }).toContain('Inspect form alignment');
    // The finding links its own screenshot and reproduction recipe.
    const grounding = finding.locator('[data-finding-grounding]');
    const groundingText = async () => (await grounding.textContent().catch(() => null)) ?? '';
    await expect.poll(groundingText).toContain('Reproduce:');
    await expect.poll(groundingText).toContain('800 × 600');
    expect(await grounding.getByRole('link', { name: 'Screenshot evidence' }).count()).toBe(1);
    // The deterministic determination renders: the stub's finding sits over
    // clean pixels on the real page — explicitly unconfirmed.
    const determination = finding.locator('[data-finding-determination]');
    await expect
      .poll(async () => (await determination.textContent().catch(() => null)) ?? '')
      .toContain('unconfirmed — no deterministic corroboration');
    // The administrator criterion is the independent acceptance for this finding.
    const acceptance = finding.locator('[data-finding-acceptance]');
    const acceptanceText = async () => (await acceptance.textContent().catch(() => null)) ?? '';
    await expect.poll(acceptanceText).toContain('Independent acceptance:');
    await expect.poll(acceptanceText).toContain('Labels and fields should align');
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
    await app.close();
    await new Promise<void>((done) => provider.close(() => done()));
    await stopApp(target.child);
    await rm(state, { recursive: true, force: true });
  }
}, 240_000);
