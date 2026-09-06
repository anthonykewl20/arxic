import { join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { expect } from 'vitest';
import { startWorkbench } from '../server';
import { dashboardProof } from './dashboard-proof';
import type { Run } from '../types';

/** Fixture setup uses the real engine; every gallery/settings action uses the real dashboard. */
export async function checkpointUiProof(stateDirectory: string, root: string, run: Run) {
  const app = await startWorkbench({
    stateDirectory,
    roots: [root],
    port: 0,
    adminToken: 'checkpoint-proof-administrator-token-32',
  });
  const browser = await chromium.launch({ headless: true });
  try {
    for (const theme of ['light', 'dark'] as const) {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
        colorScheme: theme,
        reducedMotion: 'reduce',
      });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.name));
      const proof = dashboardProof(
        page,
        process.env.ARXIC_CHECKPOINT_EVIDENCE_DIR
          ? join(process.env.ARXIC_CHECKPOINT_EVIDENCE_DIR, theme)
          : undefined,
      );
      async function audit(name: string, action: string) {
        const report = await proof.audit(name, action);
        expect(report.details).toEqual([]);
        expect(report.overflow).toBe(0);
      }
      try {
        await page.goto(app.origin);
        await page
          .getByLabel('Administrator token')
          .fill('checkpoint-proof-administrator-token-32');
        await page.getByRole('button', { name: 'Open workbench' }).click();
        await page.locator('[data-nav="runs"]').click();
        await page.locator(`[data-open-run="${run.id}"]`).click();
        const gallery = page.getByRole('region', { name: 'Workflow checkpoints' });
        await gallery.waitFor();
        await expect
          .poll(() =>
            gallery
              .locator('img')
              .evaluateAll((images) =>
                images.every(
                  (image) =>
                    (image as HTMLImageElement).complete &&
                    (image as HTMLImageElement).naturalWidth > 0,
                ),
              ),
          )
          .toBe(true);
        await gallery.scrollIntoViewIfNeeded();
        await audit(
          '01-checkpoints',
          'Open real authenticated verifier checkpoints from test runs',
        );
        const capture = run.result!.workflowCaptures![0]!;
        const imagePath = join(stateDirectory, 'runs', run.id, capture.file);
        const original = await readFile(imagePath);
        try {
          await writeFile(imagePath, 'changed-image');
          await page.reload();
          await page.locator('[data-nav="runs"]').click();
          await page.locator(`[data-open-run="${run.id}"]`).click();
          await gallery.getByRole('button', { name: 'Retry screenshot' }).waitFor();
          await gallery.scrollIntoViewIfNeeded();
          await audit(
            '02-changed-evidence',
            'Changed image bytes refused; gallery explains unavailable evidence',
          );
          await writeFile(imagePath, original);
          await gallery.getByRole('button', { name: 'Retry screenshot' }).click();
          await gallery.getByRole('link', { name: `Open full-size ${capture.id}` }).waitFor();
        } finally {
          await writeFile(imagePath, original);
        }
        await page.setViewportSize({ width: 390, height: 844 });
        await gallery.scrollIntoViewIfNeeded();
        await audit(
          '03-mobile-checkpoints',
          'Retry restores hash-checked image; mobile gallery has no horizontal overflow',
        );
        await page.setViewportSize({ width: 1440, height: 1000 });
        await page.locator('[data-nav="overview"]').click();
        await page.locator(`[data-edit="${run.projectId}"]`).first().click();
        await page.getByLabel('Show workflow screenshots in run results').waitFor();
        expect(await page.getByLabel('Region exact name').inputValue()).toBe('Reference Auth App');
        await page.getByLabel('Region exact name').focus();
        await page.keyboard.press('Tab');
        expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('BODY');
        await page.getByLabel('Show workflow screenshots in run results').scrollIntoViewIfNeeded();
        await audit(
          '04-capture-settings',
          'Saved semantic capture settings remain editable with keyboard navigation',
        );
        await page.getByRole('button', { name: 'Save project' }).click();
        await page
          .getByRole('heading', { name: 'Project settings', exact: true })
          .waitFor({ state: 'hidden' });
        expect(errors).toEqual([]);
      } finally {
        await proof.finish();
        await context.close();
      }
    }
  } finally {
    await browser.close();
    await app.close();
  }
}
