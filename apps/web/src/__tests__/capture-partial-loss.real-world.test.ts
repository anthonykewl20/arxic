import { mkdirSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';
import {
  bootFixtureApp,
  stopApp,
  vulnerableAuthApp,
} from '../../../../packages/real-world-testkit/src';
import { Workbench } from '../workbench';
import type { Run } from '../types';
import { startWorkbench } from './workbench-runtime';
import { launchDashboardBrowser } from './dashboard-browser';
import { dashboardProof } from './dashboard-proof';
import { trackDashboardErrors } from './dashboard-errors';

// #448: an environment-level infrastructure failure (here: a real storage
// fault on the environment's timeline destination, injected as an existing
// directory) must not discard that environment's already-completed healthy
// captures, and must classify the loss instead of collapsing it into an
// unattributed environment refusal.
it('retains completed captures and classifies the loss when an environment timeline write fails', async () => {
  const root = resolve(import.meta.dirname, '../../../..');
  const target = await bootFixtureApp(root, vulnerableAuthApp, 'partial-loss');
  const state = await mkdtemp(join(tmpdir(), 'capture-partial-loss-'));
  const wb = await Workbench.open(state, [root]);
  let app: Awaited<ReturnType<typeof startWorkbench>> | undefined;
  const browser = await launchDashboardBrowser();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  const errors = trackDashboardErrors(page);
  const evidence = process.env.ARXIC_PARTIAL_LOSS_EVIDENCE_DIR;
  const proof = dashboardProof(page, evidence);
  try {
    const project = await wb.saveProject({
      name: 'Partial loss reference',
      folder: join(root, 'test-fixtures/vulnerable-auth-app'),
      origin: target.origin,
      captureConsent: true,
      paths: ['/'],
      viewports: [{ width: 800, height: 600 }],
      browsers: ['chromium', 'firefox'],
      colorSchemes: ['light'],
    });
    const run = wb.store.enqueue(project, 'visual')!;
    const directory = join(state, 'runs', run.id);
    // Unlike chmod, EISDIR reproduces under root and ordinary CI users alike.
    // The fault lands after firefox-light's healthy '/' capture: the
    // environment's timeline write is the discard point under the old code.
    mkdirSync(join(directory, 'firefox-light-timeline.json'), { recursive: true });
    await wb.close();
    app = await startWorkbench({
      roots: [root],
      stateDirectory: state,
      port: 0,
      adminToken: 'partial-loss-test-admin-token-32',
    });
    const origin = app!.origin;
    await page.goto(`${origin}?view=runs&run=${run.id}`);
    await page.getByLabel('Administrator token').fill('partial-loss-test-admin-token-32');
    await page.getByRole('button', { name: 'Open workbench' }).click();
    const readRun = async () => {
      const response = await page.request.get(`${origin}/api/runs/${run.id}`);
      expect(response.status()).toBe(200);
      return (await response.json()) as Run;
    };
    await expect
      .poll(async () => (await readRun()).result?.outcome, { timeout: 60_000 })
      .toBe('blocked');
    const result = (await readRun()).result!;
    await proof.audit(
      '01-partial-loss',
      'A failed environment timeline write retains every completed capture and classifies the loss',
      [
        {
          id: 'healthy-captures-retained',
          passed: (result.captures ?? []).length === 2,
          values: { expected: 2, actual: (result.captures ?? []).length },
        },
        {
          id: 'loss-classified',
          passed: (result.findings ?? []).some(
            (finding) =>
              finding.kind === 'timeline-write-failed' &&
              finding.failurePhase === 'evidence-write' &&
              finding.environment?.browser === 'firefox',
          ),
          values: { findings: (result.findings ?? []).length },
        },
      ],
    );
    // Both environments completed their healthy '/' capture before the fault.
    expect(result.captures ?? []).toHaveLength(2);
    for (const expectedBrowser of ['chromium', 'firefox'])
      expect(
        (result.captures ?? []).filter(
          (capture) => capture.environment?.browser === expectedBrowser,
        ),
      ).toHaveLength(1);
    // The loss is attributed, not collapsed into an unattributed refusal.
    expect(
      result.findings?.some(
        (finding) =>
          finding.kind === 'timeline-write-failed' &&
          finding.failurePhase === 'evidence-write' &&
          finding.environment?.browser === 'firefox',
      ),
    ).toBe(true);
    const cells = result.visualEnvironments ?? [];
    expect(cells).toHaveLength(2);
    const chromiumCell = cells.find((cell) => cell.browser === 'chromium');
    const firefoxCell = cells.find((cell) => cell.browser === 'firefox');
    expect(chromiumCell?.outcome).toBe('observed');
    expect(chromiumCell?.captures).toBe(1);
    expect(firefoxCell?.outcome).toBe('blocked');
    expect(firefoxCell?.captures).toBe(1);
    expect(firefoxCell?.reason).toContain('timeline');
    expect(errors.hard()).toEqual([]);
  } finally {
    await proof.finish();
    await browser.close();
    await app?.close();
    await stopApp(target.child);
    await rm(target.runtimeDirectory, { recursive: true, force: true });
    await rm(state, { recursive: true, force: true });
    if (evidence) await mkdir(evidence, { recursive: true });
  }
}, 120_000);
