import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { StagedBundle } from '@arxic/contracts';
import {
  ARXIC_PROBE_INSENSITIVE_ASSERTION,
  PlaywrightCompiler,
  generateFixture,
  transitionReceiptRuntimeSource,
} from '@arxic/playwright-compiler';
import { serializeScreenshotPrivacyPolicy } from '@arxic/playwright-screenshot-privacy';
import { inspectPlaywrightTrace } from '@arxic/playwright-trace-sanitizer';
import { chromium } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  FIXTURE_APPS,
  bootFixtureApp,
  freePort,
  loginObservations,
  loginWorkflow,
  referenceAuthApp,
  seedFixture,
  stopApp,
  type RunningApp,
  type FixtureApp,
} from '@arxic/real-world-testkit';
import {
  classifyVerification,
  createSensitivityProbeAdapter,
  ensurePlaywrightModule,
  PlaywrightVerifier,
  resetAndSeedFixtures,
} from './index';
import { resolvePlaywrightCli, runPlaywrightSuite } from './runner';

const root = fileURLToPath(new URL('../../../', import.meta.url));
let fixtureAppLease = Promise.resolve();

async function leaseFixtureApp(app: FixtureApp, prefix: string) {
  const previous = fixtureAppLease;
  let release!: () => void;
  fixtureAppLease = new Promise<void>((resolveLease) => {
    release = resolveLease;
  });
  await previous;
  try {
    return { running: await bootFixtureApp(root, app, prefix), release };
  } catch (error) {
    release();
    throw error;
  }
}

