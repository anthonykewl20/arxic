import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
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
import { launchDashboardBrowser, resizeDashboard } from './dashboard-browser';
import { dashboardProof } from './dashboard-proof';

it.each(['chromium', 'firefox', 'webkit'] as const)(
  'retains healthy real captures around a failed evidence destination (%s)',
  async (browser) => {
    const root = resolve(import.meta.dirname, '../../../..');
    const target = await bootFixtureApp(root, vulnerableAuthApp, 'write-isolation');
    const state = await mkdtemp(join(tmpdir(), 'capture-write-isolation-'));
    const proxy = createServer(async (_request, response) => {
      try {
        const upstream = await fetch(target.origin);
        response.setHeader('Content-Type', 'text/html');
        response.end(await upstream.text());
      } catch {
        response.writeHead(502).end();
      }
    });
    await new Promise<void>((done) => proxy.listen(0, '127.0.0.1', done));
    const wb = await Workbench.open(state, [root]);
    try {
      const project = await wb.saveProject({
        name: 'Evidence write isolation',
        folder: join(root, 'test-fixtures/vulnerable-auth-app'),
        origin: `http://127.0.0.1:${(proxy.address() as { port: number }).port}`,
        captureConsent: true,
        paths: ['/', '/write-fault', '/after-fault'],
        viewports: [{ width: 800, height: 600 }],
        browsers: [browser],
        colorSchemes: ['light'],
      });
      await wb.idle();
      const run = wb.store.enqueue(project, 'visual')!;
      const directory = join(state, 'runs', run.id);
      // Seed a durable queued job and a real filesystem fault before starting the source/installed server.
      // Unlike chmod, EISDIR reproduces under root and ordinary CI users alike.
      mkdirSync(join(directory, 'checkpoint-2.png'), { recursive: true });
      const evidence =
        process.env.ARXIC_WRITE_ISOLATION_EVIDENCE_DIR ??
        (process.env.ARXIC_WEB_EVIDENCE_DIR
          ? join(process.env.ARXIC_WEB_EVIDENCE_DIR, 'capture-write-isolation')
          : undefined);
      await wb.close();
      const app = await startWorkbench({
        roots: [root],
        stateDirectory: state,
        port: 0,
        adminToken: 'write-isolation-test-administrator',
      });
      const uiBrowser = await launchDashboardBrowser();
      const uiContext = await uiBrowser.newContext({
        viewport: { width: 1440, height: 1000 },
        reducedMotion: 'reduce',
      });
      const page = await uiContext.newPage();
      page.setDefaultTimeout(10_000);
      const proof = dashboardProof(
        page,
        evidence ? join(evidence, browser, 'dashboard') : undefined,
      );
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.name));
      try {
        await page.goto(`${app.origin}?view=runs&run=${run.id}`);
        await page.getByLabel('Administrator token').fill('write-isolation-test-administrator');
        await page.getByRole('button', { name: 'Open workbench' }).click();
        const readRun = async () => {
          const response = await page.request.get(`${app.origin}/api/runs/${run.id}`);
          expect(response.status()).toBe(200);
          return (await response.json()) as Run;
        };
        await expect
          .poll(async () => (await readRun()).result?.outcome, { timeout: 30000 })
          .toBe('blocked');
        const result = (await readRun()).result!;
        const failures = result.findings?.filter((finding) => finding.failurePhase);
        if (evidence) {
          const destination = join(evidence, browser);
          await mkdir(destination, { recursive: true });
          for (const file of [
            'timeline.json',
            'timeline.sanitization.json',
            ...(result.captures ?? []).flatMap((capture) => [
              capture.file,
              `${capture.file}.privacy.json`,
            ]),
          ])
            await cp(join(directory, file), join(destination, file));
          await writeFile(
            join(destination, 'result.json'),
            JSON.stringify(
              {
                sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], {
                  encoding: 'utf8',
                }).trim(),
                dirty: !!execFileSync('git', ['status', '--porcelain'], {
                  encoding: 'utf8',
                }).trim(),
                browser,
                outcome: result.outcome,
                captures: result.captures?.map(({ id, path, file }) => ({ id, path, file })),
                failures,
                rawTraceRetained: false,
              },
              null,
              2,
            ),
          );
        }
        expect(result.outcome).toBe('blocked');
        expect(result.captures?.map((capture) => capture.path)).toEqual(['/', '/after-fault']);
        expect(result.captures?.map((capture) => capture.file)).toEqual([
          'checkpoint-1.png',
          'checkpoint-3.png',
        ]);
        // The retained reason also pins the observed fault class (seeded EISDIR).
        expect(failures).toEqual([
          {
            path: '/write-fault',
            kind: 'capture-blocked-check-target-and-privacy-masks',
            count: 1,
            failurePhase: 'evidence-write',
            reason: expect.stringMatching(/^EISDIR: illegal operation on a directory, open '/),
          },
        ]);
        const timeline = JSON.parse(
          await readFile(join(directory, 'timeline.json'), 'utf8'),
        ) as Array<{ action: string; checkpoint: number }>;
        expect(
          timeline.filter((step) => step.action === 'navigate').map((step) => step.checkpoint),
        ).toEqual([0, 1, 2]);
        expect(
          timeline
            .filter((step) => step.action === 'capture-refused')
            .map((step) => step.checkpoint),
        ).toEqual([1]);

        await page
          .getByText('Evidence could not be saved. Check storage space and write permissions.', {
            exact: true,
          })
          .waitFor();
        expect(await page.locator('.capture').count()).toBe(2);
        for (const width of [1440, 320]) {
          await resizeDashboard(page, { width, height: 1000 });
          await page
            .getByRole('heading', { name: 'Findings and capture diagnostics', exact: true })
            .scrollIntoViewIfNeeded();
          const audit = await proof.audit(
            `01-write-refusal-${width}`,
            'Storage failure remains blocked beside two healthy captured pages',
            [
              {
                id: 'healthy-capture-count',
                passed: (await page.locator('.capture').count()) === 2,
                values: { expected: 2, actual: await page.locator('.capture').count() },
              },
            ],
          );
          expect(audit.violations).toEqual([]);
          expect(audit.overflow).toBe(0);
        }
        // Repair the real filesystem boundary; only a subsequent explicit GUI run recaptures pages.
        await rm(join(directory, 'checkpoint-2.png'), { recursive: true });
        await page.getByRole('button', { name: 'Run again', exact: true }).click();
        // The enqueue POST round-trip can exceed vitest's 1 s poll default under
        // non-sharded load (observed in release-test ubuntu cells, #525).
        await expect
          .poll(() => new URL(page.url()).searchParams.get('run'), { timeout: 30_000 })
          .not.toBe(run.id);
        await expect.poll(() => page.locator('.capture').count(), { timeout: 30000 }).toBe(3);
        const recovered = await proof.audit(
          '02-manual-recovery',
          'A new explicit run captures all three pages after storage repair',
          [
            {
              id: 'recovered-capture-count',
              passed: (await page.locator('.capture').count()) === 3,
              values: { actual: await page.locator('.capture').count(), expected: 3 },
            },
          ],
        );
        expect(recovered.violations).toEqual([]);
        expect(recovered.overflow).toBe(0);
        const originalResponse = await page.request.get(`${app.origin}/api/runs/${run.id}`);
        expect(originalResponse.status()).toBe(200);
        const original = await originalResponse.json();
        expect(original.result.outcome).toBe('blocked');
        expect(original.result.captures.map((capture: { path: string }) => capture.path)).toEqual([
          '/',
          '/after-fault',
        ]);
        expect(
          original.result.findings.filter(
            (finding: { failurePhase?: string }) => finding.failurePhase,
          ),
        ).toEqual(failures);
        expect(errors).toEqual([]);
      } finally {
        await proof.finish();
        await uiBrowser.close();
        await app.close();
      }
    } finally {
      await wb.close();
      proxy.closeAllConnections();
      await new Promise<void>((done) => proxy.close(() => done()));
      await stopApp(target.child);
      await rm(target.runtimeDirectory, { recursive: true, force: true });
      await rm(state, { recursive: true, force: true });
    }
  },
  120_000,
);
