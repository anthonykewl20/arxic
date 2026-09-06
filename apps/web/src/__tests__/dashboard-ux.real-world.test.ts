import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { dashboardProof } from './dashboard-proof';
import { launchDashboardBrowser, resizeDashboard } from './dashboard-browser';
import { expect, it } from 'vitest';
import { startWorkbench } from './workbench-runtime';
import { captureMaskedViewport } from '@arxic/playwright-screenshot-privacy';

it('keeps navigation reachable by URL, refresh, back and keyboard', async () => {
  const root = resolve(import.meta.dirname, '../../../..');
  const state = await mkdtemp(join(tmpdir(), 'dashboard-ux-'));
  const app = await startWorkbench({
    roots: [root],
    stateDirectory: state,
    adminToken: 'dashboard-ux-test-token-32-characters',
    port: 0,
  });
  const browser = await launchDashboardBrowser({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.name));
  const proof = dashboardProof(page, process.env.ARXIC_UX_EVIDENCE_DIR);
  try {
    await page.goto(app.origin);
    await page.getByLabel('Administrator token').fill('dashboard-ux-test-token-32-characters');
    await page.getByRole('button', { name: 'Open workbench' }).click();
    await page.getByRole('heading', { name: 'Workspace overview' }).waitFor();
    const pixels = await sharp(
      await captureMaskedViewport(page, {
        automaticMasks: ['input[type="password"]'],
        requiredMasks: [],
      }),
    )
      .removeAlpha()
      .raw()
      .toBuffer();
    expect([...pixels.subarray((900 * 1440 + 1400) * 3, (900 * 1440 + 1400) * 3 + 3)]).toEqual([
      255, 255, 255,
    ]);
    expect((await page.locator('#new-project').boundingBox())!.height).toBeGreaterThanOrEqual(28);
    await page.getByRole('radio', { name: 'Follow system theme' }).focus();
    await page.keyboard.press('ArrowRight');
    expect(
      await page.getByRole('radio', { name: 'Light theme' }).getAttribute('aria-checked'),
    ).toBe('true');
    expect(
      await page
        .getByRole('radio', { name: 'Light theme' })
        .evaluate((el) => el === document.activeElement),
    ).toBe(true);
    await page.getByRole('button', { name: 'Test runs', exact: true }).click();
    await page.getByRole('heading', { name: 'Test runs', exact: true }).waitFor();
    expect(new URL(page.url()).searchParams.get('view')).toBe('runs');
    await page.reload();
    await page.getByRole('heading', { name: 'Test runs', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Administration', exact: true }).click();
    await page.goBack();
    await page.getByRole('heading', { name: 'Test runs', exact: true }).waitFor();
    await page.goto(app.origin + '?view=runs&run=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
    await page.getByRole('heading', { name: 'Test runs', exact: true }).waitFor({ timeout: 5000 });
    expect(await page.locator('#notice').textContent()).toContain('no longer available');
    const violations = [];
    for (const width of [1440, 768, 390, 320]) {
      await resizeDashboard(page, { width, height: 1000 });
      for (const theme of ['light', 'dark'] as const) {
        if (width <= 760 && !(await page.getByRole('radiogroup', { name: 'Theme' }).isVisible()))
          await page.locator('.mobile-nav-toggle').click();
        await page
          .getByRole('radio', { name: theme === 'light' ? 'Light theme' : 'Dark theme' })
          .click();
        for (const view of [
          'overview',
          'intents',
          'runs',
          'campaigns',
          'schedules',
          'providers',
          'admin',
        ]) {
          if (!(await page.locator(`[data-nav="${view}"]`).isVisible()))
            await page.locator('.mobile-nav-toggle').click();
          await page.locator(`[data-nav="${view}"]`).click();
          await page
            .locator(`[data-nav="${view}"][aria-current="page"]`)
            .waitFor({ state: 'attached' });
          if (view === 'runs' || view === 'intents') {
            const form = page.locator(view === 'runs' ? '#run-search' : '#declaration-search');
            const field = (await form.locator('input').boundingBox())!;
            const submit = (await form.locator('button').boundingBox())!;
            expect(
              Math.abs(field.y + field.height / 2 - submit.y - submit.height / 2),
              `${view} search control alignment at ${width}`,
            ).toBeLessThan(0.5);
          }
          const result = await proof.audit(
            `${width}-${theme}-${view}`,
            `Navigate to ${view} at ${width}px in ${theme}; audit accessibility/reflow`,
          );
          expect(result.incomplete.filter((check) => check.id === 'aria-prohibited-attr')).toEqual(
            [],
          );
          violations.push(...result.details.map((v) => ({ width, theme, view, ...v })));
          expect(result.overflow, `${width}/${theme}/${view} horizontal overflow`).toBe(0);
        }
      }
    }
    await resizeDashboard(page, { width: 390, height: 844 });
    await page.locator('#new-project').click();
    const dialog = page.locator('dialog[open]');
    await dialog.waitFor();
    const bounds = (await dialog.boundingBox())!;
    expect(
      Math.abs(bounds.x - (390 - bounds.width) / 2),
      'modal horizontal centering',
    ).toBeLessThan(0.5);
    expect(Math.abs(bounds.y - (844 - bounds.height) / 2), 'modal vertical centering').toBeLessThan(
      0.5,
    );
    for (let i = 0; i < 15; i++) {
      await page.keyboard.press('Tab');
      expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    }
    const modalAudit = await proof.audit(
      '390-dark-project-dialog',
      'Open project wizard; Tab remains in modal',
    );
    violations.push(...modalAudit.details);
    expect(modalAudit.overflow).toBe(0);
    await page.keyboard.press('Escape');
    expect(await dialog.count()).toBe(0);
    expect(await page.locator('#new-project').evaluate((el) => el === document.activeElement)).toBe(
      true,
    );
    await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
    const forced = await proof.audit(
      '390-forced-colors',
      'Close modal restores focus; forced colors reflow',
    );
    violations.push(...forced.details);
    expect(forced.overflow).toBe(0);
    expect(violations).toEqual([]);
    await page.locator('.mobile-nav-toggle').click();
    await page.locator('[data-nav="runs"]').click();
    await page.getByLabel('Search runs').waitFor();
    await page.route('**/api/runs?**', (route) =>
      new URL(route.request().url()).searchParams.get('query') === 'expired-session'
        ? route.fulfill({ status: 401, json: { error: 'Session expired' } })
        : route.continue(),
    );
    // Background polling must remain authenticated until the explicit search is submitted.
    await page.waitForResponse((response) => new URL(response.url()).pathname === '/api/runs');
    expect(await page.getByLabel('Search runs').isVisible()).toBe(true);
    await page.getByLabel('Search runs').fill('expired-session');
    await page.getByRole('button', { name: 'Search runs', exact: true }).click();
    await page.getByLabel('Administrator token').waitFor();
    expect(await page.locator('#app').isHidden()).toBe(true);
    const signIn = (await page.getByRole('button', { name: 'Open workbench' }).boundingBox())!;
    const labelPixels = await sharp(
      await captureMaskedViewport(page, {
        automaticMasks: ['input[type="password"]'],
        requiredMasks: [],
      }),
    )
      .extract({
        left: Math.ceil(signIn.x + 12),
        top: Math.ceil(signIn.y + 8),
        width: Math.floor(signIn.width - 24),
        height: Math.floor(signIn.height - 16),
      })
      .removeAlpha()
      .raw()
      .toBuffer();
    let ink = 0;
    for (let i = 0; i < labelPixels.length; i += 3)
      if (labelPixels[i]! < 50 && labelPixels[i + 1]! < 50 && labelPixels[i + 2]! < 50) ink++;
    expect(ink, 'visible sign-in glyphs in Chromium forced-colors profile').toBeGreaterThan(20);

    expect(errors).toEqual([]);
    const expired = await proof.audit(
      'expired-search-session',
      '401 search response returns to login without stale dashboard or script errors',
    );
    expect(expired.details).toEqual([]);
    expect(expired.overflow).toBe(0);
  } finally {
    await proof.finish();
    await browser.close();
    await app.close();
    await rm(state, { recursive: true, force: true });
  }
}, 180_000);