describe.sequential('playwright verifier real-world security proof', () => {
  describe.each(FIXTURE_APPS)('playwright verifier real-world proof: $name', (app) => {
    let running: RunningApp | undefined;
    let releaseFixture: (() => void) | undefined;
    let outputDirectory = '';
    let artifactsDirectory = '';

    beforeAll(async () => {
      const leased = await leaseFixtureApp(app, `arxic-verifier-${app.name}`);
      running = leased.running;
      releaseFixture = leased.release;
      outputDirectory = await mkdtemp(join(tmpdir(), 'arxic-verifier-output-'));
      artifactsDirectory = await mkdtemp(join(tmpdir(), 'arxic-verifier-artifacts-'));
      await seedFixture(running.origin, `verifier-${app.name}`, app.persona);
    }, 240_000);

    afterAll(async () => {
      try {
        await stopApp(running?.child);
        await Promise.all(
          [running?.runtimeDirectory, outputDirectory, artifactsDirectory]
            .filter((path): path is string => Boolean(path))
            .map((path) => rm(path, { recursive: true, force: true })),
        );
      } finally {
        releaseFixture?.();
      }
    });

    test('verifies two clean real Chromium passes', async () => {
      if (!running) throw new Error(`Fixture app ${app.name} did not start`);
      const workflow = loginWorkflow(app, {
        id: `authentication.login.verifier.${app.name}`,
        title: `Login verifier proof ${app.name}`,
        dualEvidence: true,
      });
      const bundle = await new PlaywrightCompiler({
        outputDirectory,
        origin: running.origin,
      }).compile(
        workflow,
        loginObservations(app, running.origin, `real-world-verifier-${app.name}`),
      );
      const verifier = new PlaywrightVerifier({
        outputDirectory,
        origin: running.origin,
        artifactsDir: artifactsDirectory,
        persona: app.persona,
        screenshotPrivacyPolicy: screenshotPolicy(app.name),
      });
      const policy = {
        requiredRuns: 2,
        forbidNetworkErrors: true,
        screenshotCheckpoints: [app.login.toState],
        trace: 'retain' as const,
      };

      const result = await verifier.verify(bundle, policy);

      expect(result.outcome, JSON.stringify(result.diagnostics)).toBe('verified');
      expect(result.runs).toEqual([{ passed: true }, { passed: true }]);
      expect(result.artifacts.map(({ kind }) => kind)).toEqual(
        expect.arrayContaining(['screenshot', 'trace', 'trace-sanitization-report']),
      );
      for (const artifact of result.artifacts) {
        const digest = createHash('sha256')
          .update(await readFile(artifact.path))
          .digest('hex');
        expect(digest).toBe(artifact.sha256);
      }
      const traces = result.artifacts.filter(({ kind }) => kind === 'trace');
      expect(traces).toHaveLength(2);
      for (const trace of traces) {
        await expect(
          inspectPlaywrightTrace({
            tracePath: trace.path,
            provenancePath: `${trace.path}.sanitization.json`,
            forbiddenSubstrings: Object.values(app.persona),
          }),
        ).resolves.toMatchObject({ ok: true });
      }
      const retainedEvidence = process.env.ARXIC_TRACE_SANITIZATION_EVIDENCE_DIR;
      if (retainedEvidence) {
        await mkdir(retainedEvidence, { recursive: true });
        const retainedTrace = join(retainedEvidence, `${app.name}-sanitized.trace.zip`);
        await Promise.all([
          copyFile(traces[0]!.path, retainedTrace),
          copyFile(`${traces[0]!.path}.sanitization.json`, `${retainedTrace}.sanitization.json`),
        ]);
        await captureMaskedLoginEvidence(
          app,
          running.origin,
          join(retainedEvidence, `${app.name}-verified-login.masked.png`),
        );
      }
      await assertTraceViewerLoads(
        traces[0]!.path,
        retainedEvidence
          ? join(retainedEvidence, `${app.name}-sanitized-trace-viewer.png`)
          : join(artifactsDirectory, `${app.name}-sanitized-trace-viewer.png`),
      );
    }, 240_000);

    test('records real Chromium HTTP and console errors and applies the default network gate', async () => {
      if (!running) throw new Error(`Fixture app ${app.name} did not start`);
      const nonce = `receipt-event-${app.name}`;
      const receiptPath = join(outputDirectory, 'artifacts', 'arxic-transition-receipts.json');
      await Promise.all([
        mkdir(join(outputDirectory, 'tests'), { recursive: true }),
        mkdir(join(outputDirectory, 'fixtures'), { recursive: true }),
      ]);
      await Promise.all([
        writeFile(
          join(outputDirectory, 'fixtures/workflow.fixture.ts'),
          generateFixture(
            loginWorkflow(app, {
              id: `receipt-event-gate.${app.name}`,
              title: `Receipt event gate ${app.name}`,
            }),
          ),
        ),
        writeFile(
          join(outputDirectory, 'fixtures/transition-receipts.ts'),
          transitionReceiptRuntimeSource(),
        ),
        writeFile(
          join(outputDirectory, 'playwright.config.ts'),
          "import { defineConfig } from '@playwright/test';\nexport default defineConfig({ testDir: './tests', workers: 1, use: { browserName: 'chromium', headless: true } });\n",
        ),
        writeFile(
          join(outputDirectory, 'tests/workflow.spec.ts'),
          [
            "import { test, expect, configureApprovedOrigins } from '../fixtures/workflow.fixture';",
            'import {',
            '  armReceiptCapture,',
            '  recordTransitionReceipt,',
            '  withReceiptAttribution,',
            "} from '../fixtures/transition-receipts';",
            `configureApprovedOrigins([${JSON.stringify(new URL(running.origin).origin)}]);`,
            "test('receipt event gate', async ({ page }) => {",
            '  armReceiptCapture(page);',
            // workflow-caused document 404: the goto's OWN document request gates
            `  const response = await withReceiptAttribution(page, 'navigate', () => page.goto(${JSON.stringify(`${running.origin}/__arxic-receipt-missing__`)}));`,
            '  await expect(response).not.toBeNull();',
            // workflow-caused console error: raised INSIDE an action window gates
            "  await withReceiptAttribution(page, 'action', () =>",
            "    page.evaluate(() => console.error('arxic receipt console proof')));",
            "  recordTransitionReceipt(page, 'login-page->home', 'login-page → home');",
            '});',
            '',
          ].join('\n'),
        ),
      ]);
      await ensurePlaywrightModule(outputDirectory);

      const pass = await runPlaywrightSuite({
        testDirectory: outputDirectory,
        transitionReceipts: {
          path: receiptPath,
          nonce,
          testTitle: 'receipt event gate',
          transitions: [{ id: 'login-page->home', stepName: 'login-page → home' }],
        },
      });

      expect(pass.passed, pass.output).toBe(true);
      expect(pass.observedTransitions).toEqual(['login-page->home']);
      expect(pass.networkErrors).toEqual(
        expect.arrayContaining([expect.stringContaining('http-response 404'), 'console-error']),
      );
      expect(
        classifyVerification({
          subject: `receipt-event-gate.${app.name}`,
          runs: [{ passed: pass.passed }],
          policy: { requiredRuns: 1 } as ReturnType<typeof loginWorkflow>['verification'],
          networkErrors: pass.networkErrors,
        }).outcome,
      ).toBe('blocked');
    }, 120_000);

    // #307 (F-E6/F-E8) complement: an app-autonomous boot probe (4xx fired
    // DURING the armed page load — the directus /auth/refresh shape measured
    // in round 6) is NOT workflow-caused and must not produce network errors
    // — the receipt stays clean even though it occurs after arming.
    test('#307/F-E8 app-autonomous boot probes during the armed page load do not gate', async () => {
      if (!running) throw new Error(`Fixture app ${app.name} did not start`);
      const nonce = `boot-probe-${app.name}`;
      const receiptPath = join(outputDirectory, 'artifacts', 'arxic-transition-receipts.json');
      await Promise.all([
        mkdir(join(outputDirectory, 'tests'), { recursive: true }),
        mkdir(join(outputDirectory, 'fixtures'), { recursive: true }),
      ]);
      await Promise.all([
        writeFile(
          join(outputDirectory, 'fixtures/workflow.fixture.ts'),
          generateFixture(
            loginWorkflow(app, {
              id: `boot-probe-gate.${app.name}`,
              title: `Boot probe gate ${app.name}`,
            }),
          ),
        ),
        writeFile(
          join(outputDirectory, 'fixtures/transition-receipts.ts'),
          transitionReceiptRuntimeSource(),
        ),
      ]);
      await writeFile(
        join(outputDirectory, 'tests/workflow.spec.ts'),
        [
          "import { test, expect, configureApprovedOrigins } from '../fixtures/workflow.fixture';",
          'import {',
          '  armReceiptCapture,',
          '  recordTransitionReceipt,',
          '  withReceiptAttribution,',
          "} from '../fixtures/transition-receipts';",
          `configureApprovedOrigins([${JSON.stringify(new URL(running.origin).origin)}]);`,
          "test('boot probe attribution', async ({ page }) => {",
          // autonomous probe FIRST (unarmed): a 404 fetch + console error
          `  await page.goto(${JSON.stringify(running.origin)});`,
          '  await page.evaluate(() => {',
          `    const probe = document.createElement('script');`,
          `    probe.src = '/__arxic-boot-probe__';`,
          '    document.head.appendChild(probe);',
          '  });',
          '  await page.waitForTimeout(250);',
          "  await page.evaluate(() => console.error('arxic boot probe console proof'));",
          // NOW the workflow arms and runs clean
          // F-E8 shape: the app's boot probe fires DURING the armed page
          // load (a parser-blocking 404 subresource of the goto's document).
          // Under the contradicted time-window rule this gated; per-request
          // attribution must keep the receipt clean.
          "  await page.route('**/boot', async (route) => {",
          "    await route.fulfill({ contentType: 'text/html', body: '<html><body><script src=\"/__arxic-boot-probe__\"></script>boot</body></html>' });",
          '  });',
          '  armReceiptCapture(page);',
          `  const response = await withReceiptAttribution(page, 'navigate', () => page.goto(${JSON.stringify(`${running.origin}/boot`)}));`,
          '  await expect(response).not.toBeNull();',
          '  await page.waitForTimeout(250);',
          // a clean workflow action AFTER the boot probe — still no gating
          "  await withReceiptAttribution(page, 'action', () => page.evaluate(() => 42));",
          "  recordTransitionReceipt(page, 'login-page->home', 'login-page → home');",
          '});',
          '',
        ].join('\n'),
        'utf8',
      );
      const pass = await runPlaywrightSuite({
        testDirectory: outputDirectory,
        transitionReceipts: {
          path: receiptPath,
          nonce,
          testTitle: 'boot probe attribution',
          transitions: [{ id: 'login-page->home', stepName: 'login-page → home' }],
        },
      });
      expect(pass.passed, pass.output).toBe(true);
      expect(pass.networkErrors).toEqual([]);
    }, 120_000);
  });

  async function assertTraceViewerLoads(tracePath: string, screenshotPath: string): Promise<void> {
    const port = await freePort();
    const viewer = spawn(
      process.execPath,
      [
        resolvePlaywrightCli(),
        'show-trace',
        '--host',
        '127.0.0.1',
        '--port',
        String(port),
        tracePath,
      ],
      {
        cwd: root,
        env: { ...process.env, PWTEST_UNDER_TEST: '1' },
        stdio: 'ignore',
      },
    );
    let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
    try {
      const url = `http://127.0.0.1:${port}`;
      let ready = false;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if (viewer.exitCode !== null) throw new Error('Pinned Trace Viewer exited before loading');
        try {
          const response = await fetch(url, { redirect: 'manual' });
          if (response.status === 200 || response.status === 302) {
            ready = true;
            break;
          }
        } catch {
          // Server has not bound its ephemeral test port yet.
        }
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
      }
      if (!ready) throw new Error('Pinned Trace Viewer did not become ready');
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      let pageErrors = 0;
      page.on('pageerror', () => {
        pageErrors += 1;
      });
      await page.goto(url);
      await page.locator('.action-title').first().waitFor({ state: 'visible', timeout: 30_000 });
      expect(await page.locator('.processing-error').count()).toBe(0);
      expect(pageErrors).toBe(0);
      await mkdir(join(screenshotPath, '..'), { recursive: true });
      await page.screenshot({ path: screenshotPath, fullPage: true });
      expect((await readFile(screenshotPath)).byteLength).toBeGreaterThan(0);
    } finally {
      await browser?.close();
      await stopApp(viewer);
    }
  }

  async function captureMaskedLoginEvidence(
    app: FixtureApp,
    origin: string,
    screenshotPath: string,
  ): Promise<void> {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(`${origin}${app.login.loginRoute}`);
      await page.getByLabel('Email').first().fill(app.persona.email);
      await page.getByLabel('Password').first().fill(app.persona.password);
      await page
        .getByRole('button', { name: /^Login$/iu })
        .first()
        .click();
      if (app.login.assertion.startsWith('url:')) {
        await page.waitForURL(new URL(app.login.assertion.slice(4), origin).href);
      } else if (app.login.assertion.startsWith('text:')) {
        await page
          .getByText(app.login.assertion.slice(5), { exact: false })
          .first()
          .waitFor({ state: 'visible' });
      }
      await page.screenshot({
        path: screenshotPath,
        fullPage: true,
        mask: [page.locator('input'), page.getByText(app.persona.email, { exact: false })],
        maskColor: '#000000',
      });
      const bytes = await readFile(screenshotPath);
      await writeFile(
        `${screenshotPath}.provenance.json`,
        `${JSON.stringify(
          {
            schemaVersion: 1,
            capture: 'live-playwright-screenshot',
            app: app.name,
            assertion: app.login.assertion,
            screenshotSha256: createHash('sha256').update(bytes).digest('hex'),
            masks: ['all input elements', 'rendered synthetic persona email text'],
            maskColor: '#000000',
            postProcessing: false,
          },
          null,
          2,
        )}\n`,
        'utf8',
      );
    } finally {
      await browser.close();
    }
  }

  test('loads the migrated retained M1-15 trace through the pinned Trace Viewer', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'arxic-migrated-trace-viewer-'));
    const trace = join(root, 'docs/evidence/M1-15/exploration-trace.zip');
    try {
      const inspected = await inspectPlaywrightTrace({
        tracePath: trace,
        provenancePath: `${trace}.sanitization.json`,
      });
      expect(inspected.ok, JSON.stringify(inspected)).toBe(true);
      if (!inspected.ok) return;
      expect(inspected.provenance.logicalMembers).toEqual(['trace-001.trace']);
      await assertTraceViewerLoads(trace, join(directory, 'migrated-m1-15-trace-viewer.png'));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 120_000);

  test('independently inspects every retained documentation ZIP', async () => {
    const evidenceRoot = join(root, 'docs/evidence');
    const archives = await inspectRetainedArchives(evidenceRoot);
    expect(archives.length).toBeGreaterThan(0);
    for (const { tracePath, inspected } of archives) {
      expect(inspected.ok, `${tracePath} failed current trace inspection`).toBe(true);
      if (!inspected.ok) continue;
      expect(inspected.provenance.logicalMembers).not.toHaveLength(0);
      expect(
        inspected.provenance.logicalMembers.every((name) => /^trace-\d{3}\.trace$/u.test(name)),
      ).toBe(true);
    }
  });

  test('resolves promoted-bundle provenance from the sibling reports directory', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'arxic-bundle-trace-inventory-'));
    try {
      await mkdir(join(directory, 'artifacts', 'traces'), { recursive: true });
      await mkdir(join(directory, 'artifacts', 'reports'), { recursive: true });
      // The bundle layout: sanitized trace under artifacts/traces, provenance
      // under artifacts/reports (bundle-assembler.ts) — no adjacent copy.
      await copyFile(
        join(root, 'docs/evidence/M1-15/exploration-trace.zip'),
        join(directory, 'artifacts', 'traces', '001-trace.zip'),
      );
      await copyFile(
        join(root, 'docs/evidence/M1-15/exploration-trace.zip.sanitization.json'),
        join(directory, 'artifacts', 'reports', '001-trace.zip.sanitization.json'),
      );
      const archives = await inspectRetainedArchives(directory);
      expect(archives).toHaveLength(1);
      expect(archives[0]?.tracePath).toBe(join(directory, 'artifacts', 'traces', '001-trace.zip'));
      expect(archives[0]?.inspected.ok, 'bundle-layout provenance must resolve').toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test('a bundle-layout trace with no reports provenance still fails closed', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'arxic-bundle-trace-missing-'));
    try {
      await mkdir(join(directory, 'artifacts', 'traces'), { recursive: true });
      await copyFile(
        join(root, 'docs/evidence/M1-15/exploration-trace.zip'),
        join(directory, 'artifacts', 'traces', '001-trace.zip'),
      );
      const archives = await inspectRetainedArchives(directory);
      expect(archives).toHaveLength(1);
      expect(archives[0]?.inspected).toMatchObject({ ok: false, code: 'TRACE_PROVENANCE_INVALID' });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test('does not let a neutral archive filename evade retained-evidence inspection', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'arxic-neutral-trace-inventory-'));
    try {
      await copyFile(
        join(root, 'docs/evidence/M1-15/exploration-trace.zip'),
        join(directory, 'capture.zip'),
      );
      const archives = await inspectRetainedArchives(directory);
      expect(archives).toHaveLength(1);
      expect(archives[0]?.tracePath).toBe(join(directory, 'capture.zip'));
      expect(archives[0]?.inspected).toMatchObject({
        ok: false,
        code: 'TRACE_PROVENANCE_INVALID',
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  describe('playwright verifier locator-drift proof', () => {
    let running: RunningApp | undefined;
    let releaseFixture: (() => void) | undefined;
    let outputDirectory = '';
    let artifactsDirectory = '';

    beforeAll(async () => {
      const leased = await leaseFixtureApp(referenceAuthApp, 'arxic-verifier-locator-drift');
      running = leased.running;
      releaseFixture = leased.release;
      outputDirectory = await mkdtemp(join(tmpdir(), 'arxic-verifier-output-'));
      artifactsDirectory = await mkdtemp(join(tmpdir(), 'arxic-verifier-artifacts-'));
      await seedFixture(running.origin, 'verifier-locator-drift', referenceAuthApp.persona);
    }, 240_000);

    afterAll(async () => {
      try {
        await stopApp(running?.child);
        await Promise.all(
          [running?.runtimeDirectory, outputDirectory, artifactsDirectory]
            .filter((path): path is string => Boolean(path))
            .map((path) => rm(path, { recursive: true, force: true })),
        );
      } finally {
        releaseFixture?.();
      }
    });

    test('blocks a staged spec drift before execution', async () => {
      if (!running) throw new Error('Reference fixture app did not start');
      const workflow = loginWorkflow(referenceAuthApp, {
        id: 'authentication.login.verifier',
        title: 'Login verifier proof',
        dualEvidence: true,
      });
      const bundle = await new PlaywrightCompiler({
        outputDirectory,
        origin: running.origin,
      }).compile(
        workflow,
        loginObservations(referenceAuthApp, running.origin, 'real-world-verifier-locator-drift'),
      );
      const verifier = new PlaywrightVerifier({
        outputDirectory,
        origin: running.origin,
        artifactsDir: artifactsDirectory,
        persona: referenceAuthApp.persona,
        screenshotPrivacyPolicy: screenshotPolicy(referenceAuthApp.name),
      });
      const policy = {
        requiredRuns: 2,
        forbidNetworkErrors: true,
        screenshotCheckpoints: [referenceAuthApp.login.toState],
        trace: 'retain' as const,
      };

      const clean = await verifier.verify(bundle, policy);
      expect(clean.outcome, JSON.stringify(clean.diagnostics)).toBe('verified');

      const specArtifact = bundle.artifacts.find(({ kind }) => kind === 'playwright-spec');
      if (!specArtifact) throw new Error('Compiled real-world bundle has no spec');
      const specPath = join(outputDirectory, specArtifact.path);
      // #312: fields bind through the label-first placeholder-fallback helper
      const driftedSpec = (await readFile(specPath, 'utf8')).replace(
        'labelOrPlaceholderControl(form, "Email")',
        "labelOrPlaceholderControl(form, 'Nonexistent')",
      );
      expect(driftedSpec).toContain("labelOrPlaceholderControl(form, 'Nonexistent')");
      await writeFile(specPath, driftedSpec);
      const driftedBundle: StagedBundle = {
        ...bundle,
        artifacts: bundle.artifacts.map((artifact) =>
          artifact.path === specArtifact.path
            ? {
                ...artifact,
                sha256: createHash('sha256').update(driftedSpec).digest('hex'),
              }
            : artifact,
        ),
      };

      const drifted = await verifier.verify(driftedBundle, policy);

      expect(drifted.outcome).not.toBe('verified');
      expect(drifted.outcome).toBe('blocked');
    }, 240_000);
  });

  describe('sensitivity probe adapter real-world proof', () => {
    let running: RunningApp | undefined;
    let releaseFixture: (() => void) | undefined;
    let probeParent = '';

    beforeAll(async () => {
      const leased = await leaseFixtureApp(
        referenceAuthApp,
        'arxic-verifier-sensitivity-reference',
      );
      running = leased.running;
      releaseFixture = leased.release;
      probeParent = await mkdtemp(join(tmpdir(), 'arxic-sensitivity-parent-'));
    }, 240_000);

    afterAll(async () => {
      try {
        await stopApp(running?.child);
        await Promise.all(
          [running?.runtimeDirectory, probeParent]
            .filter((path): path is string => Boolean(path))
            .map((path) => rm(path, { recursive: true, force: true })),
        );
      } finally {
        releaseFixture?.();
      }
    });

    test('proves control, kill, and exact-text sensitivity through the real adapter and Chromium', async () => {
      if (!running) throw new Error('Reference auth app did not start');
      const genuineWorkflow = loginWorkflow(referenceAuthApp, {
        id: 'authentication.login.sensitivity.reference',
        title: 'Login sensitivity proof',
      });
      const genuine = await createSensitivityProbeAdapter({
        parentDirectory: probeParent,
        env: {
          ARXIC_INPUT_PERSONA_EMAIL: referenceAuthApp.persona.email,
          ARXIC_INPUT_PERSONA_PASSWORD: referenceAuthApp.persona.password,
        },
        resetAndSeed: async () => resetAndSeedFixtures(running!.origin, referenceAuthApp.persona),
      })({
        workflow: genuineWorkflow,
        origin: running.origin,
        runtimeUrl: `${running.origin}${referenceAuthApp.login.loginRoute}`,
      });

      const insensitivePersona = {
        email: '__arxic-probe-never-match__@example.test',
        password: 'InsensitiveProbe9!',
      };
      const insensitiveWorkflow = loginWorkflow(referenceAuthApp, {
        id: 'authentication.login.sensitivity.insensitive',
        title: 'Insensitive login assertion proof',
      });
      // Pre-#366 this arm asserted bare `text:Logged in`, which only ever
      // passed as a SUBSTRING of the home page's "Logged in as <email>" —
      // and the seeded persona email even made the probe's never-match
      // mutation marker survive, demonstrating the INSENSITIVE diagnostic
      // end to end. #366's exact-match emission removes substring semantics
      // by design, so that weak-assertion class can no longer pass at all
      // (the control fails instead). The arm now proves the hardened text
      // emission end to end: the FULL observed sentence passes the control
      // and both probe operators are killed through real Chromium. The
      // value-substitution INSENSITIVE diagnostic path stays covered by the
      // sensitivity-probe unit suite (scripted surviving runs) and the
      // control-state tautology proof below (omission operator).
      insensitiveWorkflow.transitions[0]!.assertions[0]!.intent = `text:Logged in as ${insensitivePersona.email}`;
      const insensitive = await createSensitivityProbeAdapter({
        parentDirectory: probeParent,
        env: {
          ARXIC_INPUT_PERSONA_EMAIL: insensitivePersona.email,
          ARXIC_INPUT_PERSONA_PASSWORD: insensitivePersona.password,
        },
        resetAndSeed: async () => resetAndSeedFixtures(running!.origin, insensitivePersona),
      })({
        workflow: insensitiveWorkflow,
        origin: running.origin,
        runtimeUrl: `${running.origin}${referenceAuthApp.login.loginRoute}`,
      });

      expect(genuine).toEqual({
        killed: true,
        probed: 2,
        controlPassed: true,
        diagnostics: [],
      });
      expect(insensitive).toEqual({
        killed: true,
        probed: 2,
        controlPassed: true,
        diagnostics: [],
      });
      expect(await readdir(probeParent)).toEqual([]);
      console.info(
        `Sensitivity adapter proof: ${JSON.stringify({ controlPassed: genuine.controlPassed, mutationPassed: !genuine.killed, killed: genuine.killed, exactTextKilled: insensitive.killed, exactTextDiagnostics: insensitive.diagnostics.length })}`,
      );
    }, 240_000);

    test('blocks a real value-tautology that survives the isolated control state', async () => {
      if (!running) throw new Error('Reference auth app did not start');
      const tautologyPersona = {
        email: 'email-tautology@example.test',
        password: 'TautologyProbe9!',
      };
      const tautologyWorkflow = loginWorkflow(referenceAuthApp, {
        id: 'authentication.login.sensitivity.value-tautology',
        title: 'Login value-tautology proof',
      });
      // app/login/page.tsx:17 renders the visible Email label unconditionally on /login.
      tautologyWorkflow.transitions[0]!.assertions[0]!.intent = 'text:Email';

      const result = await createSensitivityProbeAdapter({
        parentDirectory: probeParent,
        env: {
          ARXIC_INPUT_PERSONA_EMAIL: tautologyPersona.email,
          ARXIC_INPUT_PERSONA_PASSWORD: tautologyPersona.password,
        },
        resetAndSeed: async () => resetAndSeedFixtures(running!.origin, tautologyPersona),
      })({
        workflow: tautologyWorkflow,
        origin: running.origin,
        runtimeUrl: `${running.origin}${referenceAuthApp.login.loginRoute}`,
      });

      expect(result).toEqual({
        killed: false,
        probed: 2,
        controlPassed: true,
        diagnostics: [
          {
            code: ARXIC_PROBE_INSENSITIVE_ASSERTION,
            severity: 'blocked',
            subject: tautologyWorkflow.id,
            message:
              'Assertion "text:Email" remained passing when the transition action was omitted (control-state tautology)',
          },
        ],
      });
      expect(result.diagnostics[0]?.message).not.toContain('value mutation');
      expect(await readdir(probeParent)).toEqual([]);
      console.info(
        `Sensitivity value-tautology proof: ${JSON.stringify({ assertion: 'text:Email', controlPassed: result.controlPassed, valueMutationKilled: result.diagnostics.every(({ message }) => !message.includes('value mutation')), omissionMutationSurvived: result.diagnostics.some(({ message }) => message.includes('transition action was omitted')), killed: result.killed, chromium: true })}`,
      );
    }, 240_000);
  });
});

function screenshotPolicy(appName: string) {
  const heading = appName === 'reference-auth-app' ? 'Reference Auth App' : 'Vulnerable Auth App';
  return serializeScreenshotPrivacyPolicy({
    schemaVersion: 1,
    id: `verifier-${appName}-home-heading`,
    authority: {
      kind: 'repository-policy',
      reference: 'docs/evidence/M1-SCREENSHOT-PRIVACY/README.md',
      recordedAt: '2026-08-09T12:00:00.000Z',
    },
    capture: {
      mode: 'approved-region',
      region: { kind: 'role', role: 'heading', name: heading, exact: true },
      masks: [],
    },
  }).policy;
}

async function filesUnder(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? filesUnder(path) : Promise.resolve([path]);
    }),
  );
  return paths.flat();
}

