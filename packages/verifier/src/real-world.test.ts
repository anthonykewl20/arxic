import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { StagedBundle } from '@arxic/contracts';
import { PlaywrightCompiler } from '@arxic/playwright-compiler';
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
import { PlaywrightVerifier } from './index';
import { resolvePlaywrightCli } from './runner';

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

    test('rejects locator drift as contradicted', async () => {
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
      const driftedSpec = (await readFile(specPath, 'utf8')).replace(
        'getByLabel("Email")',
        "getByLabel('Nonexistent')",
      );
      expect(driftedSpec).toContain("getByLabel('Nonexistent')");
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
      expect(drifted.outcome).toBe('contradicted');
    }, 240_000);
  });
});

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
        provenancePath: `${tracePath}.sanitization.json`,
      }),
    })),
  );
}
