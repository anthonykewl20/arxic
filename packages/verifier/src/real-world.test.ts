import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { StagedBundle } from '@arxic/contracts';
import { PlaywrightCompiler } from '@arxic/playwright-compiler';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  FIXTURE_APPS,
  bootFixtureApp,
  loginObservations,
  loginWorkflow,
  referenceAuthApp,
  seedFixture,
  stopApp,
  type RunningApp,
} from '@arxic/real-world-testkit';
import { PlaywrightVerifier } from './index';

const root = fileURLToPath(new URL('../../../', import.meta.url));

describe.each(FIXTURE_APPS)('playwright verifier real-world proof: $name', (app) => {
  let running: RunningApp | undefined;
  let outputDirectory = '';
  let artifactsDirectory = '';

  beforeAll(async () => {
    running = await bootFixtureApp(root, app, `arxic-verifier-${app.name}`);
    outputDirectory = await mkdtemp(join(tmpdir(), 'arxic-verifier-output-'));
    artifactsDirectory = await mkdtemp(join(tmpdir(), 'arxic-verifier-artifacts-'));
    await seedFixture(running.origin, `verifier-${app.name}`, app.persona);
  }, 240_000);

  afterAll(async () => {
    await stopApp(running?.child);
    await Promise.all(
      [running?.runtimeDirectory, outputDirectory, artifactsDirectory]
        .filter((path): path is string => Boolean(path))
        .map((path) => rm(path, { recursive: true, force: true })),
    );
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
    }).compile(workflow, loginObservations(app, running.origin, `real-world-verifier-${app.name}`));
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
      expect.arrayContaining(['screenshot', 'trace']),
    );
    for (const artifact of result.artifacts) {
      const digest = createHash('sha256')
        .update(await readFile(artifact.path))
        .digest('hex');
      expect(digest).toBe(artifact.sha256);
    }
  }, 240_000);
});

describe('playwright verifier locator-drift proof', () => {
  let running: RunningApp | undefined;
  let outputDirectory = '';
  let artifactsDirectory = '';

  beforeAll(async () => {
    running = await bootFixtureApp(root, referenceAuthApp, 'arxic-verifier-locator-drift');
    outputDirectory = await mkdtemp(join(tmpdir(), 'arxic-verifier-output-'));
    artifactsDirectory = await mkdtemp(join(tmpdir(), 'arxic-verifier-artifacts-'));
    await seedFixture(running.origin, 'verifier-locator-drift', referenceAuthApp.persona);
  }, 240_000);

  afterAll(async () => {
    await stopApp(running?.child);
    await Promise.all(
      [running?.runtimeDirectory, outputDirectory, artifactsDirectory]
        .filter((path): path is string => Boolean(path))
        .map((path) => rm(path, { recursive: true, force: true })),
    );
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
