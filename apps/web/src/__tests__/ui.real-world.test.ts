import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { expect, it } from 'vitest';
import { captureMaskedViewport } from '@arxic/playwright-screenshot-privacy';
import {
  bootFixtureApp,
  stopApp,
  vulnerableAuthApp,
} from '../../../../packages/real-world-testkit/src';
import { makeRepository } from '../../../../packages/source-ua-adapter/src/__tests__/test-repo';
import { startWorkbench } from '../server';

it('lets a real browser register a folder, discover source intent, run visual checks, approve a baseline, and manage schedules', async () => {
  const root = resolve(import.meta.dirname, '../../../..');
  const sourceCommit = (
    await promisify(execFile)('git', ['rev-parse', 'HEAD'], { cwd: root })
  ).stdout.trim();
  const repo = await makeRepository('vulnerable-auth-app');
  const state = await mkdtemp(join(tmpdir(), 'arxic-web-ui-'));
  const target = await bootFixtureApp(root, vulnerableAuthApp, 'web-ui-target');
  const app = await startWorkbench({
    roots: [repo.root],
    stateDirectory: state,
    adminToken: 'test-administrator-token-32-characters',
    port: 0,
  });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.name));
  const timeline: Array<{ action: string; result: 'passed' }> = [];
  const evidence = process.env.ARXIC_WEB_EVIDENCE_DIR;
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
          policy: 'persona-free reference-app dashboard; password inputs masked',
          rawTraceRetained: false,
          humanInspection: 'not performed',
          sourceCommit,
        },
        null,
        2,
      ),
    );
  };
  try {
    await page.goto(app.origin);
    await page.getByLabel('Administrator token').fill('incorrect-but-long-enough-token-for-test');
    await page.getByRole('button', { name: 'Open workbench' }).click();
    await expect
      .poll(() => page.getByRole('alert').first().textContent())
      .toBe('Invalid administrator token');
    await page.getByLabel('Administrator token').fill('test-administrator-token-32-characters');
    await page.getByRole('button', { name: 'Open workbench' }).click();
    await page.getByRole('heading', { name: 'Workspace overview' }).waitFor();
    await capture(
      '01-empty-workspace',
      'Invalid login refused; administrator opened empty workspace',
    );
    await page.locator('#new-project').click();
    await page.getByLabel('Project name', { exact: true }).fill('Reference frontend');
    await page.getByLabel('Project folder', { exact: true }).fill(tmpdir());
    await page.getByRole('button', { name: 'Save project' }).click();
    await expect.poll(() => page.locator('#project-error').textContent()).toContain('outside');
    await page.getByLabel('Project folder', { exact: true }).fill(repo.root);
    await page.getByLabel('Running test app origin').fill(target.origin);
    await page.getByLabel('Viewport sizes').fill('800x600');
    await page.getByLabel('Schedule (UTC cron)').fill('0 9 * * *');
    await page.getByLabel('I authorize screenshot capture', { exact: false }).check();
    await page.getByRole('button', { name: 'Save project' }).click();
    await page.getByRole('heading', { name: 'Reference frontend', exact: true }).waitFor();
    await capture(
      '02-project-overview',
      'Outside-root folder refused; reference project saved with visual and schedule settings',
    );
    await page.getByRole('button', { name: 'Discover intents', exact: true }).click();
    await expect
      .poll(() => page.locator('.run-detail').textContent(), { timeout: 30_000 })
      .toContain('source surfaces');
    await page.getByRole('button', { name: 'Intent inventory', exact: true }).click();
    await expect.poll(() => page.locator('#content').textContent()).toContain('POST /login');
    await capture(
      '03-intent-inventory',
      'Real source scanner reported login surface and source evidence',
    );
    await page.getByRole('button', { name: 'Overview', exact: false }).click();
    await page.getByRole('button', { name: 'Visual test', exact: true }).click();
    await page.getByRole('button', { name: 'Approve as baseline' }).waitFor({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Approve as baseline' }).click();
    await expect.poll(() => page.locator('.capture').textContent()).toContain('approved baseline');
    await page.getByRole('button', { name: 'Run again', exact: true }).click();
    await expect
      .poll(() => page.locator('.capture').textContent(), { timeout: 30_000 })
      .toContain('unchanged');
    await page.locator('.run-detail').scrollIntoViewIfNeeded();
    await capture(
      '04-visual-comparison',
      'Approved baseline compared against fresh real Chromium capture with zero changed pixels',
    );
    await page.getByRole('button', { name: 'Schedules', exact: true }).click();
    await expect.poll(() => page.locator('#content').textContent()).toContain('0 9 * * *');
    await page.getByRole('button', { name: 'Configure', exact: true }).click();
    await page.getByLabel('Pause scheduled runs').uncheck();
    await page.getByRole('button', { name: 'Save project' }).click();
    await expect.poll(() => page.locator('#content').textContent()).toContain('active');
    await capture('05-schedule', 'Administrator enabled the persisted UTC cron schedule');
    await page.getByRole('button', { name: 'Administration', exact: true }).click();
    await expect.poll(() => page.locator('#content').textContent()).toContain('baseline.approved');
    await capture(
      '06-administration',
      'Administration exposes root allow-list and immutable baseline approval audit event',
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Overview', exact: false }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await capture('07-mobile-overview', 'Mobile dashboard fits its viewport');
    await page.setViewportSize({ width: 1440, height: 1000 });
    let releaseResponse!: () => void;
    let responseReady!: () => void;
    const held = new Promise<void>((done) => {
      responseReady = done;
    });
    const released = new Promise<void>((done) => {
      releaseResponse = done;
    });
    await page.route('**/api/state', async (route) => {
      const response = await route.fetch();
      responseReady();
      await released;
      await route.fulfill({ response });
    });
    await page.getByRole('button', { name: 'Overview', exact: false }).click();
    await held;
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await page.getByRole('heading', { name: 'A clearer view of your frontend.' }).waitFor();
    const staleResponse = page.waitForResponse('**/api/state');
    releaseResponse();
    await staleResponse;
    await page.waitForTimeout(300);
    expect(await page.locator('#app').isHidden()).toBe(true);
    await capture(
      '08-signed-out',
      'Late pre-logout dashboard response cannot restore a signed-out workspace',
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
            method:
              'allow-listed human-readable actions and assertion results; no DOM or network payload capture',
            rawTraceRetained: false,
            sourceCommit,
          },
          null,
          2,
        ),
      );
    }
  } finally {
    await browser.close();
    await app.close();
    await stopApp(target.child);
    await rm(state, { recursive: true, force: true });
    await rm(repo.root, { recursive: true, force: true });
    await rm(target.runtimeDirectory, { recursive: true, force: true });
  }
}, 120_000);
