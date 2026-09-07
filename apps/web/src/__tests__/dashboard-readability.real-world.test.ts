import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';
import type { Locator } from 'playwright';
import { startWorkbench } from './workbench-runtime';
import { launchDashboardBrowser, resizeDashboard } from './dashboard-browser';
import { dashboardProof, type DashboardNumericCheck } from './dashboard-proof';
import { applyTextProfile, measureControlText } from './dashboard-readability';
import {
  bootFixtureApp,
  stopApp,
  vulnerableAuthApp,
} from '../../../../packages/real-world-testkit/src';
import { makeRepository } from '../../../../packages/source-ua-adapter/src/__tests__/test-repo';

it('detects clipped real dashboard button text under a user spacing override', async () => {
  const state = await mkdtemp(join(tmpdir(), 'arxic-readability-'));
  const app = await startWorkbench({
    roots: [resolve(import.meta.dirname, '../../../..')],
    stateDirectory: state,
    adminToken: 'readability-test-administrator-token',
    port: 0,
  });
  const browser = await launchDashboardBrowser();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const proof = dashboardProof(
    page,
    process.env.ARXIC_READABILITY_EVIDENCE_DIR
      ? join(process.env.ARXIC_READABILITY_EVIDENCE_DIR, 'guard')
      : undefined,
  );
  try {
    await page.route(
      (url) => url.pathname === '/app.css',
      async (route) => {
        const response = await route.fetch();
        await route.fulfill({
          response,
          body:
            (await response.text()) +
            '\n#login button { height: 10px !important; min-height: 0 !important; padding: 0 !important; overflow: hidden !important; }',
        });
      },
    );
    await page.goto(app.origin);
    const button = page.getByRole('button', { name: 'Open workbench' });
    await button.waitFor();
    await expect(applyTextProfile(page, 'unknown')).rejects.toThrow('Unsupported text profile');
    await applyTextProfile(page, 'spacing');
    const spacing = await button.evaluate((element) => ({
      fontSize: parseFloat(getComputedStyle(element).fontSize),
      letterSpacing: parseFloat(getComputedStyle(element).letterSpacing),
    }));
    expect(spacing.letterSpacing).toBeCloseTo(spacing.fontSize * 0.12, 4);
    const measurement = await measureControlText(button);
    expect(measurement.box.height).toBe(10);
    expect(measurement.lines.length).toBeGreaterThan(0);
    expect(measurement.fits).toBe(false);
    const audit = await proof.audit(
      'clipped-button-guard',
      'Deliberately clipped login label must fail its independent text containment check',
      [
        {
          id: 'login-label-containment',
          passed: measurement.fits,
          values: {
            controlHeight: measurement.box.height,
            lineHeight: measurement.lines[0]!.height,
          },
        },
      ],
    );
    expect(audit.verdict).toBe('failed');
  } finally {
    await proof.finish();
    await browser.close();
    await app.close();
    await rm(state, { recursive: true, force: true });
  }
}, 60_000);

