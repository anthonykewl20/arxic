import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { launchDashboardBrowser, resizeDashboard } from './dashboard-browser';
import { expect, it } from 'vitest';
import { chromium } from 'playwright';
import {
  bootFixtureApp,
  stopApp,
  vulnerableAuthApp,
} from '../../../../packages/real-world-testkit/src';
import { startWorkbench } from './workbench-runtime';
import { dashboardProof } from './dashboard-proof';

it.each(['light', 'dark'] as const)(
  'configures and inspects a real pixel density matrix from the dashboard (%s)',
  async (theme) => {
    const root = resolve(import.meta.dirname, '../../../..');
    const state = await mkdtemp(join(tmpdir(), 'density-ui-'));
    const target = await bootFixtureApp(root, vulnerableAuthApp, 'density-ui');
    const app = await startWorkbench({
      roots: [root],
      stateDirectory: state,
      adminToken: 'density-ui-test-administrator-token',
      port: 0,
    });
    const browser = await launchDashboardBrowser();
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      colorScheme: theme,
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    const proof = dashboardProof(
      page,
      process.env.ARXIC_DENSITY_UI_EVIDENCE_DIR
        ? join(process.env.ARXIC_DENSITY_UI_EVIDENCE_DIR, theme)
        : undefined,
    );
    const audit = async (name: string, action: string) => {
      const result = await proof.audit(name, action);
      expect(result.details).toEqual([]);
      expect(result.overflow).toBe(0);
    };
    try {
      await page.goto(app.origin);
      await page.getByLabel('Administrator token').fill('density-ui-test-administrator-token');
      await page.getByRole('button', { name: 'Open workbench' }).click();
      await page.locator('#new-project').click();
      await page
        .getByLabel('Project folder', { exact: true })
        .fill(join(root, 'test-fixtures/vulnerable-auth-app'));
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      await page.getByLabel('Project name', { exact: true }).fill('Pixel density matrix');
      await page.getByLabel('Running test app origin').fill(target.origin);
      await page.getByLabel('Viewport sizes').fill('800x600');
      await page.getByLabel('1× standard', { exact: true }).uncheck();
      await page.getByRole('button', { name: 'Save project' }).click();
      await expect
        .poll(() => page.locator('#project-error').textContent())
        .toContain('Choose at least one pixel density');
      for (const label of ['1× standard', '2× sharp', '3× extra sharp']) {
        await page.getByLabel(label, { exact: true }).check();
        const box = await page.getByLabel(label, { exact: true }).locator('..').boundingBox();
        expect(box?.height).toBeGreaterThanOrEqual(44);
      }
      await expect.poll(() => page.locator('#project-error').textContent()).toBe('');
      await page.getByLabel('2× sharp', { exact: true }).focus();
      await page.keyboard.press('Space');
      expect(await page.getByLabel('2× sharp', { exact: true }).isChecked()).toBe(false);
      await page.keyboard.press('Space');
      for (const width of [320, 390, 768, 1440]) {
        await resizeDashboard(page, { width, height: 1000 });
        await page.getByLabel('3× extra sharp', { exact: true }).scrollIntoViewIfNeeded();
        await audit(
          `01-matrix-settings-${width}`,
          'Pixel-density selection retains labels, keyboard focus and responsive layout',
        );
      }
      await page.getByLabel('Viewport sizes').fill('1920x1200');
      await page.getByRole('button', { name: 'Save project' }).click();
      await expect
        .poll(() => page.locator('#project-error').textContent())
        .toContain('pixel limit');
      const errorBox = (await page.locator('#project-error').boundingBox())!;
      const footerBox = (await page.locator('.dialog-footer').boundingBox())!;
      expect(errorBox.y + errorBox.height).toBeLessThanOrEqual(footerBox.y);
      expect(
        await page.locator('#project-error').evaluate((el) => el === document.activeElement),
      ).toBe(true);
      await audit(
        '01b-pixel-limit',
        'Oversized native capture is refused with a recoverable error',
      );
      await page.getByLabel('Viewport sizes').fill('800x600');
      await page.getByLabel('I authorize screenshot capture', { exact: false }).check();
      await page.getByRole('button', { name: 'Save project' }).click();
      await page.getByRole('heading', { name: 'Pixel density matrix', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Visual test', exact: true }).click();
      await expect
        .poll(() => page.locator('.run-detail').textContent(), { timeout: 90000 })
        .toContain(
          '3 viewport checkpoints captured across 3 browser/theme/pixel-density environments',
        );
      expect(await page.locator('.capture').count()).toBe(3);
      await page.getByLabel('Capture pixel density', { exact: true }).selectOption('2');
      expect(await page.locator('.capture').count()).toBe(1);
      expect(await page.locator('.capture').textContent()).toContain('2×');
      await page.getByLabel('Capture pixel density', { exact: true }).scrollIntoViewIfNeeded();
      await audit(
        '02a-density-filter',
        'Density filter isolates the 2x capture without changing run coverage',
      );
      expect(
        await page
          .getByRole('region', { name: 'Visual environments', exact: true })
          .locator('li')
          .count(),
      ).toBe(3);
      // Independent live target observation checks CSS-coordinate picking on native 2x pixels.
      const targetBrowser = await chromium.launch();
      let expectedButton;
      try {
        const targetPage = await targetBrowser.newPage({
          viewport: { width: 800, height: 600 },
          deviceScaleFactor: 2,
          colorScheme: 'light',
        });
        await targetPage.goto(target.origin);
        expectedButton = (await targetPage
          .getByRole('button', { name: 'Login', exact: true })
          .boundingBox())!;
      } finally {
        await targetBrowser.close();
      }
      await page.getByText('Measured checks and coverage', { exact: true }).click();
      await page.getByRole('button', { name: 'Inspect captured elements', exact: true }).click();
      const elements = page.getByRole('region', { name: 'Captured elements', exact: true });
      const image = elements.getByRole('img', { name: 'Pick an element in captured screenshot' });
      await image.waitFor();
      await elements.getByLabel('Element type', { exact: true }).selectOption('1');
      for (const width of [320, 1440]) {
        await resizeDashboard(page, { width, height: 1000 });
        const box = (await image.boundingBox())!;
        await image.click({
          position: {
            x: ((expectedButton.x + expectedButton.width / 2) * box.width) / 800,
            y: ((expectedButton.y + expectedButton.height / 2) * box.height) / 600,
          },
        });
        for (const key of ['x', 'y', 'width', 'height'] as const)
          expect(Number(await image.locator('rect').last().getAttribute(key))).toBe(
            expectedButton[key],
          );
        expect(await elements.getByRole('button', { name: /^Inspect element / }).count()).toBe(1);
        await elements.getByRole('button', { name: 'Show selected on screenshot' }).click();
        await audit(
          `02b-native-element-${width}`,
          'Native 2x screenshot picking selects the independently measured Login button',
        );
      }
      await page.getByRole('button', { name: 'Inspect captured elements', exact: true }).click();
      await page.getByLabel('Capture pixel density', { exact: true }).selectOption('3');
      await page.getByText('Ask AI to review this screenshot', { exact: true }).click();
      await page.getByLabel('Review model', { exact: true }).fill('local-vision-check');
      await page
        .getByLabel('Independent acceptance criterion', { exact: false })
        .fill('The Login control must remain readable.');
      await page.getByLabel('I inspected this screenshot', { exact: false }).check();
      const refusal = page.waitForResponse(
        (response) => response.url().endsWith('/reviews') && response.request().method() === 'POST',
      );
      await page.getByRole('button', { name: 'Review these pixels', exact: true }).click();
      expect((await refusal).status()).toBe(409);
      const limitMessage = page.getByText(
        'Capture exceeds AI review image limits; choose a smaller viewport or lower pixel density',
        { exact: true },
      );
      await limitMessage.waitFor();
      expect(
        await page.getByRole('button', { name: 'Review these pixels', exact: true }).isDisabled(),
      ).toBe(false);
      expect(await page.getByLabel('Review model', { exact: true }).inputValue()).toBe(
        'local-vision-check',
      );
      await limitMessage.scrollIntoViewIfNeeded();
      await audit(
        '02c-review-image-limit',
        'Oversized AI review is refused with actionable recovery and retained form input',
      );
      await page.getByRole('button', { name: 'Clear capture filters' }).click();
      expect(await page.locator('.capture').count()).toBe(3);
      await page
        .getByRole('heading', { name: 'Visual environments', exact: true })
        .scrollIntoViewIfNeeded();
      await audit(
        '02-matrix-results',
        'Three native pixel-density captures report independent environments and outcomes',
      );
      await resizeDashboard(page, { width: 390, height: 1000 });
      await page
        .getByRole('region', { name: 'Visual environments', exact: true })
        .scrollIntoViewIfNeeded();
      await audit(
        '03-mobile-results',
        'Environment outcomes remain readable on a narrow dashboard',
      );
      await resizeDashboard(page, { width: 1440, height: 1000 });
      await page.getByRole('button', { name: 'Schedules', exact: true }).click();
      await page.getByRole('button', { name: 'Configure', exact: true }).click();
      for (const label of ['Chromium', 'Light', '1× standard', '2× sharp', '3× extra sharp'])
        expect(await page.getByLabel(label, { exact: true }).isChecked()).toBe(true);
      await page.getByLabel('3× extra sharp', { exact: true }).scrollIntoViewIfNeeded();
      await audit(
        '04-restored-settings',
        'Saved pixel-density selections survive reopening project settings',
      );
    } finally {
      await proof.finish();
      await browser.close();
      await app.close();
      await stopApp(target.child);
      await rm(target.runtimeDirectory, { recursive: true, force: true });
      await rm(state, { recursive: true, force: true });
    }
  },
  150000,
);
