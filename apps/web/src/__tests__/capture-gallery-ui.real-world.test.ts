import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { launchDashboardBrowser, resizeDashboard } from './dashboard-browser';
import { expect, it } from 'vitest';
import {
  bootFixtureApp,
  stopApp,
  vulnerableAuthApp,
} from '../../../../packages/real-world-testkit/src';
import { Workbench } from '../workbench';
import type { Run } from '../types';
import { startWorkbench } from './workbench-runtime';
import { dashboardProof } from './dashboard-proof';

it.each(['light', 'dark'] as const)(
  'finds real matrix captures and preserves exact evidence actions (%s)',
  async (theme) => {
    const root = resolve(import.meta.dirname, '../../../..');
    const target = await bootFixtureApp(root, vulnerableAuthApp, 'capture-gallery');
    let changed = false;
    // Controlled regression of the real reference response, not a synthetic UI oracle.
    const proxy = createServer(async (req, res) => {
      const upstream = await fetch(
        req.url === '/missing' ? `${target.origin}/missing` : target.origin,
      );
      const html = await upstream.text();
      res.statusCode = upstream.status;
      res.setHeader('Content-Type', 'text/html');
      res.end(
        html.replace(
          '</head>',
          `<style>body{background:#fff;color:#111}@media(prefers-color-scheme:dark){body{background:${changed ? '#603020' : '#171717'};color:#fff}}</style></head>`,
        ),
      );
    });
    await new Promise<void>((done) => proxy.listen(0, '127.0.0.1', done));
    const state = await mkdtemp(join(tmpdir(), 'capture-gallery-'));
    const wb = await Workbench.open(state, [root]);
    const browser = await launchDashboardBrowser();
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      colorScheme: theme,
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    const proof = dashboardProof(
      page,
      process.env.ARXIC_GALLERY_EVIDENCE_DIR
        ? join(process.env.ARXIC_GALLERY_EVIDENCE_DIR, theme)
        : undefined,
    );
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.name));
    let app: Awaited<ReturnType<typeof startWorkbench>> | undefined;
    async function readRun(id: string): Promise<Run> {
      const response = await page.request.get(`${app!.origin}/api/runs/${id}`);
      expect(response.status()).toBe(200);
      return response.json();
    }
    async function nextRun(previous: string) {
      await page.getByRole('button', { name: 'Run again', exact: true }).click();
      await expect.poll(() => new URL(page.url()).searchParams.get('run')).not.toBe(previous);
      const id = new URL(page.url()).searchParams.get('run')!;
      await expect
        .poll(async () => (await readRun(id)).state, { timeout: 90000 })
        .toBe('completed');
      await page.locator('.capture').first().waitFor();
      expect(await page.locator('.capture').count()).toBe(6);
      return readRun(id);
    }
    async function audit(name: string, action: string) {
      const frame = name.startsWith('02-')
        ? page.getByRole('heading', { name: 'Captured pages', exact: true })
        : page.getByRole('status').filter({ hasText: /^\d+ matching captures? of \d+$/ });
      await frame.scrollIntoViewIfNeeded();
      const result = await proof.audit(name, action);
      expect(result.details).toEqual([]);
      expect(result.overflow).toBe(0);
    }
    try {
      const project = await wb.saveProject({
        name: 'Capture gallery',
        folder: root,
        origin: `http://127.0.0.1:${(proxy.address() as { port: number }).port}`,
        captureConsent: true,
        browsers: ['chromium', 'firefox', 'webkit'],
        colorSchemes: ['light', 'dark'],
        viewports: [
          { width: 800, height: 600 },
          { width: 390, height: 844 },
        ],
      });
      const queued = wb.enqueue(project.id, 'visual');
      await wb.idle();
      const first = wb.store.run(queued.id)!;
      expect(first.result!.captures).toHaveLength(12);
      expect(first.result!.outcome).toBe('observed');
      await wb.close();
      app = await startWorkbench({
        roots: [root],
        stateDirectory: state,
        port: 0,
        adminToken: 'capture-gallery-test-administrator-token',
      });
      await page.goto(app.origin);
      await page.getByLabel('Administrator token').fill('capture-gallery-test-administrator-token');
      await page.getByRole('button', { name: 'Open workbench' }).click();
      await page.goto(`${app.origin}?view=runs&run=${first.id}`);
      await page.getByLabel('Search capture paths').fill('/missing');
      await page.getByText('0 matching captures of 12', { exact: true }).waitFor();
      expect(await page.locator('.capture').count()).toBe(0);
      expect(
        await page
          .getByRole('region', { name: 'Visual environments', exact: true })
          .locator('li')
          .count(),
      ).toBe(6);
      await page.getByText('No captures match these filters.', { exact: false }).waitFor();
      await audit(
        '01-no-matches',
        'Unmatched path retains run coverage and offers explicit filter reset',
      );
      await page.getByRole('button', { name: 'Clear capture filters' }).click();
      await expect.poll(() => page.locator('.capture').count()).toBe(6);
      await page.getByRole('button', { name: 'Next captures' }).focus();
      await page.keyboard.press('Enter');
      await page.getByText('Page 2 of 2', { exact: false }).waitFor();
      expect(
        await page.getByRole('button', { name: 'Next captures', exact: true }).isDisabled(),
      ).toBe(true);
      expect(
        await page
          .getByRole('heading', { name: 'Captured pages', exact: true })
          .evaluate((el) => el === document.activeElement),
      ).toBe(true);
      expect(await page.locator('.capture').count()).toBe(6);
      await audit(
        '02-next-page',
        'Keyboard pagination bounds the gallery and restores focus to its heading',
      );
      await resizeDashboard(page, { width: 320, height: 1000 });
      await page.getByRole('button', { name: 'Previous captures', exact: true }).focus();
      await page.keyboard.press('Enter');
      const focusedHeading = page.getByRole('heading', { name: 'Captured pages', exact: true });
      const headingBox = (await focusedHeading.boundingBox())!;
      const stickyHeader = (await page.locator('.sidebar').boundingBox())!;
      expect(headingBox.y).toBeGreaterThanOrEqual(stickyHeader.y + stickyHeader.height);
      await audit(
        '02-mobile-page',
        'Mobile keyboard pagination keeps its focused heading below the sticky header',
      );
      await resizeDashboard(page, { width: 1440, height: 1000 });

      await page.getByLabel('Capture browser', { exact: true }).selectOption('webkit');
      await page.getByLabel('Capture theme', { exact: true }).selectOption('dark');
      await page.getByLabel('Capture viewport', { exact: true }).selectOption('390x844');
      await page
        .getByLabel('Comparison at capture time', { exact: true })
        .selectOption('needs-baseline');
      const search = page.getByLabel('Search capture paths');
      await search.fill('/');
      await page.getByText('1 matching capture of 12', { exact: true }).waitFor();
      await page.waitForResponse(
        (response) => response.url().endsWith('/api/state') && response.ok(),
      );
      expect(await search.inputValue()).toBe('/');
      expect(await page.getByLabel('Capture browser', { exact: true }).inputValue()).toBe('webkit');
      const selected = first.result!.captures!.find(
        (c) =>
          c.environment?.browser === 'webkit' &&
          c.environment.colorScheme === 'dark' &&
          c.viewport.width === 390,
      )!;
      const card = page.locator('.capture');
      expect(await card.count()).toBe(1);
      expect(
        await card
          .getByRole('img', { name: 'Capture from this run', exact: true })
          .getAttribute('src'),
      ).toContain(`/${first.id}/artifacts/${selected.file}`);
      const download = await page.request.get(
        `${app.origin}/api/runs/${first.id}/artifacts/${selected.file}`,
      );
      expect(download.status()).toBe(200);
      expect(
        createHash('sha256')
          .update(await download.body())
          .digest('hex'),
      ).toBe(selected.sha256);
      await card.getByText('Measured checks and coverage', { exact: false }).click();
      await card.getByText('Download measurement evidence (JSON)', { exact: false }).waitFor();
      await card.getByRole('button', { name: 'Inspect captured elements', exact: true }).click();
      await card
        .getByRole('button', { name: /^Inspect element \d+$/ })
        .first()
        .click();
      await card
        .getByRole('region', { name: 'Selected element measurements', exact: true })
        .waitFor();
      await card.getByRole('button', { name: 'Inspect captured elements', exact: true }).click();
      await card.getByText('Ask AI to review this screenshot', { exact: true }).click();
      expect(await card.locator('form[data-review-form]').getAttribute('data-capture')).toBe(
        selected.id,
      );
      expect(await card.locator('form[data-review-form]').getAttribute('data-hash')).toBe(
        selected.sha256,
      );
      await card.getByText('Ask AI to review this screenshot', { exact: true }).click();
      await card.getByText('Measured checks and coverage', { exact: false }).click();
      for (const width of [320, 390, 768, 1440]) {
        await resizeDashboard(page, { width, height: 1000 });
        await audit(
          `03-filtered-${width}`,
          'Combined capture filters keep original image, measurement and review targets',
        );
      }
      const approve = card.getByRole('button', { name: 'Approve as baseline', exact: true });
      await approve.focus();
      await page.keyboard.press('Enter');
      await card.getByText('current approved baseline', { exact: true }).waitFor();
      expect((await readRun(first.id)).result).toEqual(first.result);
      expect(
        await page.getByLabel('Comparison at capture time', { exact: true }).inputValue(),
      ).toBe('needs-baseline');
      await audit(
        '04-approved',
        'Filtered approval preserves historical comparison and targets the selected capture',
      );
      const baselines = await (await page.request.get(`${app.origin}/api/state`)).json();
      expect(baselines.baselines).toContainEqual(
        expect.objectContaining({ run_id: first.id, capture_id: selected.id }),
      );
      for (const capture of first.result!.captures!.filter((c) => c.id !== selected.id)) {
        expect(
          (
            await page.request.post(`${app.origin}/api/runs/${first.id}/baselines`, {
              data: { captureId: capture.id },
              headers: { origin: app.origin },
            })
          ).status(),
        ).toBe(200);
      }
      const repeat = await nextRun(first.id);
      expect(
        repeat.result!.captures!.every((c) => c.status === 'unchanged' && c.changedPixels === 0),
      ).toBe(true);
      expect(await search.inputValue()).toBe('');
      expect(await page.getByLabel('Capture browser', { exact: true }).inputValue()).toBe('');
      await audit(
        '05-repeat',
        'A new run resets gallery filters and compares unchanged captures with approved baselines',
      );
      changed = true;
      const regression = await nextRun(repeat.id);
      expect(regression.result!.captures!.filter((c) => c.status === 'changed')).toHaveLength(6);
      await page.getByLabel('Comparison at capture time', { exact: true }).selectOption('changed');
      await page.getByText('6 matching captures of 12', { exact: true }).waitFor();
      expect(await page.locator('.capture').count()).toBe(6);
      await page.getByLabel('Capture browser', { exact: true }).selectOption('firefox');
      await page.getByLabel('Capture viewport', { exact: true }).selectOption('800x600');
      await page.getByText('1 matching capture of 12', { exact: true }).waitFor();
      const expected = regression.result!.captures!.find(
        (c) =>
          c.environment?.browser === 'firefox' &&
          c.environment.colorScheme === 'dark' &&
          c.viewport.width === 800,
      )!;
      expect(
        await page
          .locator('.capture')
          .getByRole('img', { name: 'Baseline used for this run', exact: true })
          .getAttribute('src'),
      ).toContain(`/${first.id}/artifacts/${expected.baselineFile}`);
      await audit(
        '06-regression',
        'Comparison filter finds a real dark-only regression without changing baseline history',
      );
      await page.goto(`${app.origin}?view=runs&run=${first.id}`);
      await page.getByText('12 matching captures of 12', { exact: true }).waitFor();
      expect(await page.getByLabel('Capture browser', { exact: true }).inputValue()).toBe('');
      expect((await readRun(first.id)).result).toEqual(first.result);
      const blockedProjectResponse = await page.request.post(`${app.origin}/api/projects`, {
        headers: { origin: app.origin },
        data: {
          name: 'Missing-page gallery',
          folder: root,
          origin: project.origin,
          captureConsent: true,
          browsers: ['chromium', 'firefox', 'webkit'],
          colorSchemes: ['light', 'dark'],
          paths: ['/', '/missing'],
          viewports: [{ width: 800, height: 600 }],
        },
      });
      expect(blockedProjectResponse.status()).toBe(201);
      const blockedProject = await blockedProjectResponse.json();
      const blockedResponse = await page.request.post(
        `${app.origin}/api/projects/${blockedProject.id}/runs`,
        {
          headers: { origin: app.origin },
          data: { mode: 'visual' },
        },
      );
      expect(blockedResponse.status()).toBe(202);
      const blockedId = (await blockedResponse.json()).id;
      await expect
        .poll(async () => (await readRun(blockedId)).state, { timeout: 90000 })
        .toBe('blocked');
      const blockedRun = await readRun(blockedId);
      expect(blockedRun.result!.captures).toHaveLength(6);
      expect(
        blockedRun.result!.visualEnvironments!.every((cell) => cell.outcome === 'blocked'),
      ).toBe(true);
      await page.goto(`${app.origin}?view=runs&run=${blockedId}`);
      await page.getByLabel('Search capture paths').fill('/missing');
      await page.getByText('0 matching captures of 6', { exact: true }).waitFor();
      const blockedCells = await page
        .getByRole('region', { name: 'Visual environments', exact: true })
        .locator('li')
        .allTextContents();
      expect(blockedCells).toHaveLength(6);
      expect(blockedCells.every((text) => /blocked/i.test(text))).toBe(true);
      expect(await page.locator('.capture').count()).toBe(0);
      await audit(
        '07-blocked',
        'No-match filtering preserves all six real missing-page blocked outcomes',
      );
      await page.getByRole('button', { name: 'Clear capture filters', exact: true }).click();
      expect(await page.locator('.capture').count()).toBe(6);
      expect(
        await page.getByRole('button', { name: 'Approve as baseline', exact: true }).count(),
      ).toBe(0);
      expect(errors).toEqual([]);
      if (process.env.ARXIC_GALLERY_EVIDENCE_DIR) {
        await writeFile(
          join(process.env.ARXIC_GALLERY_EVIDENCE_DIR, theme, 'measurements.json'),
          JSON.stringify(
            {
              mobileHeading: headingBox,
              mobileStickyHeader: stickyHeader,
              selectedImageSha256: selected.sha256,
              initialCaptures: first.result!.captures!.length,
              independentSpecs: new Set(first.result!.captures!.map((c) => c.specHash)).size,
              repeatedUnchanged: repeat.result!.captures!.filter(
                (c) => c.status === 'unchanged' && c.changedPixels === 0,
              ).length,
              regressedDark: regression.result!.captures!.filter(
                (c) => c.environment?.colorScheme === 'dark' && c.status === 'changed',
              ).length,
              unchangedLight: regression.result!.captures!.filter(
                (c) => c.environment?.colorScheme === 'light' && c.status === 'unchanged',
              ).length,
              pageErrors: errors.length,
              blockedEnvironments: blockedRun.result!.visualEnvironments!.filter(
                (cell) => cell.outcome === 'blocked',
              ).length,
              preservedBlockedRunCaptures: blockedRun.result!.captures!.length,
            },
            null,
            2,
          ),
        );
      }
    } finally {
      await proof.finish();
      await browser.close();
      if (app) await app.close();
      else await wb.close();
      proxy.closeAllConnections();
      await new Promise<void>((done) => proxy.close(() => done()));
      await stopApp(target.child);
      await rm(target.runtimeDirectory, { recursive: true, force: true });
      await rm(state, { recursive: true, force: true });
    }
  },
  240000,
);
