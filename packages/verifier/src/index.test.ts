import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ArtifactRef, StagedBundle, Workflow } from '@arxic/contracts';
import { validateDiagnostic } from '@arxic/contracts';
import { afterEach, describe, expect, test } from 'vitest';
import { ZipFile } from 'yazl';
import { inspectPlaywrightTrace } from '@arxic/playwright-trace-sanitizer';
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
  ARXIC_VERIFY_TRACE_SANITIZATION_FAILED,
  PlaywrightVerifier,
  captureRunArtifacts,
  classifyVerification,
} from './index';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe('PlaywrightVerifier', () => {
  test('rejects source-derived sensitive artifact filenames without retaining raw bytes', async () => {
    const outputDirectory = await mkdtemp(join(tmpdir(), 'arxic-verifier-sensitive-name-'));
    const artifactsDirectory = await mkdtemp(join(tmpdir(), 'arxic-verifier-artifacts-'));
    const results = join(outputDirectory, 'test-results', 'run');
    const rawTrace = join(results, 'sessionOpaqueFilenameCanary.zip');
    await mkdir(results, { recursive: true });
    await writeFile(rawTrace, await traceZip(1));

    await expect(captureRunArtifacts(outputDirectory, artifactsDirectory, 1)).rejects.toThrow(
      'filename rejected',
    );
    await expect(readFile(rawTrace)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test.each(['renamed-zip', 'png-trailing-zip', 'png-split-zip'] as const)(
    'rejects a %s trace carrier before screenshot retention',
    async (variant) => {
      const outputDirectory = await mkdtemp(join(tmpdir(), 'arxic-verifier-carrier-'));
      const artifactsDirectory = await mkdtemp(join(tmpdir(), 'arxic-verifier-artifacts-'));
      const results = join(outputDirectory, 'artifacts', 'screenshots');
      const source = join(results, 'proof.png');
      const rawTrace = await traceZip(1);
      const split = Math.floor(rawTrace.byteLength / 2);
      const bytes =
        variant === 'renamed-zip'
          ? rawTrace
          : variant === 'png-trailing-zip'
            ? Buffer.concat([validPng(), rawTrace])
            : pngWithAncillaryPayloads([rawTrace.subarray(0, split), rawTrace.subarray(split)]);
      await mkdir(results, { recursive: true });
      await writeFile(join(results, '00-safe.png'), validPng());
      await writeFile(source, bytes);

      await expect(captureRunArtifacts(outputDirectory, artifactsDirectory, 1)).rejects.toThrow(
        'strict trace-carrier-free PNG',
      );
      await expect(readFile(source)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(
        readdir(join(artifactsDirectory, 'verification', 'run-1')),
      ).rejects.toMatchObject({ code: 'ENOENT' });
    },
  );

  test('retains the exact bounded bytes read through a screenshot symlink', async () => {
    const outputDirectory = await mkdtemp(join(tmpdir(), 'arxic-verifier-symlink-'));
    const artifactsDirectory = await mkdtemp(join(tmpdir(), 'arxic-verifier-artifacts-'));
    const screenshots = join(outputDirectory, 'artifacts', 'screenshots');
    const sourceBytes = validPng();
    const backing = join(outputDirectory, 'screenshot-source.bin');
    const source = join(screenshots, 'proof.png');
    await mkdir(screenshots, { recursive: true });
    await writeFile(backing, sourceBytes);
    await symlink(backing, source);

    const artifacts = await captureRunArtifacts(outputDirectory, artifactsDirectory, 1);
    await writeFile(backing, await traceZip(1));

    expect(artifacts.map(({ kind }) => kind)).toEqual(['screenshot']);
    await expect(readFile(artifacts[0]!.path)).resolves.toEqual(sourceBytes);
  });

  test.each([
    {
      label: 'missing',
      fileNames: ['step-1-login-page-profile.png'],
      checkpoints: ['home'],
      code: 'missing-source',
    },
    {
      label: 'duplicate declaration',
      fileNames: ['home.png'],
      checkpoints: ['home', 'home'],
      code: 'duplicate-checkpoint',
    },
    {
      label: 'ambiguous duplicate source',
      fileNames: ['home.png', 'step-1-login-page-home.png'],
      checkpoints: ['home'],
      code: 'ambiguous-source',
    },
  ])('rejects a $label screenshot checkpoint mapping transactionally', async (scenario) => {
    const outputDirectory = await mkdtemp(join(tmpdir(), 'arxic-verifier-checkpoint-'));
    const artifactsDirectory = await mkdtemp(join(tmpdir(), 'arxic-verifier-artifacts-'));
    const screenshots = join(outputDirectory, 'artifacts', 'screenshots');
    await mkdir(screenshots, { recursive: true });
    for (const fileName of scenario.fileNames) {
      await writeFile(join(screenshots, fileName), validPng());
    }

    await expect(
      captureRunArtifacts(outputDirectory, artifactsDirectory, 1, {
        screenshotCheckpoints: scenario.checkpoints,
      }),
    ).rejects.toThrow(`Screenshot checkpoint mapping failed (${scenario.code})`);
    await expect(readdir(join(artifactsDirectory, 'verification', 'run-1'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  test('maps a rejected screenshot trace carrier to blocked without retained refs', async () => {
    const fixture = await stagedFixture();
    const source = join(fixture.outputDirectory, 'artifacts', 'screenshots', 'proof.png');
    const verifier = verifierFor(fixture, {
      runSuite: async () => {
        await mkdir(join(fixture.outputDirectory, 'artifacts', 'screenshots'), {
          recursive: true,
        });
        await writeFile(source, await traceZip(1));
        return {
          passed: true,
          output: '',
          exitCode: 0,
          networkErrors: [],
          observedTransitions: ['login-page->home'],
        };
      },
    });

    const result = await verifier.verify(fixture.bundle, {
      ...policy(1),
      screenshotCheckpoints: ['home'],
    });

    expect(result.outcome).toBe('blocked');
    expect(result.artifacts).toEqual([]);
    await expect(readFile(source)).rejects.toMatchObject({ code: 'ENOENT' });
  });

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

    const result = await verifier.verify(fixture.bundle, { ...policy(2), trace: 'retain' });

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
        observedTransitions: ['login-page->home'],
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

  test('blocks and retains no eligible trace when sanitization fails', async () => {
    const fixture = await stagedFixture();
    const rawTrace = join(fixture.outputDirectory, 'test-results', 'invalid-trace', 'trace.zip');
    const verifier = verifierFor(fixture, {
      runSuite: async () => {
        const results = join(fixture.outputDirectory, 'test-results', 'invalid-trace');
        await mkdir(results, { recursive: true });
        await writeFile(rawTrace, 'malformed trace archive');
        return {
          passed: true,
          output: '',
          exitCode: 0,
          networkErrors: [],
          observedTransitions: ['login-page->home'],
        };
      },
    });

    const result = await verifier.verify(fixture.bundle, { ...policy(1), trace: 'retain' });

    expect(result.outcome).toBe('blocked');
    expect(result.diagnostics[0]).toMatchObject({ code: ARXIC_VERIFY_TRACE_SANITIZATION_FAILED });
    expect(result.artifacts.some(({ kind }) => kind === 'trace')).toBe(false);
    await expect(readFile(rawTrace)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('blocks and removes eligible output when raw trace cleanup cannot unlink the source', async () => {
    const fixture = await stagedFixture();
    const results = join(fixture.outputDirectory, 'test-results', 'locked-trace');
    const rawTrace = join(results, 'trace.zip');
    const verifier = verifierFor(fixture, {
      runSuite: async () => {
        await mkdir(results, { recursive: true });
        await writeFile(rawTrace, await traceZip(1));
        await chmod(results, 0o500);
        return {
          passed: true,
          output: '',
          exitCode: 0,
          networkErrors: [],
          observedTransitions: ['login-page->home'],
        };
      },
    });

    try {
      const result = await verifier.verify(fixture.bundle, { ...policy(1), trace: 'retain' });
      expect(result.outcome).toBe('blocked');
      expect(result.diagnostics[0]).toMatchObject({ code: ARXIC_VERIFY_TRACE_SANITIZATION_FAILED });
      expect(result.artifacts.some(({ kind }) => kind === 'trace')).toBe(false);
      await expect(readFile(rawTrace)).resolves.toHaveLength(0);
    } finally {
      await chmod(results, 0o700);
    }
  });

  test('gives trace sanitization failure blocked precedence over mixed runtime results', async () => {
    const fixture = await stagedFixture();
    const verifier = verifierFor(fixture, {
      runSuite: async (run) => {
        const results = join(fixture.outputDirectory, 'test-results', `run-${run}`);
        await mkdir(results, { recursive: true });
        await writeFile(
          join(results, 'trace.zip'),
          run === 1 ? await traceZip(run) : 'malformed trace archive',
        );
        return {
          passed: run === 2,
          output: '',
          exitCode: run === 2 ? 0 : 1,
          networkErrors: [],
          observedTransitions: ['login-page->home'],
        };
      },
    });

    const result = await verifier.verify(fixture.bundle, { ...policy(2), trace: 'retain' });

    expect(result.runs).toEqual([{ passed: false }, { passed: true }]);
    expect(result.outcome).toBe('blocked');
    expect(result.diagnostics[0]).toMatchObject({ code: ARXIC_VERIFY_TRACE_SANITIZATION_FAILED });
  });

  test('classifyVerification blocks when required transitions are missing on a clean pass', () => {
    const result = classifyVerification({
      subject: 'authentication.login',
      runs: [{ passed: true }, { passed: true }],
      policy: { requiredRuns: 2, forbidNetworkErrors: true },
      missingTransitions: ['login-page->home'],
    });
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
        return {
          passed: true,
          output: '',
          exitCode: 0,
          networkErrors: [],
          observedTransitions: ['login-page->home'],
        };
      },
    });

    const result = await verifier.verify(fixture.bundle, {
      ...policy(2),
      screenshotCheckpoints: ['home'],
      trace: 'retain',
    });

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
    for (const trace of result.artifacts.filter(({ kind }) => kind === 'trace')) {
      await expect(
        inspectPlaywrightTrace({
          tracePath: trace.path,
          provenancePath: `${trace.path}.sanitization.json`,
        }),
      ).resolves.toMatchObject({ ok: true });
    }
  });

  test('provides every configured persona value to generated specs and restores the environment', async () => {
    const fixture = await stagedFixture();
    const previous = process.env.ARXIC_INPUT_PERSONA_NEWPASSWORD;
    let observedEnvironment: Record<string, string | undefined> = {};
    process.env.ARXIC_INPUT_PERSONA_NEWPASSWORD = 'previous-value';
    try {
      const verifier = verifierFor(fixture, {
        persona: {
          email: 'person@example.test',
          password: 'Password9!',
          newPassword: 'Replacement9!',
          totp: '123456',
        },
        runSuite: async () => {
          observedEnvironment = {
            email: process.env.ARXIC_INPUT_PERSONA_EMAIL,
            password: process.env.ARXIC_INPUT_PERSONA_PASSWORD,
            newPassword: process.env.ARXIC_INPUT_PERSONA_NEWPASSWORD,
            totp: process.env.ARXIC_INPUT_PERSONA_TOTP,
          };
          return {
            passed: false,
            output: 'expected test result',
            exitCode: 1,
            networkErrors: [],
          };
        },
      });

      await verifier.verify(fixture.bundle, policy(1));

      expect(observedEnvironment).toEqual({
        email: 'person@example.test',
        password: 'Password9!',
        newPassword: 'Replacement9!',
        totp: '123456',
      });
      expect(process.env.ARXIC_INPUT_PERSONA_EMAIL).toBeUndefined();
      expect(process.env.ARXIC_INPUT_PERSONA_PASSWORD).toBeUndefined();
      expect(process.env.ARXIC_INPUT_PERSONA_NEWPASSWORD).toBe('previous-value');
      expect(process.env.ARXIC_INPUT_PERSONA_TOTP).toBeUndefined();
    } finally {
      if (previous === undefined) delete process.env.ARXIC_INPUT_PERSONA_NEWPASSWORD;
      else process.env.ARXIC_INPUT_PERSONA_NEWPASSWORD = previous;
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
    runSuite: async () => ({
      passed: true,
      output: '',
      exitCode: 0,
      networkErrors: [],
      observedTransitions: ['login-page->home'],
    }),
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
    writeFile(join(screenshots, 'home.png'), validPng()),
    writeFile(join(results, 'trace.zip'), await traceZip(run)),
  ]);
}

function validPng(): Buffer {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  );
}

function pngWithAncillaryPayloads(payloads: readonly Buffer[]): Buffer {
  const png = validPng();
  const type = Buffer.from('raWx');
  const chunks = payloads.map((payload) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(payload.byteLength);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(testCrc32(Buffer.concat([type, payload])));
    return Buffer.concat([length, type, payload, crc]);
  });
  return Buffer.concat([
    png.subarray(0, png.byteLength - 12),
    ...chunks,
    png.subarray(png.byteLength - 12),
  ]);
}

function testCrc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function traceZip(run: number): Promise<Buffer> {
  const archive = new ZipFile();
  archive.addBuffer(
    Buffer.from(
      `${JSON.stringify({ type: 'context-options', version: 8, browserName: 'chromium', title: `verification run ${run}` })}\n${JSON.stringify(
        {
          type: 'action',
          callId: `call@${run}`,
          startTime: 1,
          endTime: 2,
          class: 'Frame',
          method: 'click',
          params: {},
        },
      )}\n`,
    ),
    'trace.trace',
  );
  archive.end();
  const chunks: Buffer[] = [];
  for await (const chunk of archive.outputStream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
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
