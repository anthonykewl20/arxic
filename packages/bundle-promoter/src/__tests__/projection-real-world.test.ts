import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { StagedBundle } from '@arxic/contracts';
import { validateManifest, validateWorkflow } from '@arxic/contracts';
import { PlaywrightCompiler } from '@arxic/playwright-compiler';
import type { ScreenshotPrivacyPolicy } from '@arxic/playwright-screenshot-privacy';
import {
  FIXTURE_APPS,
  bootFixtureApp,
  loginObservations,
  loginWorkflow,
  seedFixture,
  stopApp,
  type RunningApp,
} from '@arxic/real-world-testkit';
import { PlaywrightVerifier } from '@arxic/verifier';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { BundlePromoterAdapter, projectVerifiedBundle } from '..';

const root = fileURLToPath(new URL('../../../../', import.meta.url));

describe.each(FIXTURE_APPS)('real coherent promotion proof: $name', (app) => {
  let running: RunningApp | undefined;
  let stagedDirectory = '';
  let artifactDirectory = '';
  let promotionDirectory = '';

  beforeAll(async () => {
    running = await bootFixtureApp(root, app, `arxic-integrity-${app.name}`);
    stagedDirectory = await mkdtemp(join(tmpdir(), 'arxic-integrity-staged-'));
    artifactDirectory = await mkdtemp(join(tmpdir(), 'arxic-integrity-artifacts-'));
    promotionDirectory = await mkdtemp(join(tmpdir(), 'arxic-integrity-promoted-'));
    await seedFixture(running.origin, `integrity-${app.name}`, app.persona);
  }, 240_000);

  afterAll(async () => {
    await stopApp(running?.child);
    await Promise.all(
      [running?.runtimeDirectory, stagedDirectory, artifactDirectory, promotionDirectory]
        .filter((path): path is string => Boolean(path))
        .map((path) => rm(path, { recursive: true, force: true })),
    );
  });

  test('projects two clean Chromium passes into one coherent public bundle', async () => {
    if (!running) throw new Error(`Fixture app ${app.name} did not start`);
    const workflow = loginWorkflow(app, {
      id: `authentication.login.integrity.${app.name}`,
      title: `Coherent login ${app.name}`,
      dualEvidence: true,
    });
    workflow.verification.trace = 'discard';
    const compiled = await new PlaywrightCompiler({
      outputDirectory: stagedDirectory,
      origin: running.origin,
    }).compile(workflow, loginObservations(app, running.origin, `bundle-integrity-${app.name}`));
    const verification = await new PlaywrightVerifier({
      outputDirectory: stagedDirectory,
      origin: running.origin,
      artifactsDir: artifactDirectory,
      persona: app.persona,
      screenshotPrivacyPolicy: screenshotPolicy(app.name),
    }).verify(compiled, workflow.verification);
    expect(verification.outcome, JSON.stringify(verification.diagnostics)).toBe('verified');
    expect(verification.artifacts.map(({ kind }) => kind)).not.toContain('trace');

    const promotable = structuredClone(compiled);
    promotable.artifacts = promotable.artifacts.map((artifact) => ({
      ...artifact,
      path: isAbsolute(artifact.path) ? artifact.path : join(stagedDirectory, artifact.path),
    }));
    promotable.manifest.fileHashes = promotable.artifacts.map(({ path, sha256 }) => ({
      path,
      sha256,
    }));
    const projection = projectVerifiedBundle(
      promotable,
      { ...verification, gates: [{ gate: 'verify', passed: true }] },
      '2026-08-09T00:00:00.000Z',
    );
    expect(projection.ok).toBe(true);
    if (!projection.ok) throw new Error(projection.reason);
    const publicPath = join(promotionDirectory, `${app.name}.bundle.json`);
    await new BundlePromoterAdapter({ publicPath }).promote(projection.value, [
      { gate: 'delivery', passed: true },
    ]);

    const promoted = JSON.parse(await readFile(publicPath, 'utf8')) as StagedBundle;
    expect(validateWorkflow(promoted.workflow)).toMatchObject({ ok: true });
    expect(validateManifest(promoted.manifest)).toMatchObject({ ok: true });
    expect(promoted.workflow.status).toBe('verified');
    expect(promoted.manifest.workflow).toEqual({
      id: promoted.workflow.id,
      status: promoted.workflow.status,
    });
    expect(promoted.manifest.fileHashes).toEqual(
      promoted.artifacts.map(({ path, sha256 }) => ({ path, sha256 })),
    );
    expect(promoted.artifacts.map(({ kind }) => kind)).not.toContain('trace');
  }, 240_000);
});

function screenshotPolicy(appName: string): ScreenshotPrivacyPolicy {
  return {
    schemaVersion: 1,
    id: `bundle-integrity-${appName}-home-heading`,
    authority: {
      kind: 'repository-policy',
      reference: 'docs/evidence/M1-SCREENSHOT-PRIVACY/README.md',
      recordedAt: '2026-08-09T12:00:00.000Z',
    },
    capture: {
      mode: 'approved-region',
      region: {
        kind: 'role',
        role: 'heading',
        name: appName === 'reference-auth-app' ? 'Reference Auth App' : 'Vulnerable Auth App',
        exact: true,
      },
      masks: [],
    },
  };
}
