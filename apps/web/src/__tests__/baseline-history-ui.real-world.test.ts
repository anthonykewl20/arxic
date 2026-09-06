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
import { Workbench } from '../workbench';
import { startWorkbench } from '../server';
import type { Run } from '../types';
import { dashboardProof } from './dashboard-proof';

it.each(['light', 'dark'] as const)(
  'distinguishes historical comparison from current baseline approval (%s)',
  async (theme) => {
    const root = resolve(import.meta.dirname, '../../../..');
    const target = await bootFixtureApp(root, vulnerableAuthApp, 'baseline-history');
    const directory = await mkdtemp(join(tmpdir(), 'baseline-history-'));
    const wb = await Workbench.open(directory, [root]);
    let app: Awaited<ReturnType<typeof startWorkbench>> | undefined;
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      colorScheme: theme,
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    const proof = dashboardProof(
      page,
      process.env.ARXIC_BASELINE_HISTORY_EVIDENCE_DIR
        ? join(process.env.ARXIC_BASELINE_HISTORY_EVIDENCE_DIR, theme)
        : undefined,
    );
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.name));
    async function audit(name: string, action: string) {
      await page.locator('.capture-head').scrollIntoViewIfNeeded();
      const result = await proof.audit(name, action);
      expect(result.details).toEqual([]);
      expect(result.overflow).toBe(0);
    }
    async function readRun(id: string): Promise<Run> {
      const response = await page.request.get(`${app!.origin}/api/runs/${id}`);
      expect(response.status()).toBe(200);
      return response.json();
    }
    async function approve() {
      const button = page.getByRole('button', { name: 'Approve as baseline', exact: true });
      await button.focus();
      await page.keyboard.press('Enter');
    }
    async function nextRun(previous: string) {
      await page.getByRole('button', { name: 'Run again', exact: true }).click();
      await expect.poll(() => new URL(page.url()).searchParams.get('run')).not.toBe(previous);
      const id = new URL(page.url()).searchParams.get('run')!;
      await expect
        .poll(async () => (await readRun(id)).state, { timeout: 30000 })
        .toBe('completed');
      await page.getByText('unchanged', { exact: true }).waitFor();
      return await readRun(id);
    }
    try {
      const project = await wb.saveProject({
        name: 'Baseline history reference',
        folder: join(root, 'test-fixtures/vulnerable-auth-app'),
        origin: target.origin,
        captureConsent: true,
        viewports: [{ width: 800, height: 600 }],
      });
      const queued = wb.enqueue(project.id, 'visual');
      await wb.idle();
      const first = wb.store.run(queued.id)!;
      const capture = first.result!.captures![0];
      const original = (await wb.artifact(first.id, capture.file)).bytes;
      await wb.close();
      app = await startWorkbench({
        roots: [root],
        stateDirectory: directory,
        port: 0,
        adminToken: 'baseline-history-proof-token-at-least-32',
      });
      await page.goto(`${app.origin}?view=runs&run=${first.id}`);
      await page.getByLabel('Administrator token').fill('baseline-history-proof-token-at-least-32');
      await page.getByRole('button', { name: 'Open workbench' }).click();
      await page.goto(`${app.origin}?view=runs&run=${first.id}`);
      await page.getByRole('button', { name: 'Approve as baseline', exact: true }).waitFor();
      await page.route('**/baselines', (route) =>
        route.fulfill({ status: 503, json: { error: 'Baseline approval unavailable' } }),
      );
      await approve();
      await page.getByText('Baseline approval unavailable', { exact: true }).waitFor();
      await page
        .getByText('Comparison at capture time: no prior baseline', { exact: true })
        .waitFor();
      expect(await page.getByText('current approved baseline', { exact: true }).count()).toBe(0);
      await audit(
        '01-approval-unavailable',
        'Approval failure preserves historical no-baseline result and offers retry',
      );
      await page.unroute('**/baselines');
      await approve();
      await page.getByText('current approved baseline', { exact: true }).waitFor();
      expect((await readRun(first.id)).result).toEqual(first.result);
      expect(await page.getByText('Awaiting a reviewed baseline', { exact: true }).count()).toBe(0);
      await audit(
        '02-first-approved',
        'Current approval is distinct from the immutable absence of a prior baseline',
      );
      await page.setViewportSize({ width: 390, height: 844 });
      await audit(
        '03-mobile-approved',
        'Mobile approval badge and historical comparison copy remain distinct and readable',
      );
      await page.setViewportSize({ width: 1440, height: 1000 });
      const second = await nextRun(first.id);
      expect(second.result!.captures![0].baselineRunId).toBe(first.id);
      await page.getByRole('img', { name: 'Baseline used for this run', exact: true }).waitFor();
      await audit('04-compared', 'Subsequent capture compares against the approved first image');
      await approve();
      await page.getByText('current approved baseline', { exact: true }).waitFor();
      const third = await nextRun(second.id);
      expect(third.result!.captures![0].baselineRunId).toBe(second.id);
      await page.goto(`${app.origin}?view=runs&run=${second.id}`);
      await page.getByText('current approved baseline', { exact: true }).waitFor();
      expect((await readRun(second.id)).result).toEqual(second.result);
      expect(
        await page
          .getByRole('img', { name: 'Baseline used for this run', exact: true })
          .getAttribute('src'),
      ).toContain(first.id);
      await page
        .locator('.compare img')
        .evaluateAll((images) =>
          Promise.all(images.map((image) => (image as HTMLImageElement).decode())),
        );
      await audit(
        '05-replaced',
        'Replacement changes future comparisons without rewriting the prior comparison',
      );
      await page.goto(`${app.origin}?view=runs&run=${first.id}`);
      await page.getByRole('button', { name: 'Approve as baseline', exact: true }).waitFor();
      await page
        .getByText('Comparison at capture time: no prior baseline', { exact: true })
        .waitFor();
      expect(await page.getByText('current approved baseline', { exact: true }).count()).toBe(0);
      expect((await readRun(first.id)).result).toEqual(first.result);
      const response = await page.request.get(
        `${app.origin}/api/runs/${first.id}/artifacts/${capture.file}`,
      );
      expect((await response.body()).equals(original)).toBe(true);
      await page.setViewportSize({ width: 390, height: 844 });
      await audit(
        '06-mobile-history',
        'Mobile history distinguishes no prior baseline from current approval after replacement',
      );
      expect(errors).toEqual([]);
    } finally {
      await proof.finish();
      await browser.close();
      await app?.close();
      await wb.close();
      await stopApp(target.child);
      await rm(target.runtimeDirectory, { recursive: true, force: true });
      await rm(directory, { recursive: true, force: true });
    }
  },
  120000,
);
