import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { expect, it, vi } from 'vitest';
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
  vi.stubEnv(
    'ARXIC_MODEL_CONNECTIONS',
    JSON.stringify([
      {
        id: 'local-agent',
        label: 'Local coding agent',
        transport: 'host-cli',
        command: 'operator-agent',
        modelArgs: ['--model', '{model}'],
        models: [{ id: 'provider/code-model' }],
      },
    ]),
  );
  const app = await startWorkbench({
    roots: [repo.root],
    stateDirectory: state,
    adminToken: 'test-administrator-token-32-characters',
    port: 0,
  });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    timezoneId: 'Asia/Manila',
  });
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
  let releaseInitial!: () => void;
  let initialReady!: () => void;
  const initialHeld = new Promise<void>((done) => {
    initialReady = done;
  });
  const initialReleased = new Promise<void>((done) => {
    releaseInitial = done;
  });
  await page.route(
    '**/api/state',
    async (route) => {
      const response = await route.fetch();
      initialReady();
      await initialReleased;
      await route.fulfill({ response });
    },
    { times: 1 },
  );
  try {
    await page.goto(app.origin);
    await initialHeld;
    await page.getByLabel('Administrator token').fill('incorrect-but-long-enough-token-for-test');
    await page.getByRole('button', { name: 'Open workbench' }).click();
    await expect
      .poll(() => page.getByRole('alert').first().textContent())
      .toBe('Invalid administrator token');
    await page.getByLabel('Administrator token').fill('test-administrator-token-32-characters');
    await page.getByRole('button', { name: 'Open workbench' }).click();
    await page.getByRole('heading', { name: 'Workspace overview' }).waitFor();
    expect(await page.getByLabel('Administrator token').inputValue()).toBe('');
    const initialResponse = page.waitForResponse(
      (response) => response.url().endsWith('/api/state') && response.status() === 401,
    );
    releaseInitial();
    await initialResponse;
    await page.waitForTimeout(300);
    expect(await page.locator('#app').isHidden()).toBe(false);
    await capture(
      '01-empty-workspace',
      'Invalid login refused; late anonymous response cannot hide authenticated workspace',
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
    await page.getByRole('heading', { name: 'Frontend declarations' }).waitFor({ timeout: 5000 });
    await page.getByLabel('Declaration kind').selectOption('requirement');
    await expect
      .poll(() => page.locator('[data-frontend-rows]').textContent())
      .toContain('README.md');
    await page.getByText('Coverage gaps', { exact: true }).click();
    await expect
      .poll(() => page.locator('#content').textContent())
      .toContain('unsupported-framework');
    await capture(
      '03-intent-inventory',
      'Real source scanner reported login surface and source evidence',
    );
    await page.locator('.frontend-inventory').scrollIntoViewIfNeeded();
    await capture(
      '09-frontend-declarations',
      'Real documentation declarations have source hashes; unsupported EJS stays in coverage gaps',
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
    await page.getByLabel('Configure AI execution in this dashboard').check();
    await page.getByLabel('Model provider', { exact: true }).selectOption('local-agent');
    expect(
      await page
        .locator('#execution-model-controls datalist option')
        .evaluateAll((options) => options.map((option) => option.getAttribute('value'))),
    ).toEqual([]);
    // Operator pricing entries are not an authoritative provider model catalog.
    await page.getByLabel('Model name', { exact: true }).fill('custom/provider-model:local');
    await page.waitForTimeout(5500);
    expect(await page.getByLabel('Model name', { exact: true }).inputValue()).toBe(
      'custom/provider-model:local',
    );
    await page.getByLabel('Frameworks', { exact: false }).fill('express');
    await page.getByLabel('Domain declarations', { exact: false }).fill('authentication');
    await page.getByLabel('Persona strategy', { exact: false }).selectOption('seed-api');
    await page
      .getByLabel('Email secret reference', { exact: true })
      .fill('raw-persona@example.test');
    await page
      .getByLabel('Password secret reference', { exact: true })
      .fill('ARXIC_SECRET_TEST_PASSWORD');
    await page.getByRole('button', { name: 'Save project' }).click();
    await expect
      .poll(() => page.locator('#project-error').textContent())
      .toContain('Secret references');
    await page
      .getByLabel('Email secret reference', { exact: true })
      .fill('ARXIC_SECRET_TEST_EMAIL');
    await page.getByLabel('Maximum run minutes', { exact: true }).fill('5');
    await page.locator('#execution-fields').scrollIntoViewIfNeeded();
    await capture(
      '11-guided-settings',
      'Raw credential rejected; guided settings accept only server secret names',
    );
    await page.getByLabel('Pause scheduled runs').uncheck();
    await page.getByRole('button', { name: 'Save project' }).click();
    await expect.poll(() => page.locator('#content').textContent()).toContain('active');
    await page.getByRole('button', { name: 'Configure', exact: true }).click();
    expect(await page.getByLabel('Model provider', { exact: true }).inputValue()).toBe(
      'local-agent',
    );
    expect(await page.getByLabel('Model name', { exact: true }).inputValue()).toBe(
      'custom/provider-model:local',
    );
    expect(await page.getByLabel('Email secret reference', { exact: true }).inputValue()).toBe(
      'ARXIC_SECRET_TEST_EMAIL',
    );
    expect(await page.getByLabel('Maximum run minutes', { exact: true }).inputValue()).toBe('5');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByLabel('Model name', { exact: true }).scrollIntoViewIfNeeded();
    expect(
      await page.locator('#project-dialog').evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await capture(
      '12-mobile-guided-settings',
      'Guided settings persist after save and fit the mobile dialog',
    );
    await page.locator('#close-dialog').click();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await expect.poll(() => page.locator('#content').textContent()).toContain('09:00:00 UTC');
    await capture('05-schedule', 'Administrator enabled the persisted UTC cron schedule');
    await page.getByRole('button', { name: 'Administration', exact: true }).click();
    await expect.poll(() => page.locator('#content').textContent()).toContain('baseline.approved');
    await capture(
      '06-administration',
      'Administration exposes root allow-list and immutable baseline approval audit event',
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Overview', exact: false }).click();
    await page.getByRole('heading', { name: 'Workspace overview' }).waitFor();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await capture('07-mobile-overview', 'Mobile dashboard fits its viewport');
    await page.getByRole('button', { name: 'Intent inventory', exact: true }).click();
    await page.getByRole('heading', { name: 'Frontend declarations' }).waitFor();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.getByLabel('Search declarations').fill('README');
    await page.waitForTimeout(3000);
    expect(await page.getByLabel('Search declarations').inputValue()).toBe('README');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect
      .poll(() => page.locator('[data-frontend-rows]').textContent())
      .toContain('README.md');
    await page.locator('.frontend-inventory').scrollIntoViewIfNeeded();
    await capture(
      '10-mobile-declarations',
      'Mobile search survives status polling and filters real source declarations',
    );
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
    vi.unstubAllEnvs();
    await browser.close();
    await app.close();
    await stopApp(target.child);
    await rm(state, { recursive: true, force: true });
    await rm(repo.root, { recursive: true, force: true });
    await rm(target.runtimeDirectory, { recursive: true, force: true });
  }
}, 120_000);