async function inspectRetainedArchives(directory: string) {
  const tracePaths = (await filesUnder(directory)).filter((path) => path.endsWith('.zip')).sort();
  return Promise.all(
    tracePaths.map(async (tracePath) => ({
      tracePath,
      inspected: await inspectPlaywrightTrace({
        tracePath,
        provenancePath: await retainedProvenancePath(tracePath),
      }),
    })),
  );
}

/**
 * Resolve a retained trace's sanitization provenance the way the product
 * records it. Verification-suite captures keep provenance ADJACENT
 * (`<trace>.sanitization.json`); promoted bundles pair the sanitized trace in
 * `artifacts/traces/<name>` with its provenance in the sibling
 * `artifacts/reports/<name>.sanitization.json` (bundle-assembler.ts;
 * redaction-gate.ts resolves the same pairing). A trace with no resolvable
 * provenance keeps the adjacent path — the inspector then fails exactly as
 * before (fail-closed preserved).
 */
async function retainedProvenancePath(tracePath: string): Promise<string> {
  const adjacent = `${tracePath}.sanitization.json`;
  const parent = dirname(tracePath);
  const grandparent = dirname(parent);
  if (basename(parent) === 'traces' && basename(grandparent) === 'artifacts') {
    const reportsSibling = join(grandparent, 'reports', `${basename(tracePath)}.sanitization.json`);
    if (await realpath(reportsSibling).catch(() => undefined)) return reportsSibling;
  }
  return adjacent;
}
