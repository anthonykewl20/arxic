import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ArtifactRef, StagedBundle, Workflow } from '@arxic/contracts';
import { validateDiagnostic } from '@arxic/contracts';
import { afterEach, describe, expect, test } from 'vitest';
import {
  ARXIC_VERIFY_APP_DEFECT,
  ARXIC_VERIFY_ARTIFACT_HASH_MISMATCH,
  ARXIC_VERIFY_ARTIFACT_MISSING,
  ARXIC_VERIFY_BLOCKED_FIXTURE,
  ARXIC_VERIFY_BLOCKED_NETWORK,
  ARXIC_VERIFY_DIAGNOSTIC_CODES,
  ARXIC_VERIFY_FLAKY_RUNS,
  ARXIC_VERIFY_SUITE_UNAVAILABLE,
  ARXIC_VERIFY_TRANSITIONS_MISSING,
  PlaywrightVerifier,
} from './index';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe('PlaywrightVerifier', () => {
  test('maps a passing and failing split to contradicted rather than verified', async () => {
    const fixture = await stagedFixture();
    const verifier = verifierFor(fixture, {
      runSuite: async (run) => ({
        passed: run === 1,
        output: '',
        exitCode: run === 1 ? 0 : 1,
        networkErrors: [],
      }),
    });

    const result = await verifier.verify(fixture.bundle, policy(2));

    expect(result.outcome).toBe('contradicted');
    expect(result.runs).toEqual([{ passed: true }, { passed: false }]);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: ARXIC_VERIFY_FLAKY_RUNS })]),
    );
  });

  test('maps every failing runtime run to contradicted as an app defect', async () => {
    const fixture = await stagedFixture();
    const verifier = verifierFor(fixture, {
      runSuite: async () => ({
        passed: false,
        output: 'assertion failed',
        exitCode: 1,
        networkErrors: [],
      }),
    });

    const result = await verifier.verify(fixture.bundle, policy(2));

    expect(result.outcome).toBe('contradicted');
    expect(result.diagnostics[0]).toMatchObject({ code: ARXIC_VERIFY_APP_DEFECT });
  });

  test('blocks when clean fixture reset or seed is unavailable', async () => {
    const fixture = await stagedFixture();
    const verifier = verifierFor(fixture, {
      resetAndSeed: async () => {
        throw new Error('seed API unavailable');
      },
    });

    const result = await verifier.verify(fixture.bundle, policy(1));

    expect(result.outcome).toBe('blocked');
    expect(result.diagnostics[0]).toMatchObject({ code: ARXIC_VERIFY_BLOCKED_FIXTURE });
  });

  test('blocks when the Playwright suite cannot execute', async () => {
    const fixture = await stagedFixture();
    const verifier = verifierFor(fixture, {
      runSuite: async () => {
        throw new Error('browser executable unavailable');
      },
    });

    const result = await verifier.verify(fixture.bundle, policy(1));

    expect(result.outcome).toBe('blocked');
    expect(result.diagnostics[0]).toMatchObject({ code: ARXIC_VERIFY_SUITE_UNAVAILABLE });
  });

  test('blocks network failures when policy forbids them', async () => {
    const fixture = await stagedFixture();
    const verifier = verifierFor(fixture, {
      runSuite: async () => ({
        passed: true,
        output: 'net::ERR_CONNECTION_RESET',
        exitCode: 0,
        networkErrors: ['net::ERR_CONNECTION_RESET'],
      }),
    });

    const result = await verifier.verify(fixture.bundle, policy(1));

    expect(result.outcome).toBe('blocked');
    expect(result.diagnostics[0]).toMatchObject({ code: ARXIC_VERIFY_BLOCKED_NETWORK });
  });

  test('blocks when required screenshots and traces are absent', async () => {
    const fixture = await stagedFixture();
    const verifier = verifierFor(fixture);

    const result = await verifier.verify(fixture.bundle, {
      ...policy(1),
      screenshotCheckpoints: ['home'],
      trace: 'retain',
    });

    expect(result.outcome).toBe('blocked');
    expect(result.diagnostics[0]).toMatchObject({ code: ARXIC_VERIFY_ARTIFACT_MISSING });
  });

  test('blocks when required transitions are not observed', async () => {
    const fixture = await stagedFixture();
    const verifier = verifierFor(fixture, {
      runSuite: async () => ({
        passed: true,
        output: '',
        exitCode: 0,
        networkErrors: [],
        observedTransitions: [],
      }),
    });

    const result = await verifier.verify(fixture.bundle, policy(1));

    expect(result.outcome).toBe('blocked');
    expect(result.diagnostics[0]).toMatchObject({ code: ARXIC_VERIFY_TRANSITIONS_MISSING });
  });

  test('validates every verifier diagnostic through the frozen contract', () => {
    for (const code of ARXIC_VERIFY_DIAGNOSTIC_CODES) {
      const severity =
        code === ARXIC_VERIFY_FLAKY_RUNS || code === ARXIC_VERIFY_APP_DEFECT
          ? 'contradicted'
          : 'blocked';
      expect(
        validateDiagnostic({ code, severity, subject: 'verification', message: 'Diagnostic proof' })
          .ok,
      ).toBe(true);
    }
  });

  test('verifies two clean passes with hashed screenshots and traces', async () => {
    const fixture = await stagedFixture();
    const verifier = verifierFor(fixture, {
      runSuite: async (run) => {
        await writeRunArtifacts(fixture.outputDirectory, run);
        return { passed: true, output: '', exitCode: 0, networkErrors: [] };
      },
    });

    const result = await verifier.verify(fixture.bundle, {
      ...policy(2),
      screenshotCheckpoints: ['home'],
      trace: 'retain',
    });

    expect(result.outcome).toBe('verified');
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
  });

  test('blocks staged artifact hash corruption', async () => {
    const fixture = await stagedFixture();
    await writeFile(join(fixture.outputDirectory, 'tests/workflow.spec.ts'), 'corrupted');

    const result = await verifierFor(fixture).verify(fixture.bundle, policy(1));

    expect(result.outcome).toBe('blocked');
    expect(result.diagnostics[0]).toMatchObject({ code: ARXIC_VERIFY_ARTIFACT_HASH_MISMATCH });
  });

  test('blocks an invalid required run count', async () => {
    const fixture = await stagedFixture();

    const result = await verifierFor(fixture).verify(fixture.bundle, policy(0));

    expect(result.outcome).toBe('blocked');
    expect(result.diagnostics[0]).toMatchObject({ code: ARXIC_VERIFY_SUITE_UNAVAILABLE });
  });
});