it.each(
  ['spacing', 'text-200'].flatMap((profile) =>
    ['light', 'dark'].map((theme) => ({ profile, theme: theme as 'light' | 'dark' })),
  ),
)(
  'keeps dashboard actions readable with $profile in $theme',
  async ({ profile, theme }) => {
    const state = await mkdtemp(join(tmpdir(), 'arxic-readability-journey-'));
    const root = resolve(import.meta.dirname, '../../../..');
    const repo = await makeRepository('vulnerable-auth-app');
    const target = await bootFixtureApp(root, vulnerableAuthApp, 'readability-target');
    const app = await startWorkbench({
      roots: [repo.root],
      stateDirectory: state,
      adminToken: 'readability-test-administrator-token',
      port: 0,
    });
    const browser = await launchDashboardBrowser();
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      reducedMotion: 'reduce',
      colorScheme: theme,
    });
    const page = await context.newPage();
    const proof = dashboardProof(
      page,
      process.env.ARXIC_READABILITY_EVIDENCE_DIR
        ? join(process.env.ARXIC_READABILITY_EVIDENCE_DIR, profile, theme)
        : undefined,
    );
    let originalSize = 0;
    const inspect = async (name: string, preserveProfile = false) => {
      if (!preserveProfile) {
        await applyTextProfile(page, 'default');
        originalSize = await page
          .locator('body')
          .evaluate((element) => parseFloat(getComputedStyle(element).fontSize));
        await applyTextProfile(page, profile);
      }
      const actual = await page.locator('body').evaluate((element) => ({
        size: parseFloat(getComputedStyle(element).fontSize),
        spacing: parseFloat(getComputedStyle(element).letterSpacing),
      }));
      if (profile === 'text-200') expect(actual.size).toBe(originalSize * 2);
      else expect(actual.spacing).toBeCloseTo(originalSize * 0.12, 5);
      let firstFailed: Locator | undefined;
      const checks: DashboardNumericCheck[] = [
        {
          id: 'user-text-profile-applied',
          passed: true,
          values: {
            originalSize,
            actualSize: actual.size,
            ...(profile === 'spacing' ? { letterSpacing: actual.spacing } : {}),
          },
        },
      ];
      for (const [index, button] of (
        await page
          .locator(
            'button, label, h1, h2, h3, h4, summary, .sidebar-head .brand, .sidebar-bottom .instance',
          )
          .all()
      ).entries()) {
        if (!(await button.isVisible())) continue;
        const measured = await measureControlText(button, '.provider-row-copy strong');
        if (!measured.lines.length) continue;
        if (!measured.fits && !firstFailed) firstFailed = button;
        checks.push({
          id: `text-${index}-containment`,
          passed: measured.fits,
          values: {
            x: measured.box.x,
            y: measured.box.y,
            width: measured.box.width,
            height: measured.box.height,
            spillLeft: Math.max(0, ...measured.lines.map((line) => measured.box.x - line.x)),
            spillRight: Math.max(
              0,
              ...measured.lines.map((line) => line.right - measured.box.right),
            ),
            spillTop: Math.max(0, ...measured.lines.map((line) => measured.box.y - line.y)),
            spillBottom: Math.max(
              0,
              ...measured.lines.map((line) => line.bottom - measured.box.bottom),
            ),
          },
        });
      }
      if (name === '04-desktop-overview') {
        const navigation = await measureControlText(
          page.getByRole('button', { name: 'Administration', exact: true }),
        );
        const lineCount = new Set(navigation.lines.map((line) => line.y)).size;
        checks.push({
          id: 'desktop-navigation-whole-word',
          passed: lineCount === 1,
          values: { lineCount },
        });
      }
      const audit = await proof.audit(
        name,
        `${profile}: control text containment; provider names checked by activation`,
        checks,
      );
      if (firstFailed) {
        await firstFailed.scrollIntoViewIfNeeded();
        const detail = await measureControlText(firstFailed, '.provider-row-copy strong');
        await proof.audit(
          `${name}-text-detail`,
          'Scroll the failing text control into view for pixel corroboration',
          [
            {
              id: 'focused-text-containment',
              passed: detail.fits,
              values: {
                x: detail.box.x,
                y: detail.box.y,
                width: detail.box.width,
                height: detail.box.height,
                spillTop: Math.max(0, ...detail.lines.map((line) => detail.box.y - line.y)),
                spillBottom: Math.max(
                  0,
                  ...detail.lines.map((line) => line.bottom - detail.box.bottom),
                ),
              },
            },
          ],
        );
      }
      expect(audit.overflow, name).toBe(0);
      expect(
        checks.filter((check) => !check.passed),
        name,
      ).toEqual([]);
      expect(audit.details, name).toEqual([]);
    };
    try {
      await page.goto(app.origin);
      await page.getByRole('button', { name: 'Open workbench' }).waitFor();
      await inspect('01-login');
      await page.getByLabel('Administrator token').fill('readability-test-administrator-token');
      await page.getByRole('button', { name: 'Open workbench' }).click();
      await page.getByRole('heading', { name: 'Workspace overview' }).waitFor();
      await inspect('02-overview');
      await page.locator('#new-project').click();
      await page.getByRole('dialog').waitFor();
      await inspect('03-source-wizard');
      await page.keyboard.press('Escape');
      await resizeDashboard(page, { width: 1440, height: 1000 });
      await inspect('04-desktop-overview');
      await page.getByRole('button', { name: 'Models & accounts', exact: true }).click();
      await page.getByRole('heading', { name: 'Models & accounts', exact: true }).waitFor();
      await inspect('05-desktop-providers');
      for (const row of await page.locator('.provider-row').all()) {
        const name = (await row.locator('strong').textContent())!;
        await row.click();
        await page
          .locator('.provider-detail-heading')
          .getByRole('heading', { name, exact: true })
          .waitFor();
      }
      await inspect('06-provider-name-recovery');
      await page.locator('#new-project').click();
      await page.getByLabel('Project folder', { exact: true }).fill(repo.root);
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      await page.getByLabel('Project name', { exact: true }).waitFor();
      await inspect('07-project-settings');
      await page.getByLabel('Project name', { exact: true }).fill('Readable reference frontend');
      await page.getByLabel('Running test app origin').fill(target.origin);
      await page.getByLabel('Viewport sizes').fill('800x600');
      await page.getByLabel('I authorize screenshot capture', { exact: false }).check();
      await page.getByRole('button', { name: 'Save project' }).click();
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      await page.getByRole('button', { name: 'Overview', exact: false }).click();
      await page
        .getByRole('heading', { name: 'Readable reference frontend', exact: true })
        .waitFor();
      await inspect('08-connected-project');
      await page.getByRole('button', { name: 'Discover intents', exact: true }).click();
      await expect
        .poll(() => page.locator('.run-detail').textContent(), { timeout: 30_000 })
        .toContain('source surfaces');
      await page.getByRole('button', { name: 'Intent inventory', exact: true }).click();
      await expect.poll(() => page.locator('#content').textContent()).toContain('POST /login');
      await inspect('09-populated-inventory');
      await page.getByRole('button', { name: 'Overview', exact: false }).click();
      await page.getByRole('button', { name: 'Visual test', exact: true }).click();
      await page.getByRole('button', { name: 'Approve as baseline' }).waitFor({ timeout: 30_000 });
      await page.getByText('Measured checks and coverage', { exact: true }).click();
      await page.getByRole('button', { name: 'Inspect captured elements', exact: true }).waitFor();
      await inspect('10-populated-measurements');
      await page.getByRole('button', { name: 'Locate measured text' }).first().click();
      await inspect('11-selected-measurement');
      await resizeDashboard(page, { width: 320, height: 1000 });
      await inspect('12-mobile-measurements');
      await page.locator('.mobile-nav-toggle').click();
      await inspect('13-mobile-navigation');
      await page.getByRole('button', { name: 'Administration', exact: true }).click();
      await inspect('14-mobile-administration');
      await page.locator('.mobile-nav-toggle').click();
      await page.getByRole('button', { name: 'Models & accounts', exact: true }).click();
      await inspect('15-mobile-providers');
      if (profile === 'text-200') {
        const models = page.getByRole('region', { name: 'Provider model catalog' });
        expect(
          await models.evaluate((element) => element.scrollHeight > element.clientHeight),
        ).toBe(true);
        await models.focus();
        await page.keyboard.press('End');
        await expect.poll(() => models.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
        await inspect('15b-keyboard-model-scroll', true);
        expect(await models.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
        await page.keyboard.press('Home');
        await expect.poll(() => models.evaluate((element) => element.scrollTop)).toBe(0);
      }
      for (const row of await page.locator('.provider-row').all()) {
        const name = (await row.locator('strong').textContent())!;
        await row.click();
        const heading = page
          .locator('.provider-detail-heading')
          .getByRole('heading', { name, exact: true });
        await heading.waitFor();
        await applyTextProfile(page, profile);
        const measurement = await measureControlText(heading);
        expect(measurement.fits, 'Activated provider exposes its complete name').toBe(true);
      }
      await inspect('16-mobile-provider-name-recovery');
    } finally {
      await proof.finish();
      await browser.close();
      await app.close();
      await rm(state, { recursive: true, force: true });
      await stopApp(target.child);
      await rm(repo.root, { recursive: true, force: true });
      await rm(target.runtimeDirectory, { recursive: true, force: true });
    }
  },
  180_000,
);
