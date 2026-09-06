import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { expect, it } from 'vitest';
import {
  bootFixtureApp,
  stopApp,
  vulnerableAuthApp,
} from '../../../../packages/real-world-testkit/src';
import { startWorkbench } from './workbench-runtime';
import { dashboardProof } from './dashboard-proof';

it.each(['light', 'dark'] as const)(
  'configures and inspects a real environment matrix from the dashboard (%s)',
  async (theme) => {
    const root = resolve(import.meta.dirname, '../../../..');
    const state = await mkdtemp(join(tmpdir(), 'matrix-ui-'));
    const target = await bootFixtureApp(root, vulnerableAuthApp, 'matrix-ui');
    const app = await startWorkbench({
      roots: [root],
      stateDirectory: state,
      adminToken: 'matrix-ui-test-administrator-token',
      port: 0,
    });
    const browser = await chromium.launch();
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      colorScheme: theme,
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    const proof = dashboardProof(
      page,
      process.env.ARXIC_MATRIX_EVIDENCE_DIR
        ? join(process.env.ARXIC_MATRIX_EVIDENCE_DIR, theme)
        : undefined,
    );
    const audit = async (name: string, action: string) => {
      const result = await proof.audit(name, action);
      expect(result.details).toEqual([]);
      expect(result.overflow).toBe(0);
    };
    try {
      await page.goto(app.origin);
      await page.getByLabel('Administrator token').fill('matrix-ui-test-administrator-token');
      await page.getByRole('button', { name: 'Open workbench' }).click();
      await page.locator('#new-project').click();
      await page
        .getByLabel('Project folder', { exact: true })
        .fill(join(root, 'test-fixtures/vulnerable-auth-app'));
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      await page.getByLabel('Project name', { exact: true }).fill('Environment matrix');
      await page.getByLabel('Running test app origin').fill(target.origin);
      await page.getByLabel('Viewport sizes').fill('800x600');
      await page.getByLabel('Chromium', { exact: true }).uncheck();
      await page.getByRole('button', { name: 'Save project' }).click();
      await expect
        .poll(() => page.locator('#project-error').textContent())
        .toContain('Choose at least one browser and one color scheme');
      for (const label of ['Chromium', 'Firefox', 'WebKit', 'Dark'])
        await page.getByLabel(label, { exact: true }).check();
      for (const label of ['Chromium', 'Firefox', 'WebKit', 'Light', 'Dark']) {
        const target = await page.getByLabel(label, { exact: true }).locator('..').boundingBox();
        expect(target?.height).toBeGreaterThanOrEqual(44);
      }
      await expect.poll(() => page.locator('#project-error').textContent()).toBe('');
      const chromiumLabel = page.getByLabel('Chromium', { exact: true }).locator('..');
      const hitBox = (await chromiumLabel.boundingBox())!;
      await chromiumLabel.click({ position: { x: hitBox.width - 3, y: hitBox.height - 3 } });
      expect(await page.getByLabel('Chromium', { exact: true }).isChecked()).toBe(false);
      await page.getByLabel('Chromium', { exact: true }).check();

      await page.getByLabel('Firefox', { exact: true }).focus();
      await page.keyboard.press('Space');
      expect(await page.getByLabel('Firefox', { exact: true }).isChecked()).toBe(false);
      await page.keyboard.press('Space');
      for (const width of [320, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.getByLabel('Chromium', { exact: true }).scrollIntoViewIfNeeded();
        await audit(
          `01-matrix-settings-${width}`,
          'Browser/theme selection retains labels, keyboard focus and responsive layout',
        );
      }
      await page.getByLabel('I authorize screenshot capture', { exact: false }).check();
      await page.getByRole('button', { name: 'Save project' }).click();
      await page.getByRole('heading', { name: 'Environment matrix', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Visual test', exact: true }).click();
      await expect
        .poll(() => page.locator('.run-detail').textContent(), { timeout: 90000 })
        .toContain('6 viewport checkpoints captured across 6 browser/theme environments');
      expect(await page.locator('.capture').count()).toBe(6);
      for (const name of ['chromium', 'firefox', 'webkit'])
        for (const scheme of ['light', 'dark'])
          expect(
            await page
              .locator('.capture')
              .filter({ hasText: `${name} · ${scheme}` })
              .count(),
          ).toBe(1);
      await page
        .getByRole('heading', { name: 'Visual environments', exact: true })
        .scrollIntoViewIfNeeded();
      await audit(
        '02-matrix-results',
        'Six actual browser/theme captures report independent environments and outcomes',
      );
      await page.setViewportSize({ width: 390, height: 1000 });
      await page
        .getByRole('region', { name: 'Visual environments', exact: true })
        .scrollIntoViewIfNeeded();
      await audit(
        '03-mobile-results',
        'Environment outcomes remain readable on a narrow dashboard',
      );
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.getByRole('button', { name: 'Schedules', exact: true }).click();
      await page.getByRole('button', { name: 'Configure', exact: true }).click();
      for (const label of ['Chromium', 'Firefox', 'WebKit', 'Light', 'Dark'])
        expect(await page.getByLabel(label, { exact: true }).isChecked()).toBe(true);
      await page.getByLabel('Chromium', { exact: true }).scrollIntoViewIfNeeded();
      await audit(
        '04-restored-settings',
        'Saved browser/theme selections survive reopening project settings',
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
