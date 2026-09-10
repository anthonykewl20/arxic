import { inspectCapturedElements } from './element-inspector-proof';
import { openInventoryTab } from './inventory-tabs';
import { inspectLegacyElementKinds } from './element-kind-legacy-proof';
import sharp from 'sharp';
import { captureMaskedViewport } from '@arxic/playwright-screenshot-privacy';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { launchDashboardBrowser, resizeDashboard } from './dashboard-browser';
import { expect, it, vi } from 'vitest';
import {
  bootFixtureApp,
  stopApp,
  vulnerableAuthApp,
} from '../../../../packages/real-world-testkit/src';
import { makeRepository } from '../../../../packages/source-ua-adapter/src/__tests__/test-repo';
import { startWorkbench } from './workbench-runtime';
import { dashboardProof } from './dashboard-proof';
import { trackDashboardErrors } from './dashboard-errors';

it.each(['light', 'dark'] as const)(
  'lets a real browser register a folder, discover source intent, run visual checks, approve a baseline, and manage schedules (%s)',
  async (theme) => {
    const root = resolve(import.meta.dirname, '../../../..');
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
    const browser = await launchDashboardBrowser({ headless: true });
    const context = await browser.newContext({
      reducedMotion: 'reduce',
      colorScheme: theme,
      viewport: { width: 1440, height: 1000 },
      timezoneId: 'Asia/Manila',
    });
    const page = await context.newPage();
    // Bound each browser wait so a stalled step yields a source location before the case deadline.
    page.setDefaultTimeout(10_000);
    const failureEvidence = process.env.ARXIC_WEB_EVIDENCE_DIR
      ? join(process.env.ARXIC_WEB_EVIDENCE_DIR, theme)
      : undefined;
    const auditProof = dashboardProof(
      page,
      process.env.ARXIC_WEB_EVIDENCE_DIR
        ? join(process.env.ARXIC_WEB_EVIDENCE_DIR, theme)
        : undefined,
    );
    const historyProof = dashboardProof(
      page,
      process.env.ARXIC_HISTORY_EVIDENCE_DIR
        ? join(process.env.ARXIC_HISTORY_EVIDENCE_DIR, theme)
        : undefined,
    );
    // #447: corroborated classification; active failures and native errors stay hard.
    const errors = trackDashboardErrors(page);
    const capture = async (name: string, action: string) => {
      const proof =
        process.env.ARXIC_HISTORY_EVIDENCE_DIR &&
        ['13-run-history-unavailable', '04-visual-comparison'].includes(name)
          ? historyProof
          : auditProof;
      const audit = await proof.audit(name, action);
      expect(audit.details).toEqual([]);
      expect(audit.overflow).toBe(0);
    };
    let releaseFolders = () => {};
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
      await page.getByRole('heading', { name: 'Pages', exact: true }).waitFor();
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
      let foldersReady!: () => void;
      const foldersHeld = new Promise<void>((resolve) => {
        foldersReady = resolve;
      });
      const foldersReleased = new Promise<void>((resolve) => {
        releaseFolders = resolve;
      });
      await page.route(
        '**/api/workspace/folders?**',
        async (route) => {
          const response = await route.fetch();
          foldersReady();
          await foldersReleased;
          await route.fulfill({ response });
        },
        { times: 1 },
      );
      await page.locator('#new-project').click();
      await foldersHeld;
      await page.getByLabel('Project folder', { exact: true }).fill(tmpdir());
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      await expect.poll(() => page.locator('#project-error').textContent()).toContain('outside');
      await page.getByLabel('Project folder', { exact: true }).fill(repo.root);
      const continueBefore = (await page
        .getByRole('button', { name: 'Continue', exact: true })
        .boundingBox())!;
      await capture(
        '16-source-loading',
        'Folder discovery shows a stable loading area before its real response',
      );
      releaseFolders();
      await page.getByText('Loading folders…', { exact: true }).waitFor({ state: 'hidden' });
      const continueAfter = (await page
        .getByRole('button', { name: 'Continue', exact: true })
        .boundingBox())!;
      expect(
        continueAfter.y,
        'Folder results must not move Continue while the user is editing',
      ).toBe(continueBefore.y);
      await capture(
        '17-source-ready',
        'Folder results preserve the exact Continue position while editing',
      );
      if (process.env.ARXIC_WEB_EVIDENCE_DIR)
        await writeFile(
          join(process.env.ARXIC_WEB_EVIDENCE_DIR, theme, 'source-layout.json'),
          JSON.stringify({ before: continueBefore, after: continueAfter }, null, 2),
        );
      const detectedFolder = page.waitForResponse(
        (response) => new URL(response.url()).pathname === '/api/workspace/detect',
      );
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      expect((await detectedFolder).status()).toBe(200);
      await page.getByLabel('Project name', { exact: true }).fill('Reference frontend');
      await page.getByLabel('Running test app origin').fill(target.origin);
      await page.getByLabel('Viewport sizes').fill('800x600');
      await page.locator('#project-form summary', { hasText: 'Advanced' }).click();
      await page.getByLabel('Schedule (UTC cron)').fill('0 9 * * *');
      await page.getByLabel('I authorize screenshot capture', { exact: false }).check();
      await page.getByRole('button', { name: 'Save project' }).click();
      await page.getByRole('heading', { name: 'Reference frontend', exact: true }).waitFor();
      await capture(
        '02-project-overview',
        'Outside-root folder refused; reference project saved with visual and schedule settings',
      );
      await page.getByRole('button', { name: 'Read the code', exact: true }).click();
      await expect
        .poll(() => page.locator('.run-detail').textContent(), { timeout: 30_000 })
        .toContain('source surfaces');
      await page.getByRole('button', { name: 'Code scan', exact: true }).click();
      await openInventoryTab(page, 'declarations');
      await expect.poll(() => page.locator('#content').textContent()).toContain('POST /login');
      await page.getByRole('heading', { name: 'Frontend declarations' }).waitFor({ timeout: 5000 });
      await page.getByLabel('Declaration kind').selectOption('requirement');
      await expect
        .poll(() => page.locator('[data-frontend-rows]').textContent())
        .toContain('README.md');
      await page.getByText('Coverage gaps', { exact: true }).click();
      await expect
        .poll(() => page.locator('#content').textContent())
        .toContain('template-expressions-not-evaluated');
      await capture(
        '03-intent-inventory',
        'Real source scanner reported login surface and source evidence',
      );
      await page.locator('.frontend-inventory').scrollIntoViewIfNeeded();
      await capture(
        '09-frontend-declarations',
        'Real documentation declarations have source hashes; unsupported EJS stays in coverage gaps',
      );
      await page.getByRole('button', { name: 'Projects', exact: true }).click();
      await page.getByRole('button', { name: 'Screenshot test', exact: true }).click();
      await page.getByRole('button', { name: 'Approve as baseline' }).waitFor({ timeout: 30_000 });
      await page.route('**/*.assessment.json', (route) =>
        route.fulfill({ status: 503, body: 'Unavailable' }),
      );
      await page.getByText('Measured checks and coverage', { exact: true }).click();
      await page.getByRole('button', { name: 'Retry measurements' }).waitFor();
      await page.unroute('**/*.assessment.json');
      await page.route('**/*.assessment.json', async (route) => {
        const response = await route.fetch();
        const report = await response.json();
        report.scene.nodes.push(report.scene.nodes[0]);
        await route.fulfill({ response, json: report });
      });
      await page.getByRole('button', { name: 'Retry measurements' }).click();
      await page
        .getByText(
          'Element geometry is unavailable, unstable, or outside the supported bounds. Run a fresh visual capture to inspect elements.',
          { exact: true },
        )
        .waitFor();
      expect(
        await page.getByRole('button', { name: 'Inspect captured elements', exact: true }).count(),
      ).toBe(0);
      await capture(
        '14-invalid-element-geometry',
        'Duplicate captured element IDs disable inspection',
      );
      await page.unroute('**/*.assessment.json');
      await page.route('**/*.assessment.json', async (route) => {
        const response = await route.fetch();
        const report = await response.json();
        report.assessment.screenshotSha256 = '0'.repeat(64);
        await route.fulfill({ response, json: report });
      });
      await page.getByRole('button', { name: 'Retry element measurements' }).click();
      await expect
        .poll(() => page.getByRole('button', { name: 'Retry element measurements' }).isEnabled())
        .toBe(true);
      expect(
        await page.getByRole('button', { name: 'Inspect captured elements', exact: true }).count(),
      ).toBe(0);
      await capture(
        '15-unbound-element-geometry',
        'Mismatched screenshot binding disables inspection',
      );
      await page.unroute('**/*.assessment.json');
      await inspectLegacyElementKinds(page, theme);
      await page.getByText('document-horizontal-overflow', { exact: true }).waitFor();
      await inspectCapturedElements(page, target.origin, theme);
      await page.route('**/artifacts/checkpoint-1.png?measurement=*', (route) =>
        route.fulfill({ status: 503, body: 'Unavailable' }),
      );
      await page.getByRole('button', { name: 'Locate measured text' }).first().click();
      await page.getByText('Captured image could not be loaded.', { exact: true }).waitFor();
      await page.unroute('**/artifacts/checkpoint-1.png?measurement=*');
      await page.getByRole('button', { name: 'Retry capture image' }).click();
      await page.getByRole('img', { name: 'Measured text region in captured viewport' }).waitFor();
      expect(
        await page
          .getByRole('img', { name: 'Measured text region in captured viewport' })
          .getAttribute('viewBox'),
      ).toBe('0 0 800 600');
      await page.getByLabel('Find measurement').fill('absent-measurement-id');
      await page.getByText('No checks match these filters.', { exact: true }).waitFor();
      expect(await page.locator('.measurement-checks > li').count()).toBe(0);
      await page.getByLabel('Find measurement').fill('');
      await page.getByLabel('Measurement verdict').selectOption('unverified');
      expect(await page.locator('.measurement-checks > li').count()).toBeGreaterThan(0);
      await page.getByLabel('Measurement verdict').selectOption('all');
      await page.locator('.measurement-checks > li').last().scrollIntoViewIfNeeded();
      await page.getByRole('button', { name: 'Locate measured text' }).first().click();
      await expect
        .poll(async () => {
          const box = await page
            .getByRole('img', { name: 'Measured text region in captured viewport' })
            .boundingBox();
          const header = await page.locator('.topbar').boundingBox();
          return (
            !!box &&
            !!header &&
            box.y >= Math.max(0, header.y + header.height) &&
            box.y + box.height <= 1000
          );
        })
        .toBe(true);
      await capture(
        '10-measurement-report',
        'Retry loads real measurements; reselecting a check reveals the complete captured image',
      );
      const previewBounds = (await page
        .getByRole('img', { name: 'Measured text region in captured viewport' })
        .boundingBox())!;
      if (process.env.ARXIC_WEB_EVIDENCE_DIR)
        await writeFile(
          join(process.env.ARXIC_WEB_EVIDENCE_DIR, theme, 'measurement-layout.json'),
          JSON.stringify(
            {
              previewBounds,
              viewport: page.viewportSize(),
              screenshot: '10-measurement-report.png',
            },
            null,
            2,
          ),
        );
      const painted = await sharp(
        process.env.ARXIC_WEB_EVIDENCE_DIR
          ? await readFile(
              join(process.env.ARXIC_WEB_EVIDENCE_DIR, theme, '10-measurement-report.png'),
            )
          : await captureMaskedViewport(page, {
              automaticMasks: ['input[type="password"]'],
              requiredMasks: [],
            }),
      )
        .extract({
          left: Math.ceil(previewBounds.x),
          top: Math.ceil(previewBounds.y),
          width: Math.floor(previewBounds.width),
          height: Math.floor(previewBounds.height),
        })
        .removeAlpha()
        .raw()
        .toBuffer();
      let maskedInk = 0;
      for (let i = 0; i < painted.length; i += 3)
        if (painted[i] === 255 && painted[i + 1] === 0 && painted[i + 2] === 255) maskedInk++;
      expect(
        maskedInk,
        'the region preview must paint the actual masked reference-app image',
      ).toBeGreaterThan(100);
      await resizeDashboard(page, { width: 390, height: 844 });
      await page
        .getByRole('img', { name: 'Measured text region in captured viewport' })
        .scrollIntoViewIfNeeded();
      await capture(
        '14-mobile-measurement-region',
        'Measured screenshot region scales to mobile without losing the masked target image',
      );
      await resizeDashboard(page, { width: 1440, height: 1000 });
      await page.route('**/api/runs?**', (route) =>
        route.fulfill({ status: 503, json: { error: 'History unavailable' } }),
      );
      // Reproduce the CI race: a manual search's slow state response is
      // superseded by polling, whose history request then fails.
      await page.waitForResponse((response) => new URL(response.url()).pathname === '/api/state');
      await page.getByLabel('Search runs').fill('no-matching-project');
      let releaseSearch!: () => void;
      const searchReleased = new Promise<void>((done) => {
        releaseSearch = done;
      });
      let holdSearch = true;
      await page.route('**/api/state', async (route) => {
        const response = await route.fetch();
        if (holdSearch) {
          holdSearch = false;
          await searchReleased;
        } else releaseSearch();
        await route.fulfill({ response });
      });
      await page.getByRole('button', { name: 'Search runs', exact: true }).click();
      await page.getByRole('button', { name: 'Retry run history' }).waitFor();
      await capture(
        '13-run-history-unavailable',
        'Failed history request shows error instead of stale results',
      );
      // Retry while the 503 refusal is still routed: the click cannot race the
      // polling recovery after unroute, and the request deterministically fails
      // again before the routes release and the heading recovers.
      await page.getByRole('button', { name: 'Retry run history' }).click();
      await page
        .getByText('Run history could not be loaded. Retry or check your connection.', {
          exact: true,
        })
        .waitFor();
      releaseSearch();
      await page.unroute('**/api/state');
      await page.unroute('**/api/runs?**');
      await page.getByRole('heading', { name: 'No matching runs' }).waitFor();
      await page.reload();
      await page.getByRole('heading', { name: 'No matching runs' }).waitFor();
      await page.getByRole('button', { name: 'Clear run filters' }).click();
      await page.getByLabel('Run type').selectOption('visual');
      await expect.poll(() => page.locator('.run-list tbody tr').count()).toBe(1);
      await page.getByRole('button', { name: 'Approve as baseline' }).click();
      await expect
        .poll(() => page.locator('.capture').textContent())
        .toContain('approved baseline');
      await page.getByRole('button', { name: 'Run again', exact: true }).click();
      await expect
        .poll(() => page.locator('.capture').textContent(), { timeout: 30_000 })
        .toContain('Unchanged');
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
      await expect.poll(() => page.locator('#content').textContent()).toContain('Active');
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
      await resizeDashboard(page, { width: 390, height: 844 });
      await page.getByLabel('Model name', { exact: true }).scrollIntoViewIfNeeded();
      expect(
        await page.locator('#project-dialog').evaluate((el) => el.scrollWidth <= el.clientWidth),
      ).toBe(true);
      await capture(
        '12-mobile-guided-settings',
        'Guided settings persist after save and fit the mobile dialog',
      );
      await page.locator('#close-dialog').click();
      await resizeDashboard(page, { width: 1440, height: 1000 });
      await expect.poll(() => page.locator('#content').textContent()).toContain('09:00:00 UTC');
      await capture('05-schedule', 'Administrator enabled the persisted UTC cron schedule');
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await expect
        .poll(() => page.locator('#content').textContent())
        .toContain('baseline.approved');
      await capture(
        '06-administration',
        'Settings exposes root allow-list and immutable baseline approval audit event',
      );
      await resizeDashboard(page, { width: 390, height: 844 });
      await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
      await page.getByRole('button', { name: 'Projects', exact: true }).focus();
      await page.keyboard.press('Escape');
      expect(await page.getByRole('button', { name: 'Open navigation', exact: true }).count()).toBe(
        1,
      );
      expect(
        await page
          .getByRole('button', { name: 'Open navigation', exact: true })
          .evaluate((button) => document.activeElement === button),
      ).toBe(true);
      await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
      await capture(
        '13-mobile-navigation',
        'Mobile navigation exposes every workspace screen and Escape restores toggle focus',
      );
      await page.getByRole('button', { name: 'Projects', exact: true }).click();
      expect(
        await page
          .getByRole('button', { name: 'Open navigation', exact: true })
          .getAttribute('aria-expanded'),
      ).toBe('false');
      await page.getByRole('heading', { name: 'Projects', exact: true }).waitFor();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await capture('07-mobile-overview', 'Mobile dashboard fits its viewport');
      await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
      await page.getByRole('button', { name: 'Code scan', exact: true }).click();
      await openInventoryTab(page, 'declarations');
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
      await resizeDashboard(page, { width: 1440, height: 1000 });
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
      await page.getByRole('button', { name: 'Projects', exact: true }).click();
      await held;
      await page.getByRole('button', { name: 'Sign out', exact: true }).click();
      await page.getByRole('heading', { name: 'See every page. Catch every change.' }).waitFor();
      const staleResponse = page.waitForResponse('**/api/state');
      releaseResponse();
      await staleResponse;
      await page.waitForTimeout(300);
      expect(await page.locator('#app').isHidden()).toBe(true);
      await capture(
        '08-signed-out',
        'Late pre-logout dashboard response cannot restore a signed-out workspace',
      );
      expect(errors.hard()).toEqual([]);
    } catch (error) {
      if (failureEvidence) {
        try {
          await auditProof.audit(
            '99-failed-ui-step',
            'A browser journey step failed; this screenshot does not waive the failure',
            [{ id: 'browser-journey-failure', passed: false, values: { observed: 1 } }],
          );
        } catch {
          await mkdir(failureEvidence, { recursive: true });
          await writeFile(
            join(failureEvidence, '99-failure-capture.json'),
            JSON.stringify({ outcome: 'unavailable', rawTraceRetained: false }),
          );
        }
      }
      throw error;
    } finally {
      releaseFolders();
      await auditProof.finish();
      await historyProof.finish();
      vi.unstubAllEnvs();
      await browser.close();
      await app.close();
      await stopApp(target.child);
      await rm(state, { recursive: true, force: true });
      await rm(repo.root, { recursive: true, force: true });
      await rm(target.runtimeDirectory, { recursive: true, force: true });
    }
  },
  120_000,
);
