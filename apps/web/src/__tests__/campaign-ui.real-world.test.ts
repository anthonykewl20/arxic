import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { expect, it, vi } from 'vitest';
import { captureMaskedViewport } from '@arxic/playwright-screenshot-privacy';
import { MailpitContainer } from '../../../../packages/environment/src/mailpit-container';
import {
  bootFixtureApp,
  referenceAuthApp,
  stopApp,
} from '../../../../packages/real-world-testkit/src';
import { makeRepository } from '../../../../packages/source-ua-adapter/src/__tests__/test-repo';
import { startWorkbench } from '../server';

it('lets an administrator select and verify two real workflows with honest campaign coverage', async () => {
  const root = resolve(import.meta.dirname, '../../../..');
  const sourceCommit = (
    await promisify(execFile)('git', ['rev-parse', 'HEAD'], { cwd: root })
  ).stdout.trim();
  const { modelStubOutput } = await import(
    pathToFileURL(join(root, 'scripts/human-flow-e2e.mjs')).href
  );
  const mailpit = await new MailpitContainer().start();
  vi.stubEnv('ARXIC_MAILPIT_SMTP', mailpit.smtp);
  vi.stubEnv('ARXIC_MAILPIT_API', mailpit.api);
  const target = await bootFixtureApp(root, referenceAuthApp, 'web-campaign-ui');
  const repo = await makeRepository('reference-auth-app');
  const directory = await mkdtemp(join(tmpdir(), 'arxic-web-campaign-ui-'));
  const model = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const request = JSON.parse(body);
    const content = request.messages.find((m: { content: string }) =>
      m.content.includes('INVENTORY_DATA'),
    )?.content;
    const rows = JSON.parse(
      content.match(/INVENTORY_DATA[^\n]*\n([\s\S]*?)\nEND_INVENTORY_DATA/u)[1],
    );
    const reset = rows.length === 1 && rows[0].path === '/forgot-password';
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        id: 'campaign-ui-boundary',
        model: 'test-provider-boundary',
        choices: [
          {
            message: {
              role: 'assistant',
              content: JSON.stringify(
                modelStubOutput(
                  request.messages,
                  reset
                    ? {
                        path: '/forgot-password',
                        intent: 'request a password reset',
                        fromState: 'signed-out',
                        toState: 'reset-requested',
                        rationale: 'Reset hypothesis grounded in the supplied source row',
                      }
                    : undefined,
                ),
              ),
            },
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    );
  });
  await new Promise<void>((done) => model.listen(0, '127.0.0.1', done));
  vi.stubEnv('ARXIC_MODEL_PROVIDER', 'http');
  vi.stubEnv(
    'ARXIC_MODEL_BASE_URL',
    `http://127.0.0.1:${(model.address() as { port: number }).port}`,
  );
  vi.stubEnv('ARXIC_MODEL_API_KEY', 'campaign-ui-test-model-key');
  vi.stubEnv('ARXIC_SECRET_CAMPAIGN_EMAIL', 'campaign-ui@example.test');
  vi.stubEnv('ARXIC_SECRET_CAMPAIGN_PASSWORD', 'CampaignUITest9!');
  const app = await startWorkbench({
    roots: [repo.root],
    stateDirectory: directory,
    adminToken: 'test-administrator-token-32-characters',
    port: 0,
  });
  const browser = await chromium.launch({ headless: true });
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
    await page.getByRole('heading', { name: 'Workspace overview' }).waitFor();
    await page.locator('#new-project').click();
    await page.getByLabel('Project name', { exact: true }).fill('Campaign reference');
    await page.getByLabel('Project folder', { exact: true }).fill(repo.root);
    await page.getByLabel('Running test app origin').fill(target.origin);
    await page.getByRole('button', { name: 'Save project' }).click();
    await page.getByRole('button', { name: 'Discover intents', exact: true }).click();
    await expect
      .poll(() => page.locator('.run-detail').textContent(), { timeout: 30_000 })
      .toContain('source surfaces');
    await page.getByRole('button', { name: 'Intent inventory', exact: true }).click();
    await expect
      .poll(() => page.locator('#content').textContent())
      .toContain('Save guided AI settings to start a campaign');
    await page.getByRole('button', { name: 'Configure campaign settings' }).click();
    await page.getByLabel('Configure AI execution in this dashboard').check();
    await page.getByLabel('Model name', { exact: true }).fill('gpt-4o-mini');
    await page.getByLabel('Frameworks', { exact: false }).fill('nextjs');
    await page.getByLabel('Domain declarations', { exact: false }).fill('authentication');
    await page.getByLabel('Persona strategy', { exact: false }).selectOption('seed-api');
    await page
      .getByLabel('Email secret reference', { exact: true })
      .fill('ARXIC_SECRET_CAMPAIGN_EMAIL');
    await page
      .getByLabel('Password secret reference', { exact: true })
      .fill('ARXIC_SECRET_CAMPAIGN_PASSWORD');
    await page.getByRole('button', { name: 'Save project' }).click();
    const start = page.getByRole('button', { name: 'Start selected campaign', exact: true });
    expect(await start.isDisabled()).toBe(true);
    await page.getByRole('checkbox', { name: 'Select GET /login', exact: true }).check();
    await page.waitForResponse((r) => r.url().endsWith('/api/state') && r.ok());
    expect(
      await page.getByRole('checkbox', { name: 'Select GET /login', exact: true }).isChecked(),
    ).toBe(true);
    await page.getByRole('checkbox', { name: 'Select GET /forgot-password', exact: true }).check();
    expect(
      await page
        .getByRole('checkbox', { name: 'Select GET /login', exact: true })
        .evaluate((input) => {
          const label = input.closest('label')!;
          const text = [...label.childNodes].find(
            (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
          )!;
          const range = document.createRange();
          range.selectNode(text);
          const box = input.getBoundingClientRect();
          const caption = range.getBoundingClientRect();
          return box.right <= caption.left && box.top < caption.bottom && caption.top < box.bottom;
        }),
    ).toBe(true);
    await page.locator('.workflow-selection').scrollIntoViewIfNeeded();
    await capture(
      '01-selected-workflows',
      'Missing guided settings prevented launch; two source rows selected and selection survived polling',
    );
    await start.click();
    await expect
      .poll(() => page.locator('.campaign-detail').textContent(), { timeout: 120_000 })
      .toContain('2 verified');
    const detail = page.locator('.campaign-detail');
    expect(await detail.textContent()).toContain('2 selected');
    expect(await detail.textContent()).toContain('unselected');
    expect(await detail.textContent()).toContain('0 pending');
    expect(
      ((await (await fetch(mailpit.api + '/api/v1/messages')).json()) as { total: number }).total,
    ).toBeGreaterThanOrEqual(3);
    await detail.scrollIntoViewIfNeeded();
    await capture(
      '02-verified-campaign',
      'Both selected workflows passed two real verifier replays; remaining source rows stay unselected',
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await detail.scrollIntoViewIfNeeded();
    expect(await page.locator('body').evaluate((el) => el.scrollWidth <= window.innerWidth)).toBe(
      true,
    );
    await capture(
      '03-mobile-campaign',
      'Campaign coverage and per-workflow results fit a mobile viewport',
    );
    await detail.getByRole('button', { name: 'Workflow result' }).first().click();
    await expect.poll(() => page.locator('.run-detail').textContent()).toContain('verified');
    expect(
      await page
        .locator('.run-detail')
        .getByRole('button', { name: 'Run again', exact: true })
        .count(),
    ).toBe(0);
    expect(
      await page
        .locator('.run-detail')
        .getByRole('button', { name: 'View campaign', exact: true })
        .count(),
    ).toBe(1);
    expect(
      await page
        .locator('.run-detail')
        .getByRole('button', { name: 'Delete run and artifacts', exact: true })
        .count(),
    ).toBe(0);
    expect(
      await page.locator('.table tbody td').evaluateAll((cells) =>
        cells.every((cell) => {
          const box = cell.getBoundingClientRect();
          return box.left >= 0 && box.right <= window.innerWidth;
        }),
      ),
    ).toBe(true);
    await capture(
      '04-workflow-result',
      'Campaign links to the selected child engine result and diagnostic evidence',
    );
    expect(errors).toEqual([]);
    if (evidence) {
      const bytes = JSON.stringify(timeline, null, 2);
      await writeFile(join(evidence, 'timeline.json'), bytes);
      await writeFile(
        join(evidence, 'timeline.sanitization.json'),
        JSON.stringify(
          {
            sha256: createHash('sha256').update(bytes).digest('hex'),
            sourceCommit,
            method: 'allow-listed action names and assertion outcomes; no DOM/network payloads',
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
    model.closeAllConnections();
    await new Promise<void>((done) => model.close(() => done()));
    await stopApp(target.child);
    await mailpit.stop();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
    await rm(repo.root, { recursive: true, force: true });
    await rm(target.runtimeDirectory, { recursive: true, force: true });
  }
}, 180_000);