function verifierFor(
  fixture: Awaited<ReturnType<typeof stagedFixture>>,
  options: Partial<ConstructorParameters<typeof PlaywrightVerifier>[0]> = {},
): PlaywrightVerifier {
  return new PlaywrightVerifier({
    outputDirectory: fixture.outputDirectory,
    artifactsDir: fixture.artifactsDirectory,
    origin: 'http://127.0.0.1:3000',
    ensurePlaywrightModule: false,
    resetAndSeed: async () => undefined,
    runSuite: async () => ({ passed: true, output: '', exitCode: 0, networkErrors: [] }),
    ...options,
  });
}

async function stagedFixture(): Promise<{
  bundle: StagedBundle;
  outputDirectory: string;
  artifactsDirectory: string;
}> {
  const outputDirectory = await mkdtemp(join(tmpdir(), 'arxic-verifier-stage-'));
  const artifactsDirectory = await mkdtemp(join(tmpdir(), 'arxic-verifier-artifacts-'));
  temporaryDirectories.push(outputDirectory, artifactsDirectory);
  const path = 'tests/workflow.spec.ts';
  const source = 'test("workflow", async () => undefined);\n';
  await mkdir(join(outputDirectory, 'tests'), { recursive: true });
  await writeFile(join(outputDirectory, path), source);
  const artifact: ArtifactRef = {
    kind: 'playwright-spec',
    path,
    sha256: createHash('sha256').update(source).digest('hex'),
  };
  return {
    outputDirectory,
    artifactsDirectory,
    bundle: {
      manifest: {} as StagedBundle['manifest'],
      workflow: workflow(),
      evidenceIndex: {},
      artifacts: [artifact],
      plan: 'plan',
    },
  };
}

async function writeRunArtifacts(outputDirectory: string, run: number): Promise<void> {
  const screenshots = join(outputDirectory, 'artifacts/screenshots');
  const results = join(outputDirectory, 'test-results', `run-${run}`);
  await Promise.all([mkdir(screenshots, { recursive: true }), mkdir(results, { recursive: true })]);
  await Promise.all([
    writeFile(join(screenshots, 'home.png'), `screenshot-${run}`),
    writeFile(join(results, 'trace.zip'), `trace-${run}`),
  ]);
}

function policy(requiredRuns: number) {
  return { requiredRuns, forbidNetworkErrors: true };
}

function workflow(): Workflow {
  return {
    $schema: 'https://arxic.dev/schemas/workflow/v1.json',
    id: 'authentication.login',
    version: 1,
    title: 'Login',
    domain: 'authentication',
    persona: 'registered-user',
    status: 'observed',
    confidence: 1,
    scope: {
      commit: '0123456789abcdef0123456789abcdef01234567',
      environment: 'local-test',
      browser: 'chromium',
    },
    preconditions: [{ fixture: 'user.exists' }],
    states: [{ id: 'login-page' }, { id: 'home' }],
    transitions: [
      {
        from: 'login-page',
        to: 'home',
        action: { intent: 'Submit login credentials' },
        assertions: [{ intent: 'url:/' }],
        evidenceRefs: ['src:login-handler'],
      },
    ],
    negativeCases: [],
    verification: { requiredRuns: 2, screenshotCheckpoints: [], forbidNetworkErrors: true },
    evidenceRefs: ['src:login-handler'],
  };
}
