import { mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
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
import { dashboardProof } from './dashboard-proof';
it.each(['light', 'dark'] as const)(
  'previews and cleans real expired evidence through the dashboard (%s)',
  async (theme) => {
    const root = resolve(import.meta.dirname, '../../../..');
    const target = await bootFixtureApp(root, vulnerableAuthApp, 'retention-ui');
    const directory = await mkdtemp(join(tmpdir(), 'retention-ui-'));
    let wb = await Workbench.open(directory, [root]);
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
      process.env.ARXIC_RETENTION_EVIDENCE_DIR
        ? join(process.env.ARXIC_RETENTION_EVIDENCE_DIR, theme)
        : undefined,
    );
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.name));
    async function audit(name: string, action: string) {
      const result = await proof.audit(name, action);
      expect(result.details).toEqual([]);
      expect(result.overflow).toBe(0);
    }
    try {
      const project = await wb.saveProject({
        name: 'Retention reference',
        folder: join(root, 'test-fixtures/vulnerable-auth-app'),
        origin: target.origin,
        captureConsent: true,
        viewports: [{ width: 800, height: 600 }],
      });
      const baseline = wb.enqueue(project.id, 'visual');
      await wb.idle();
      const capture = wb.store.run(baseline.id)!.result!.captures![0];
      await wb.approveBaseline(baseline.id, capture.id);
      const expired = wb.enqueue(project.id, 'visual');
      await wb.idle();
      const newest = wb.enqueue(project.id, 'visual');
      await wb.idle();
      for (const [run, days] of [
        [baseline, 62],
        [expired, 61],
        [newest, 60],
      ] as const) {
        const stored = wb.store.run(run.id)!;
        const date = new Date(Date.now() - days * 86400000).toISOString();
        wb.store.saveRun({ ...stored, createdAt: date, finishedAt: date });
      }
      const expected = (await wb.artifact(baseline.id, capture.file)).bytes;
      await wb.close();
      app = await startWorkbench({
        roots: [root],
        stateDirectory: directory,
        port: 0,
        adminToken: 'retention-dashboard-proof-token-32-chars',
      });
      await page.route('**/api/retention', (route) =>
        route.fulfill({ status: 503, json: { error: 'Retention settings unavailable' } }),
      );
      await page.goto(app.origin);
      await page.getByLabel('Administrator token').fill('retention-dashboard-proof-token-32-chars');
      await page.getByRole('button', { name: 'Open workbench' }).click();
      await page.locator('[data-nav="admin"]').click();
      const panel = page.getByRole('region', { name: 'Evidence retention' });
      await panel.getByRole('button', { name: 'Retry retention settings' }).waitFor();
      await panel.scrollIntoViewIfNeeded();
      await audit(
        '01-unavailable',
        'Unavailable retention settings offer retry and no cleanup action',
      );
      await page.unroute('**/api/retention');
      await panel.getByRole('button', { name: 'Retry retention settings' }).click();
      const enabled = panel.getByLabel('Automatically delete expired runs');
      expect(await enabled.isChecked()).toBe(false);
      await panel.getByLabel('Keep newest runs per project').fill('1');
      await enabled.check();
      await page.route('**/api/retention/preview', (route) =>
        route.fulfill({ status: 503, json: { error: 'Retention preview unavailable' } }),
      );
      await panel.getByRole('button', { name: 'Preview retention' }).click();
      await panel
        .getByRole('alert')
        .getByText('Retention preview unavailable', { exact: true })
        .waitFor();
      await page.unroute('**/api/retention/preview');
      await panel.getByRole('button', { name: 'Preview retention' }).click();
      await panel.getByText(expired.id, { exact: true }).waitFor();
      expect(await panel.getByRole('button', { name: 'Save retention policy' }).isEnabled()).toBe(
        false,
      );
      await page.setViewportSize({ width: 390, height: 844 });
      await panel
        .getByLabel('I authorize automatic deletion under this policy')
        .scrollIntoViewIfNeeded();
      await audit(
        '02-mobile-preview',
        'Preview identifies the expired real run and requires explicit deletion consent',
      );
      await panel.getByLabel('I authorize automatic deletion under this policy').check();
      await panel.getByRole('button', { name: 'Save retention policy' }).click();
      await panel.getByText('Retention policy saved.', { exact: true }).waitFor();
      await page.setViewportSize({ width: 1440, height: 1000 });
      await rename(join(directory, 'runs'), join(directory, 'runs-backup'));
      await writeFile(join(directory, 'runs'), 'storage unavailable');
      await panel.getByRole('button', { name: 'Clean up now' }).click();
      await panel
        .getByRole('alert')
        .getByText('Evidence cleanup failed; check storage and retry', { exact: true })
        .waitFor();
      await panel.getByText(/1 authorized deletion awaits recovery/).waitFor();
      await audit(
        '03-cleanup-failed',
        'Storage failure shows the pending authorized deletion and recovery instructions',
      );
      await rm(join(directory, 'runs'));
      await rename(join(directory, 'runs-backup'), join(directory, 'runs'));
      await panel.getByRole('button', { name: 'Clean up now' }).click();
      await panel.getByText('Deleted 1 run.', { exact: true }).waitFor();
      await panel.scrollIntoViewIfNeeded();
      await audit(
        '04-cleaned',
        'Cleanup removes one expired run and preserves protected/recent evidence',
      );
      const response = await page.request.get(
        `${app.origin}/api/runs/${baseline.id}/artifacts/${capture.file}`,
      );
      expect(response.status()).toBe(200);
      expect((await response.body()).equals(expected)).toBe(true);
      await page.goto(`${app.origin}?view=runs&run=${baseline.id}`);
      await page.getByRole('heading', { name: 'Test runs', exact: true }).waitFor();
      await page.getByText('current approved baseline', { exact: true }).waitFor();
      await page
        .locator('.compare img')
        .evaluateAll((images) =>
          Promise.all(images.map((image) => (image as HTMLImageElement).decode())),
        );
      await audit('05-baseline', 'Approved real screenshot remains accessible after retention');
      expect(errors).toEqual([]);
      await app.close();
      app = undefined;
      wb = await Workbench.open(directory, [root]);
      expect(wb.retentionState().policy.enabled).toBe(true);
      expect(wb.store.run(expired.id)).toBeUndefined();
      expect(wb.store.run(newest.id)).toBeDefined();
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
