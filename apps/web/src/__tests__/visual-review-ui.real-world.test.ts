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
  const provider = createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    const input = JSON.parse(body);
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
        model: 'gpt-4o-mini',
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
    await page
      .getByLabel('Independent acceptance criterion', { exact: false })
      .fill('Labels and fields should align at the configured viewport.');
    await page.waitForTimeout(5500);
    expect(
      await page.getByLabel('Independent acceptance criterion', { exact: false }).inputValue(),
    ).toBe('Labels and fields should align at the configured viewport.');
    expect(await page.evaluate(() => document.activeElement?.getAttribute('name'))).toBe(
      'acceptanceCriterion',
    );
    await page.locator('.review-controls').scrollIntoViewIfNeeded();
    await proof(
      '01-inspected-capture',
      'Real capture visible; review remains disabled without explicit inspected-image authorization',
    );
    await page.getByLabel('I inspected this screenshot', { exact: false }).check();
    await page.getByRole('button', { name: 'Review these pixels' }).click();
    await page
      .getByRole('heading', { name: 'AI visual hypotheses', exact: true })
      .waitFor({ timeout: 30_000 });
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
