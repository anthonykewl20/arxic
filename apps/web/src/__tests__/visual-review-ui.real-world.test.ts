import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { expect, it, vi } from 'vitest';
import { captureMaskedViewport } from '@arxic/playwright-screenshot-privacy';
import {
  bootFixtureApp,
  vulnerableAuthApp,
  stopApp,
} from '../../../../packages/real-world-testkit/src';
import { startWorkbench } from '../server';

it('lets an administrator inspect pixels, request a bounded AI review and inspect hypotheses on mobile', async () => {
  const root = resolve(import.meta.dirname, '../../../..');
  const state = await mkdtemp(join(tmpdir(), 'arxic-review-browser-'));
  const target = await bootFixtureApp(root, vulnerableAuthApp, 'arxic-review-ui-target');
  const requests: Array<{ model: string; authorized: boolean }> = [];
  const provider = createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/models') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ data: [{ id: 'vendor/provider-discovered:vision' }] }));
      return;
    }
    let body = '';
    for await (const c of req) body += c;
    const input = JSON.parse(body);
    requests.push({
      model: input.model,
      authorized: req.headers.authorization === 'Bearer selected-image-profile-canary',
    });
    if (
      !input.messages.some(
        (m: { content: unknown }) =>
          Array.isArray(m.content) &&
          m.content[0]?.image_url?.url.startsWith('data:image/png;base64,'),
      )
    )
      throw new Error('Missing actual PNG');
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        id: 'image-ui-model-boundary',
        model: input.model,
        choices: [
          {
            message: {
              role: 'assistant',
              content: JSON.stringify({
                schemaVersion: 'arxic-web-visual-review-v1',
                findings: [
                  {
                    title: 'Inspect control alignment',
                    description:
                      'Some visible fields appear unevenly aligned. This is a hypothesis to check.',
                    severity: 'warning',
                    region: { x: 8, y: 100, width: 700, height: 250 },
                    suggestedCheck:
                      'Compare visible control edges against the supplied alignment criterion.',
                  },
                ],
              }),
            },
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 40, total_tokens: 140 },
      }),
    );
  });
  await new Promise<void>((done) => provider.listen(0, '127.0.0.1', done));
  vi.stubEnv('ARXIC_MODEL_PROVIDER', 'http');
  vi.stubEnv(
    'ARXIC_MODEL_BASE_URL',
    `http://127.0.0.1:${(provider.address() as { port: number }).port}`,
  );
  vi.stubEnv('ARXIC_MODEL_API_KEY', 'image-ui-provider-canary');
  vi.stubEnv('ARXIC_SECRET_REVIEW_PROFILE', 'selected-image-profile-canary');
  vi.stubEnv(
    'ARXIC_MODEL_CONNECTIONS',
    JSON.stringify([
      {
        id: 'image-provider',
        label: 'Image model provider',
        transport: 'http',
        baseUrl: `http://127.0.0.1:${(provider.address() as { port: number }).port}`,
        credentialRef: 'ARXIC_SECRET_REVIEW_PROFILE',
        models: [
          {
            id: 'vendor/vision-model:local',
            prices: { promptPerMillion: 0.1, completionPerMillion: 0.2 },
          },
        ],
        customModelPrices: { promptPerMillion: 0.1, completionPerMillion: 0.2 },
      },
    ]),
  );
  vi.stubEnv('ARXIC_MODEL_BASE_URL', 'http://127.0.0.1:1');
  const app = await startWorkbench({
    roots: [root],
    stateDirectory: state,
    adminToken: 'test-administrator-token-32-characters',
    port: 0,
  });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const evidence = process.env.ARXIC_REVIEW_EVIDENCE_DIR;
  const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
  const timeline: Array<{ action: string; result: 'passed' }> = [];
  const proof = async (name: string, action: string) => {
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
          sourceCommit,
          sha256: createHash('sha256').update(bytes).digest('hex'),
          policy: 'anonymous reference-app/dashboard test data; password inputs masked',
          rawTraceRetained: false,
          humanInspection: 'not performed',
        },
        null,
        2,
      ),
    );
  };
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.name));
  try {
    const denied = await fetch(
      app.origin + '/api/runs/00000000-0000-0000-0000-000000000000/reviews',
      {
        method: 'POST',
        headers: { origin: app.origin, 'Content-Type': 'application/json' },
        body: '{}',
      },
    );
    expect(denied.status).toBe(401);
    await page.goto(app.origin);
    await page.getByLabel('Administrator token').fill('test-administrator-token-32-characters');
    await page.getByRole('button', { name: 'Open workbench' }).click();
    await page.getByRole('heading', { name: 'Workspace overview' }).waitFor();
    await page.locator('#new-project').click();
    await page.getByLabel('Project name', { exact: true }).fill('Image review reference');
    await page
      .getByLabel('Project folder', { exact: true })
      .fill(join(root, 'test-fixtures/vulnerable-auth-app'));
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
    expect(await page.getByLabel('Review model', { exact: true }).isVisible()).toBe(true);
    expect(await page.getByRole('button', { name: 'Review these pixels' }).isDisabled()).toBe(true);
    expect(await page.getByLabel('Review model', { exact: true }).inputValue()).toBe('');
    await page.getByLabel('Review provider', { exact: true }).selectOption('image-provider');
    await expect
      .poll(() =>
        page
          .locator('[data-model-controls] datalist option')
          .evaluateAll((options) => options.map((option) => option.getAttribute('value'))),
      )
      .toEqual(['vendor/provider-discovered:vision']);
    // Catalog response, not operator pricing entries, owns model suggestions.
    await page.getByLabel('Review model', { exact: true }).fill('another/custom-vision:local');
    await page
      .getByLabel('Independent acceptance criterion', { exact: false })
      .fill('Labels and fields should align at the configured viewport.');
    await page.waitForTimeout(5500);
    expect(
      await page.getByLabel('Independent acceptance criterion', { exact: false }).inputValue(),
    ).toBe('Labels and fields should align at the configured viewport.');
    expect(await page.getByLabel('Review model', { exact: true }).inputValue()).toBe(
      'another/custom-vision:local',
    );
    expect(await page.getByLabel('Review provider', { exact: true }).inputValue()).toBe(
      'image-provider',
    );
    expect(await page.evaluate(() => document.activeElement?.getAttribute('name'))).toBe(
      'acceptanceCriterion',
    );
    await page.locator('.review-controls').scrollIntoViewIfNeeded();
    await proof(
      '01-inspected-capture',
      'Real capture visible; review remains disabled without explicit inspected-image authorization',
    );
    await page.getByLabel('I inspected this screenshot', { exact: false }).check();
    let holdReady!: () => void;
    let releaseReview!: () => void;
    const heldReview = new Promise<void>((resolve) => {
      holdReady = resolve;
    });
    const releasedReview = new Promise<void>((resolve) => {
      releaseReview = resolve;
    });
    await page.route('**/api/runs/*/reviews', async (route) => {
      const response = await route.fetch();
      holdReady();
      await releasedReview;
      await route.fulfill({ response });
    });
    await page.getByRole('button', { name: 'Review these pixels' }).click();
    await heldReview;
    try {
      expect(await page.getByLabel('Review model', { exact: true }).isDisabled()).toBe(true);
      expect(
        await page.getByLabel('Independent acceptance criterion', { exact: false }).isDisabled(),
      ).toBe(true);
      expect(await page.getByRole('button', { name: 'Review these pixels' }).isDisabled()).toBe(
        true,
      );
      await proof(
        '04-review-submission-pending',
        'Review settings and submit stay disabled until the enqueue response completes',
      );
      const pendingSource = await page.locator('[data-review-form]').getAttribute('data-run');
      await page.getByRole('button', { name: 'Overview', exact: false }).click();
      await page.locator(`[data-open-run="${pendingSource}"]`).click();
      expect(await page.getByLabel('Review model', { exact: true }).isDisabled()).toBe(true);
      expect(await page.getByRole('button', { name: 'Review these pixels' }).isDisabled()).toBe(
        true,
      );
      await page.locator('.review-controls').scrollIntoViewIfNeeded();
      await proof(
        '08-pending-review-navigation',
        'Returning to the source capture preserves pending state and prevents duplicate review submission',
      );
    } finally {
      releaseReview();
    }
    await page
      .getByRole('heading', { name: 'AI visual hypotheses', exact: true })
      .waitFor({ timeout: 30_000 });
    expect(requests).toEqual([{ model: 'another/custom-vision:local', authorized: true }]);
    expect(await page.locator('.visual-review-result').textContent()).toContain('hypothesized');
    expect(await page.getByRole('button', { name: 'Run again', exact: true }).count()).toBe(0);
    expect(await page.locator('.review-image svg rect').getAttribute('width')).toBe('700');
    await page.locator('.visual-review-result').scrollIntoViewIfNeeded();
    await proof(
      '02-grounded-hypothesis',
      'Proposed region overlays the exact retained capture with criterion and separate independent check',
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('.visual-review-result').scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await proof('03-mobile-review', 'Review image and findings remain within the mobile viewport');
    await page.setViewportSize({ width: 1440, height: 1000 });
    const otherProjectResponse = await page.request.post(`${app.origin}/api/projects`, {
      headers: { origin: app.origin },
      data: {
        name: 'Separate project without runs',
        folder: join(root, 'test-fixtures/vulnerable-auth-app'),
        origin: target.origin,
      },
    });
    expect(otherProjectResponse.ok()).toBe(true);
    await expect
      .poll(() => page.getByLabel('Filter by project').locator('option').allTextContents(), {
        timeout: 10_000,
      })
      .toContain('Separate project without runs');
    await page
      .getByLabel('Filter by project')
      .selectOption({ label: 'Separate project without runs' });
    expect(await page.locator('.run-detail').count()).toBe(0);
    await proof(
      '05-project-filter',
      'Selecting another project hides the previously selected run and its review',
    );
    await page.getByLabel('Filter by project').selectOption('');
    await page.getByRole('button', { name: 'View source capture', exact: true }).click();
    await page.getByText('Ask AI to review this screenshot', { exact: true }).click();
    await page
      .getByLabel('Independent acceptance criterion', { exact: false })
      .fill('Unsubmitted session draft');
    await page.getByLabel('I inspected this screenshot', { exact: false }).check();
    const sourceRunId = await page.locator('[data-review-form]').getAttribute('data-run');
    await page.locator('#logout').click();
    await page.getByLabel('Administrator token').fill('test-administrator-token-32-characters');
    await page.getByRole('button', { name: 'Open workbench' }).click();
    await page.locator(`[data-open-run="${sourceRunId}"]`).click();
    await page.getByText('Ask AI to review this screenshot', { exact: true }).click();
    expect(
      await page.getByLabel('Independent acceptance criterion', { exact: false }).inputValue(),
    ).toBe('');
    expect(await page.getByLabel('I inspected this screenshot', { exact: false }).isChecked()).toBe(
      false,
    );
    await page.locator('.review-controls').scrollIntoViewIfNeeded();
    await proof(
      '06-new-session-consent',
      'Signing out clears the unsent review draft and requires fresh screenshot consent',
    );
    await page
      .getByLabel('Independent acceptance criterion', { exact: false })
      .fill('Expired-session draft');
    await page.getByLabel('I inspected this screenshot', { exact: false }).check();
    await page.context().clearCookies();
    await page.getByLabel('Administrator token').waitFor({ state: 'visible', timeout: 10_000 });
    await page.getByLabel('Administrator token').fill('test-administrator-token-32-characters');
    await page.getByRole('button', { name: 'Open workbench' }).click();
    await page.locator(`[data-open-run="${sourceRunId}"]`).click();
    const reviewDetails = page.locator('.review-controls');
    if (!(await reviewDetails.evaluate((element) => (element as HTMLDetailsElement).open)))
      await page.getByText('Ask AI to review this screenshot', { exact: true }).click();
    expect(
      await page.getByLabel('Independent acceptance criterion', { exact: false }).inputValue(),
    ).toBe('');
    expect(await page.getByLabel('I inspected this screenshot', { exact: false }).isChecked()).toBe(
      false,
    );
    await reviewDetails.scrollIntoViewIfNeeded();
    await proof(
      '07-expired-session-consent',
      'An invalidated session clears unsent image consent before a new administrator session',
    );
    expect(errors).toEqual([]);
    if (evidence) {
      const bytes = JSON.stringify(timeline, null, 2);
      await writeFile(join(evidence, 'timeline.json'), bytes);
      await writeFile(
        join(evidence, 'timeline.sanitization.json'),
        JSON.stringify(
          {
            sourceCommit,
            sha256: createHash('sha256').update(bytes).digest('hex'),
            method: 'allow-listed actions/assertion outcomes only; no raw DOM/network or traces',
            rawTraceRetained: false,
          },
          null,
          2,
        ),
      );
    }
  } finally {
    await browser.close();
    await app.close();
    vi.unstubAllEnvs();
    provider.closeAllConnections();
    await new Promise<void>((done) => provider.close(() => done()));
    await stopApp(target.child);
    await rm(target.runtimeDirectory, { recursive: true, force: true });
    await rm(state, { recursive: true, force: true });
  }
}, 90_000);
