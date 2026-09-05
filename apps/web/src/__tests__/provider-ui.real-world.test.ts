import { createServer } from 'node:http';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { expect, it, vi } from 'vitest';
import { captureMaskedViewport } from '@arxic/playwright-screenshot-privacy';
import { startWorkbench } from '../server';

it('refreshes provider-owned models in a real browser and preserves search and stale status', async () => {
  let revision = 1;
  let failing = false;
  const provider = createServer((_request, response) => {
    if (failing) return response.writeHead(503).end('private-provider-details');
    response.end(JSON.stringify({ data: [{ id: `provider/revision-${revision}[1m]` }] }));
  }).listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => provider.once('listening', resolve));
  const state = await mkdtemp(join(tmpdir(), 'arxic-provider-ui-'));
  const address = provider.address() as { port: number };
  vi.stubEnv(
    'ARXIC_MODEL_CONNECTIONS',
    JSON.stringify([
      {
        id: 'browser-provider',
        label: 'Browser provider',
        transport: 'http',
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        models: [],
      },
    ]),
  );
  const app = await startWorkbench({
    stateDirectory: state,
    roots: [state],
    adminToken: 'test-administrator-token-32-characters',
    port: 0,
  });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  const timeline: Array<{ action: string; result: 'passed' }> = [];
  const evidence = process.env.ARXIC_PROVIDER_EVIDENCE_DIR;
  const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const capture = async (name: string, action: string) => {
    timeline.push({ action, result: 'passed' });
    if (!evidence) return;
    await mkdir(evidence, { recursive: true });
    const bytes = await captureMaskedViewport(page, {
      automaticMasks: ['input[type="password"]'],
      requiredMasks: [],
    });
    await writeFile(join(evidence, `${name}.png`), bytes);
    await writeFile(
      join(evidence, `${name}.png.privacy.json`),
      JSON.stringify(
        {
          sha256: createHash('sha256').update(bytes).digest('hex'),
          sourceCommit,
          policy: 'persona-free dashboard; password inputs masked',
          humanInspection: 'not performed',
          rawTraceRetained: false,
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
    await expect
      .poll(
        async () => (errors.length ? errors.join('; ') : await page.locator('#app').isVisible()),
        { timeout: 10_000 },
      )
      .toBe(true);
    await page.getByRole('button', { name: 'Models & accounts', exact: true }).click();
    await expect
      .poll(
        async () =>
          errors.length
            ? errors.join('; ')
            : (await page.locator('#notice').isVisible())
              ? await page.locator('#notice').textContent()
              : await page.getByRole('button', { name: 'Refresh models', exact: true }).count(),
        { timeout: 5000 },
      )
      .toBe(1);
    await page.getByRole('button', { name: 'Refresh models', exact: true }).click();
    await page.getByText('provider/revision-1[1m]', { exact: true }).waitFor();
    await capture(
      '01-provider-catalog',
      'Provider catalog loaded in React/shadcn management screen',
    );
    revision = 2;
    await page.getByRole('button', { name: 'Refresh models', exact: true }).click();
    await page.getByText('provider/revision-2[1m]', { exact: true }).waitFor();
    expect(await page.getByText('provider/revision-1[1m]', { exact: true }).count()).toBe(0);
    await page.getByLabel('Search provider models').fill('revision-2');
    await expect
      .poll(() => page.getByLabel('Search provider models').inputValue())
      .toBe('revision-2');
    failing = true;
    await page.getByRole('button', { name: 'Refresh models', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'HTTP 503' }).waitFor();
    expect(await page.getByText('provider/revision-2[1m]', { exact: true }).isVisible()).toBe(true);
    expect(await page.locator('body').textContent()).not.toContain('private-provider-details');
    await capture(
      '02-provider-stale',
      'Changed catalog replaces old IDs; failed refresh retains visibly stale data',
    );
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await capture(
      '03-provider-mobile',
      'Provider management fits mobile viewport without horizontal page overflow',
    );
    expect(errors).toEqual([]);
    if (evidence) {
      const bytes =
        JSON.stringify({ schemaVersion: 'arxic-ui-timeline-v1', actions: timeline }, null, 2) +
        '\n';
      await writeFile(join(evidence, 'timeline.json'), bytes);
      await writeFile(
        join(evidence, 'timeline.sanitization.json'),
        JSON.stringify(
          {
            sourceCommit,
            sha256: createHash('sha256').update(bytes).digest('hex'),
            policy: 'allowlisted named actions and pass disposition only',
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
    await new Promise<void>((resolve) => provider.close(() => resolve()));
    await rm(state, { recursive: true, force: true });
  }
}, 60_000);
