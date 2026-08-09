import { cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { StagedBundle } from '@arxic/contracts';
import { PlaywrightCompiler } from '@arxic/playwright-compiler';
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
import { ARXIC_PROMOTION_ATOMIC_REPLACE_FAILED, BundlePromoterAdapter, freezeBundle } from '..';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const verificationTimestamp = '2026-08-09T12:00:00.000Z';

describe.each(FIXTURE_APPS)('real-world failed-promotion preservation: $name', (app) => {
  let running: RunningApp | undefined;
  let stagedDirectory = '';
  let artifactDirectory = '';
  let promotionDirectory = '';

  beforeAll(async () => {
    running = await bootFixtureApp(root, app, `arxic-promotion-${app.name}`);
    stagedDirectory = await mkdtemp(join(tmpdir(), 'arxic-promotion-staged-'));
    artifactDirectory = await mkdtemp(join(tmpdir(), 'arxic-promotion-artifacts-'));
    promotionDirectory = await mkdtemp(join(tmpdir(), 'arxic-promotion-public-'));
    await seedFixture(running.origin, `promotion-${app.name}`, app.persona);
  }, 240_000);

  afterAll(async () => {
    await stopApp(running?.child);
    await Promise.all(
      [running?.runtimeDirectory, stagedDirectory, artifactDirectory, promotionDirectory]
        .filter((path): path is string => Boolean(path))
        .map((path) => rm(path, { recursive: true, force: true })),
    );
  });

  test('keeps the verified bundle byte-identical when the subsequent atomic replace is blocked', async () => {
    if (!running) throw new Error(`Fixture app ${app.name} did not start`);
    const compiled = await new PlaywrightCompiler({
      outputDirectory: stagedDirectory,
      origin: running.origin,
    }).compile(
      loginWorkflow(app, {
        id: `authentication.login.promotion.${app.name}`,
        title: `Login promotion proof ${app.name}`,
        dualEvidence: true,
      }),
      loginObservations(app, running.origin, `real-world-promotion-${app.name}`),
    );
    const verification = await new PlaywrightVerifier({
      outputDirectory: stagedDirectory,
      origin: running.origin,
      artifactsDir: artifactDirectory,
      persona: app.persona,
    }).verify(compiled, {
      requiredRuns: 2,
      forbidNetworkErrors: true,
      screenshotCheckpoints: [app.login.toState],
      trace: 'retain',
    });
    expect(verification.outcome, JSON.stringify(verification.diagnostics)).toBe('verified');
    expect(verification.runs).toEqual([{ passed: true }, { passed: true }]);
    expect(verification.artifacts.filter(({ kind }) => kind === 'screenshot')).toHaveLength(2);
    expect(verification.artifacts.filter(({ kind }) => kind === 'trace')).toHaveLength(2);

    const evidenceDirectory = process.env.ARXIC_EVIDENCE_DIR;
    if (evidenceDirectory) {
      await mkdir(evidenceDirectory, { recursive: true });
      await cp(artifactDirectory, join(evidenceDirectory, app.name), { recursive: true });
    }

    const verifiedBundle: StagedBundle = {
      ...compiled,
      workflow: { ...compiled.workflow, status: 'verified' },
      manifest: {
        ...compiled.manifest,
        workflow: { ...compiled.manifest.workflow, status: 'verified' },
        verification: {
          requiredRuns: 2,
          runs: verification.runs.map(({ passed }) => ({
            startedAt: verificationTimestamp,
            finishedAt: verificationTimestamp,
            passed,
          })),
        },
        gateResults: [...compiled.manifest.gateResults, { gate: 'verify', passed: true }],
        coverage: {
          ...compiled.manifest.coverage,
          verified: 1,
          contradicted: 0,
          blocked: 0,
          uncovered: 0,
        },
      },
    };
    expect(verifiedBundle.workflow.id).toBe(`authentication.login.promotion.${app.name}`);
    expect(verifiedBundle.manifest.workflow.id).toBe(verifiedBundle.workflow.id);
    expect(verifiedBundle.workflow.status).toBe('verified');
    expect(verifiedBundle.manifest.workflow.status).toBe(verifiedBundle.workflow.status);
    const publicPath = join(promotionDirectory, `${app.name}.bundle.json`);
    const promoter = new BundlePromoterAdapter({
      publicPath,
      now: () => verificationTimestamp,
    });
    const receipt = await promoter.promote(verifiedBundle, [{ gate: 'verify', passed: true }]);
    const promotedBytes = await readFile(receipt.location);
    expect(promotedBytes).toEqual(freezeBundle(verifiedBundle));

    const subsequentBundle = {
      ...verifiedBundle,
      plan: `${verifiedBundle.plan}\nSubsequent promotion candidate.\n`,
    };
    expect(freezeBundle(subsequentBundle)).not.toEqual(promotedBytes);
    await mkdir(`${publicPath}.lkg`);
    const failed = await promoter.promoteWithDiagnostics(subsequentBundle, [
      { gate: 'verify', passed: true },
    ]);

    expect(failed.receipt).toBeUndefined();
    expect(failed.diagnostics).toEqual([
      expect.objectContaining({
        code: ARXIC_PROMOTION_ATOMIC_REPLACE_FAILED,
        severity: 'blocked',
        subject: publicPath,
      }),
    ]);
    expect(await readFile(publicPath)).toEqual(promotedBytes);
  }, 240_000);
});
