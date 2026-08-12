import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
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
import type { ScreenshotPrivacyPolicy } from '@arxic/playwright-screenshot-privacy';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { assembleBundle, scanBundleForSensitiveData } from '..';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const execFileAsync = promisify(execFile);
let realSbomPromise: Promise<readonly [Buffer, Buffer]> | undefined;

function generateRealSboms(): Promise<readonly [Buffer, Buffer]> {
  realSbomPromise ??= (async () => {
    const directory = await mkdtemp(join(tmpdir(), 'arxic-real-sbom-'));
    const firstPath = join(directory, 'first.cdx.json');
    const secondPath = join(directory, 'second.cdx.json');
    try {
      for (const path of [firstPath, secondPath]) {
        await execFileAsync('pnpm', ['sbom', '--sbom-format', 'cyclonedx', '--out', path], {
          cwd: root,
          maxBuffer: 10 * 1024 * 1024,
        });
      }
      return [await readFile(firstPath), await readFile(secondPath)] as const;
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  })();
  return realSbomPromise;
}

describe.each(FIXTURE_APPS)('real-world bundle assembly proof: $name', (app) => {
  let running: RunningApp | undefined;
  let stagedDirectory = '';
  let artifactDirectory = '';
  let bundleDirectory = '';

  beforeAll(async () => {
    running = await bootFixtureApp(root, app, `arxic-assembly-${app.name}`);
    stagedDirectory = await mkdtemp(join(tmpdir(), 'arxic-assembly-staged-'));
    artifactDirectory = await mkdtemp(join(tmpdir(), 'arxic-assembly-artifacts-'));
    bundleDirectory = await mkdtemp(join(tmpdir(), 'arxic-assembly-bundle-'));
    await seedFixture(running.origin, `assembly-${app.name}`, app.persona);
  }, 240_000);

  afterAll(async () => {
    await stopApp(running?.child);
    await Promise.all(
      [running?.runtimeDirectory, stagedDirectory, artifactDirectory, bundleDirectory]
        .filter((path): path is string => Boolean(path))
        .map((path) => rm(path, { recursive: true, force: true })),
    );
  });

  test('compiles, verifies, assembles, redacts, and independently checks hashes', async () => {
    if (!running) throw new Error(`Fixture app ${app.name} did not start`);
    const bundle = await new PlaywrightCompiler({
      outputDirectory: stagedDirectory,
      origin: running.origin,
    }).compile(
      loginWorkflow(app, {
        id: `authentication.login.bundle.${app.name}`,
        title: `Login bundle proof ${app.name}`,
        dualEvidence: true,
      }),
      loginObservations(app, running.origin, `real-world-bundle-${app.name}`),
    );
    const verification = await new PlaywrightVerifier({
      outputDirectory: stagedDirectory,
      origin: running.origin,
      artifactsDir: artifactDirectory,
      persona: app.persona,
      screenshotPrivacyPolicy: screenshotPolicy(app.name),
    }).verify(bundle, {
      requiredRuns: 2,
      forbidNetworkErrors: true,
      screenshotCheckpoints: [app.login.toState],
      trace: 'retain',
    });
    expect(verification.outcome, JSON.stringify(verification.diagnostics)).toBe('verified');
    const [generatedSbom, independentlyGeneratedSbom] = await generateRealSboms();
    expect(generatedSbom).not.toEqual(independentlyGeneratedSbom);

    const assembly = await assembleBundle({
      bundle,
      stagedDirectory,
      outputDirectory: bundleDirectory,
      sbom: generatedSbom,
      verificationArtifacts: verification.artifacts,
      provenance: {
        repository: 'https://github.com/anthonykewl20/arxic',
        commit: bundle.workflow.scope.commit,
        appBuildDigest: bundle.manifest.appBuildDigest,
        toolVersions: { playwright: '1.62.1' },
      },
      now: () => '2026-08-06T12:00:00.000Z',
    });

    const sbomBytes = await readFile(join(assembly.directory, 'sbom.cdx.json'));
    const parsedSbom = JSON.parse(sbomBytes.toString('utf8'));
    expect(parsedSbom).toMatchObject({ bomFormat: 'CycloneDX' });
    expect(parsedSbom).not.toHaveProperty('serialNumber');
    expect(parsedSbom.metadata).not.toHaveProperty('timestamp');
    expect(assembly.checksumsSha256).toContain(
      `${createHash('sha256').update(sbomBytes).digest('hex')}  sbom.cdx.json\n`,
    );
    expect(await scanBundleForSensitiveData(assembly.directory)).toMatchObject({ passed: true });
    for (const line of assembly.checksumsSha256.trimEnd().split('\n')) {
      const [expected, path] = line.split('  ');
      const actual = createHash('sha256')
        .update(await readFile(join(assembly.directory, path!)))
        .digest('hex');
      expect(actual, path).toBe(expected);
    }
    const provenance = JSON.parse(
      await readFile(join(assembly.directory, 'provenance.json'), 'utf8'),
    );
    expect(provenance).toMatchObject({
      commit: bundle.workflow.scope.commit,
      appBuildDigest: bundle.manifest.appBuildDigest,
      generator: { id: '@arxic/bundle-promoter', version: '0.0.0' },
    });
    const notice = await readFile(join(assembly.directory, 'NOTICE'), 'utf8');
    expect(notice).toContain(`Workflow: ${bundle.workflow.id}`);
    expect(notice).toContain('License: MIT');

    const evidenceDirectory = process.env.ARXIC_SCREENSHOT_EVIDENCE_DIR;
    if (evidenceDirectory) {
      const evidenceRoot = join(root, 'docs', 'evidence', 'M1-SCREENSHOT-PRIVACY');
      if (evidenceDirectory !== evidenceRoot) {
        throw new Error('Screenshot evidence output must equal the bounded repository path');
      }
      await mkdir(evidenceRoot, { recursive: true });
      await cp(join(assembly.directory, 'artifacts', 'screenshots'), join(evidenceRoot, app.name), {
        recursive: true,
        errorOnExist: true,
        force: false,
      });
    }
  }, 240_000);
});

function screenshotPolicy(appName: string): ScreenshotPrivacyPolicy {
  return {
    schemaVersion: 1,
    id: `bundle-${appName}-home-heading`,
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
