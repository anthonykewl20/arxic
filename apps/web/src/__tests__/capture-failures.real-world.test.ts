import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';
import {
  bootFixtureApp,
  stopApp,
  vulnerableAuthApp,
} from '../../../../packages/real-world-testkit/src';
import { Workbench } from '../workbench';
import { startWorkbench } from './workbench-runtime';
import { launchDashboardBrowser, resizeDashboard } from './dashboard-browser';
import { dashboardProof } from './dashboard-proof';

it('retains healthy matrix siblings and distinguishes navigation from required-mask refusal', async () => {
  const root = resolve(import.meta.dirname, '../../../..');
  const target = await bootFixtureApp(root, vulnerableAuthApp, 'capture-failures');
  const directory = await mkdtemp(join(tmpdir(), 'capture-failures-'));
  const wb = await Workbench.open(directory, [root]);
  const browser = await launchDashboardBrowser();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  const evidence =
    process.env.ARXIC_CAPTURE_FAILURE_EVIDENCE_DIR ??
    (process.env.ARXIC_WEB_EVIDENCE_DIR
      ? join(process.env.ARXIC_WEB_EVIDENCE_DIR, 'capture-failures')
      : undefined);
  const proof = dashboardProof(page, evidence);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.name));
  async function audit(...args: Parameters<typeof proof.audit>) {
    const report = await proof.audit(...args);
    expect(report.violations).toEqual([]);
    expect(report.overflow).toBe(0);
    return report;
  }
  let app: Awaited<ReturnType<typeof startWorkbench>> | undefined;
  try {
    const config = {
      name: 'Capture failure reference',
      folder: join(root, 'test-fixtures/vulnerable-auth-app'),
      origin: target.origin,
      captureConsent: true,
      paths: ['/', '/missing'],
      viewports: [{ width: 800, height: 600 }],
      browsers: ['chromium', 'firefox', 'webkit'],
      colorSchemes: ['light', 'dark'],
    };
    const project = await wb.saveProject(config);
    const queued = wb.enqueue(project.id, 'visual');
    await wb.idle();
    const result = wb.store.run(queued.id)!.result!;
    expect(result.outcome).toBe('blocked');
    expect(result.captures, JSON.stringify(result.visualEnvironments)).toHaveLength(6);
    expect(result.visualEnvironments).toHaveLength(6);
    const navigation = result.findings!.filter(
      (f) => 'failurePhase' in f && f.failurePhase === 'navigation',
    );
    if (evidence) {
      await mkdir(evidence, { recursive: true });
      await writeFile(join(evidence, 'navigation-result.json'), JSON.stringify(result, null, 2));
      for (const file of ['timeline.json', 'timeline.sanitization.json'])
        await writeFile(
          join(evidence, `engine-${file}`),
          (await wb.artifact(queued.id, file)).bytes,
        );
    }
    await wb.close();
    app = await startWorkbench({
      roots: [root],
      stateDirectory: directory,
      port: 0,
      adminToken: 'capture-failure-test-token-32-characters',
    });
    await page.goto(`${app.origin}?view=runs&run=${queued.id}`);
    await page.getByLabel('Administrator token').fill('capture-failure-test-token-32-characters');
    await page.getByRole('button', { name: 'Open workbench' }).click();
    await page.getByRole('region', { name: 'Visual environments', exact: true }).waitFor();
    await audit(
      '01-navigation-refusal',
      'Healthy sibling captures remain visible beside each blocked navigation cell',
      [
        {
          id: 'navigation-failures-classified',
          passed: navigation.length === 6,
          values: { expected: 6, actual: navigation.length },
        },
      ],
    );
    expect(navigation).toHaveLength(6);
    expect(navigation.every((f) => f.path === '/missing')).toBe(true);
    expect(
      await page
        .getByText('Navigation failed. Check the page address, access and server response.', {
          exact: true,
        })
        .count(),
    ).toBe(6);
    await app.close();
    app = undefined;
    const second = await Workbench.open(directory, [root]);
    try {
      await second.saveProject(
        { ...config, paths: ['/'], masks: ['.arxic-absent-required-mask'] },
        project.id,
      );
      const masked = second.enqueue(project.id, 'visual');
      await second.idle();
      const refusal = second.store.run(masked.id)!.result!;
      expect(refusal.outcome).toBe('blocked');
      expect(refusal.captures).toHaveLength(0);
      expect(
        refusal.findings?.filter(
          (f) => 'failurePhase' in f && f.failurePhase === 'privacy-capture',
        ),
      ).toHaveLength(6);
      expect(
        refusal.visualEnvironments?.every(
          (cell) => cell.outcome === 'blocked' && cell.captures === 0,
        ),
      ).toBe(true);
      if (evidence)
        await writeFile(join(evidence, 'privacy-result.json'), JSON.stringify(refusal, null, 2));
      await second.close();
      app = await startWorkbench({
        roots: [root],
        stateDirectory: directory,
        port: 0,
        adminToken: 'capture-failure-test-token-32-characters',
      });
      await page.goto(`${app.origin}?view=runs&run=${masked.id}`);
      await page.getByLabel('Administrator token').fill('capture-failure-test-token-32-characters');
      await page.getByRole('button', { name: 'Open workbench' }).click();
      await page.getByRole('region', { name: 'Visual environments', exact: true }).waitFor();
      expect(
        await page
          .getByText(
            'Masked capture failed. Check required privacy masks and browser capture support.',
            { exact: true },
          )
          .count(),
      ).toBe(6);
      await audit(
        '02-required-mask-refusal',
        'Each missing required-mask capture remains blocked with recovery guidance',
      );
      await resizeDashboard(page, { width: 390, height: 844 });
      await page
        .getByRole('heading', { name: 'Findings and capture diagnostics', exact: true })
        .scrollIntoViewIfNeeded();
      await audit(
        '03-mobile-refusal',
        'Blocked capture recovery guidance wraps within the mobile viewport',
      );
      const editCapture = page.getByRole('button', { name: 'Edit capture settings', exact: true });
      const editCount = await editCapture.count();
      await audit(
        '04-recovery-entry',
        'A blocked run offers direct access to its project capture settings',
        [
          {
            id: 'capture-settings-recovery',
            passed: editCount === 1,
            values: { actual: editCount, expected: 1 },
          },
        ],
      );
      expect(editCount).toBe(1);
      await editCapture.click();
      const masks = page.getByLabel('Additional privacy masks');
      expect(await masks.inputValue()).toBe('.arxic-absent-required-mask');
      await masks.click();
      await masks.fill('h1');
      expect(await masks.inputValue()).toBe('h1');
      await audit(
        '05-edit-required-mask',
        'Correct the required mask using the existing project settings form',
      );
      await page.getByRole('button', { name: 'Save project', exact: true }).click();
      await expect.poll(() => page.locator('#project-dialog').isVisible()).toBe(false);
      await page.getByRole('button', { name: 'Run again', exact: true }).click();
      // The enqueue POST round-trip can exceed vitest's 1 s poll default under
      // non-sharded load (observed in release-test ubuntu cells, #525).
      await expect
        .poll(() => new URL(page.url()).searchParams.get('run'), { timeout: 30_000 })
        .not.toBe(masked.id);
      const recoveredId = new URL(page.url()).searchParams.get('run')!;
      const read = async (id: string) => {
        const response = await page.request.get(`${app!.origin}/api/runs/${id}`);
        expect(response.status()).toBe(200);
        return response.json();
      };
      await expect
        .poll(async () => (await read(recoveredId)).state, { timeout: 90000 })
        .toBe('completed');
      await page.locator('.capture').first().waitFor();
      const recovered = await read(recoveredId);
      expect(recovered.result.captures).toHaveLength(6);
      expect(recovered.project.masks).toEqual(['h1']);
      expect(
        recovered.result.findings.some(
          (finding: { failurePhase?: string }) => finding.failurePhase,
        ),
      ).toBe(false);
      await page.locator('.run-detail .result-summary').scrollIntoViewIfNeeded();
      await audit(
        '06-recovered-run',
        'Rerun with the corrected mask yields six actual browser/theme captures',
      );
      await page.goto(`${app.origin}?view=runs&run=${masked.id}`);
      await page.getByRole('button', { name: 'Edit capture settings', exact: true }).waitFor();
      const original = await read(masked.id);
      expect(original.state).toBe('blocked');
      expect(original.result.captures).toHaveLength(0);
      expect(original.project.masks).toEqual(['.arxic-absent-required-mask']);
      await page.locator('.run-detail .result-summary').scrollIntoViewIfNeeded();
      await audit(
        '07-original-refusal-preserved',
        'The original blocked run remains immutable after a successful corrected run',
      );
      expect(errors).toEqual([]);
    } finally {
      await second.close();
    }
  } finally {
    await proof.finish();
    await browser.close();
    await app?.close();
    await wb.close();
    await stopApp(target.child);
    await rm(target.runtimeDirectory, { recursive: true, force: true });
    await rm(directory, { recursive: true, force: true });
  }
}, 120000);
