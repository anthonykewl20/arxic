import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateManifest, validateWorkflow, type StagedBundle } from '@arxic/contracts';
import type { ScreenshotPrivacyPolicy } from '@arxic/playwright-screenshot-privacy';
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
import {
  ARXIC_PROMOTION_ATOMIC_REPLACE_FAILED,
  BundlePromoterAdapter,
  freezeBundle,
  projectVerifiedBundle,
  sha256,
} from '..';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const verifiedAt = '2026-08-09T12:00:00.000Z';

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
    const workflow = loginWorkflow(app, {
      id: `authentication.login.promotion.${app.name}`,
      title: `Login promotion proof ${app.name}`,
      dualEvidence: true,
    });
    const compiled = await new PlaywrightCompiler({
      outputDirectory: stagedDirectory,
      origin: running.origin,
    }).compile(
      workflow,
      loginObservations(app, running.origin, `real-world-promotion-${app.name}`),
    );

    const verification = await new PlaywrightVerifier({
      outputDirectory: stagedDirectory,
      origin: running.origin,
      artifactsDir: artifactDirectory,
      persona: app.persona,
      screenshotPrivacyPolicy: screenshotPolicy(app.name),
    }).verify(compiled, workflow.verification);
    expect(verification.outcome, JSON.stringify(verification.diagnostics)).toBe('verified');
    expect(verification.runs).toEqual([{ passed: true }, { passed: true }]);
    expect(
      verification.artifacts.filter((artifact) => artifact.kind === 'screenshot'),
    ).toHaveLength(2);
    expect(
      verification.artifacts.filter((artifact) => artifact.kind === 'screenshot-privacy-report'),
    ).toHaveLength(2);
    expect(verification.artifacts.filter((artifact) => artifact.kind === 'trace')).toHaveLength(2);
    expect(
      verification.artifacts.filter((artifact) => artifact.kind === 'trace-sanitization-report'),
    ).toHaveLength(2);

    const evidenceDirectory = process.env.ARXIC_EVIDENCE_DIR;
    if (evidenceDirectory) {
      await mkdir(evidenceDirectory, { recursive: true });
      await cp(artifactDirectory, join(evidenceDirectory, app.name), { recursive: true });
    }

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
      verifiedAt,
    );
    expect(projection.ok).toBe(true);
    if (!projection.ok) throw new Error(projection.reason);
    const verifiedBundle = projection.value;
    expect(verifiedBundle.workflow.id).toBe(workflow.id);
    expect(verifiedBundle.workflow.status).toBe('verified');
    expect(verifiedBundle.manifest.workflow).toEqual({
      id: verifiedBundle.workflow.id,
      status: 'verified',
    });

    const publicPath = join(promotionDirectory, `${app.name}.bundle.json`);
    const promoter = new BundlePromoterAdapter({ publicPath, now: () => verifiedAt });
    const receipt = await promoter.promote(verifiedBundle, [{ gate: 'delivery', passed: true }]);
    const promotedBytes = await readFile(publicPath);
    expect(receipt.location).toBe(publicPath);
    expect(receipt.promotedAt).toBe(verifiedAt);
    expect(receipt.checksumSha256).toBe(sha256(promotedBytes));
    expect(promotedBytes).toEqual(freezeBundle(verifiedBundle));

    const promoted = JSON.parse(promotedBytes.toString('utf8')) as StagedBundle;
    expect(validateWorkflow(promoted.workflow)).toMatchObject({ ok: true });
    expect(validateManifest(promoted.manifest)).toMatchObject({ ok: true });
    expect(promoted.manifest.workflow).toEqual({ id: promoted.workflow.id, status: 'verified' });

    const subsequentBundle = {
      ...verifiedBundle,
      plan: `${verifiedBundle.plan}\nSubsequent promotion candidate.\n`,
    };
    expect(freezeBundle(subsequentBundle)).not.toEqual(promotedBytes);
    await mkdir(`${publicPath}.lkg`);
    const failed = await promoter.promoteWithDiagnostics(subsequentBundle, [
      { gate: 'delivery', passed: true },
    ]);

    expect(failed.receipt).toBeUndefined();
    expect(failed.diagnostics).toEqual([
      expect.objectContaining({
        code: ARXIC_PROMOTION_ATOMIC_REPLACE_FAILED,
        severity: 'blocked',
        subject: publicPath,
        message: expect.stringContaining(`${publicPath}.lkg`),
      }),
    ]);
    expect((await stat(`${publicPath}.lkg`)).isDirectory()).toBe(true);
    expect(await readFile(publicPath)).toEqual(promotedBytes);
    const finalListing = (await readdir(promotionDirectory)).sort();
    expect(finalListing).toEqual([`${app.name}.bundle.json`, `${app.name}.bundle.json.lkg`]);

    if (evidenceDirectory) {
      await mkdir(join(evidenceDirectory, app.name), { recursive: true });
      await writeFile(
        join(evidenceDirectory, app.name, 'promotion-outcome.json'),
        `${JSON.stringify(
          {
            app: app.name,
            promotedChecksumSha256: receipt.checksumSha256,
            subsequentChecksumSha256: sha256(freezeBundle(subsequentBundle)),
            blockedDiagnostic: failed.diagnostics,
            finalListing,
          },
          null,
          2,
        )}\n`,
      );
    }
  }, 240_000);
});

function screenshotPolicy(appName: string): ScreenshotPrivacyPolicy {
  return {
    schemaVersion: 1,
    id: `bundle-promoter-${appName}-main-mask`,
    authority: {
      kind: 'repository-policy',
      reference: 'docs/evidence/M1-SCREENSHOT-PRIVACY/README.md',
      recordedAt: '2026-08-09T12:00:00.000Z',
    },
    capture: {
      mode: 'masked-page',
      fullPage: true,
      masks: [{ kind: 'role', role: 'main', exact: true }],
    },
  };
}
