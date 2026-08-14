import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import type { StagedBundle, Workflow } from '@arxic/contracts';
import { validateDiagnostic } from '@arxic/contracts';
import { PlaywrightCompiler } from '@arxic/playwright-compiler';
import {
  SCREENSHOT_CAPTURE_CORRELATION_ENV,
  SCREENSHOT_PRIVACY_POLICY_ENV,
  SCREENSHOT_PRIVACY_POLICY_SHA256_ENV,
  screenshotCaptureReceiptPath,
  serializeScreenshotPrivacyPolicy,
} from '@arxic/playwright-screenshot-privacy';
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
  ARXIC_VERIFY_SCREENSHOT_PRIVACY,
  ARXIC_VERIFY_TRANSITIONS_MISSING,
  ARXIC_VERIFY_TRACE_SANITIZATION_FAILED,
  PlaywrightVerifier,
  captureRunArtifacts,
  classifyVerification,
  readTransitionReceipts,
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

  test('rejects an external screenshot symlink without retaining its target', async () => {
    const outputDirectory = await mkdtemp(join(tmpdir(), 'arxic-verifier-symlink-'));
    const artifactsDirectory = await mkdtemp(join(tmpdir(), 'arxic-verifier-artifacts-'));
    const screenshots = join(outputDirectory, 'artifacts', 'screenshots');
    const sourceBytes = validPng();
    const externalDirectory = await mkdtemp(join(tmpdir(), 'arxic-verifier-external-'));
    const backing = join(externalDirectory, 'screenshot-source.png');
    const source = join(screenshots, 'proof.png');
    await mkdir(screenshots, { recursive: true });
    await writeFile(backing, sourceBytes);
    await symlink(backing, source);

    await expect(captureRunArtifacts(outputDirectory, artifactsDirectory, 1)).rejects.toThrow(
      'rejects symbolic links',
    );

    await expect(readFile(backing)).resolves.toEqual(sourceBytes);
    await expect(readdir(join(artifactsDirectory, 'verification', 'run-1'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  test('rejects a non-regular screenshot entry without blocking on its bytes', async () => {
    const outputDirectory = await mkdtemp(join(tmpdir(), 'arxic-verifier-special-'));
    const artifactsDirectory = await mkdtemp(join(tmpdir(), 'arxic-verifier-artifacts-'));
    const screenshots = join(outputDirectory, 'artifacts', 'screenshots');
    const socketPath = join(screenshots, 'proof.png');
    await mkdir(screenshots, { recursive: true });
    const server = createServer();
    await new Promise<void>((resolveListen, rejectListen) => {
      server.once('error', rejectListen);
      server.listen(socketPath, resolveListen);
    });
    try {
      await expect(captureRunArtifacts(outputDirectory, artifactsDirectory, 1)).rejects.toThrow(
        'rejects non-regular entries',
      );
    } finally {
      await new Promise<void>((resolveClose, rejectClose) =>
        server.close((error) => (error ? rejectClose(error) : resolveClose())),
      );
    }
    await expect(readdir(join(artifactsDirectory, 'verification', 'run-1'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  test('fails closed on an unreadable artifact child and removes the destination', async () => {
    const outputDirectory = await mkdtemp(join(tmpdir(), 'arxic-verifier-unreadable-'));
    const artifactsDirectory = await mkdtemp(join(tmpdir(), 'arxic-verifier-artifacts-'));
    const locked = join(outputDirectory, 'artifacts', 'locked');
    await mkdir(locked, { recursive: true });
    await writeFile(join(locked, 'proof.png'), validPng());
    await chmod(locked, 0o000);
    try {
      await expect(captureRunArtifacts(outputDirectory, artifactsDirectory, 1)).rejects.toThrow(
        'could not inspect the owned workspace safely',
      );
    } finally {
      await chmod(locked, 0o700);
    }
    await expect(readdir(join(artifactsDirectory, 'verification', 'run-1'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  test.each(['depth', 'entries', 'candidates'] as const)(
    'fails closed on the artifact discovery %s bound and removes the destination',
    async (limit) => {
      const outputDirectory = await mkdtemp(join(tmpdir(), 'arxic-verifier-discovery-limit-'));
      const artifactsDirectory = await mkdtemp(join(tmpdir(), 'arxic-verifier-artifacts-'));
      const artifacts = join(outputDirectory, 'artifacts');
      await mkdir(artifacts, { recursive: true });
      if (limit === 'depth') {
        let directory = artifacts;
        for (let depth = 0; depth < 17; depth += 1) {
          directory = join(directory, `d${depth}`);
          await mkdir(directory);
        }
      } else {
        const directory = join(artifacts, 'wide');
        await mkdir(directory);
        const count = limit === 'entries' ? 1_024 : 257;
        const extension = limit === 'entries' ? 'txt' : 'png';
        await Promise.all(
          Array.from({ length: count }, (_, index) =>
            writeFile(join(directory, `entry-${String(index).padStart(4, '0')}.${extension}`), ''),
          ),
        );
      }

      await expect(captureRunArtifacts(outputDirectory, artifactsDirectory, 1)).rejects.toThrow(
        'exceeded a configured safety limit',
      );
      await expect(
        readdir(join(artifactsDirectory, 'verification', 'run-1')),
      ).rejects.toMatchObject({ code: 'ENOENT' });
    },
  );

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

  test('rejects checkpoint-bound screenshots without an action-owned privacy policy', async () => {
    const outputDirectory = await mkdtemp(join(tmpdir(), 'arxic-verifier-checkpoint-extra-'));
    const artifactsDirectory = await mkdtemp(join(tmpdir(), 'arxic-verifier-artifacts-'));
    const screenshots = join(outputDirectory, 'artifacts', 'screenshots');
    await mkdir(screenshots, { recursive: true });
    await writeFile(join(screenshots, 'step-1-login-page-home.png'), validPng());
    await writeFile(join(screenshots, 'step-2-home-home.png'), validPng());

    await expect(
      captureRunArtifacts(outputDirectory, artifactsDirectory, 1, {
        screenshotCheckpoints: ['home'],
      }),
    ).rejects.toThrow('SCREENSHOT_PRIVACY_REQUIRED');
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

  test('keeps a failed run contradicted when its safe screenshot misses the required checkpoint', async () => {
    const fixture = await stagedFixture();
    const verifier = verifierFor(fixture, {
      runSuite: async () => {
        const screenshots = join(fixture.outputDirectory, 'artifacts', 'screenshots');
        await mkdir(screenshots, { recursive: true });
        await writeFile(join(screenshots, 'step-1-login-page-profile.png'), validPng());
        return {
          passed: false,
          output: 'assertion failed',
          exitCode: 1,
          networkErrors: [],
        };
      },
    });

    const result = await verifier.verify(fixture.bundle, {
      ...policy(1),
      screenshotCheckpoints: ['home'],
    });

    expect(result.outcome).toBe('contradicted');
    expect(result.diagnostics.map(({ code }) => code)).toContain(ARXIC_VERIFY_APP_DEFECT);
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

  test('blocks an exit-zero run which skips a required transition instead of marking it verified', async () => {
    const fixture = await stagedFixture();
    const verifier = verifierFor(fixture, {
      runSuite: async () => {
        await writeRunArtifacts(fixture.outputDirectory, 1);
        return {
          passed: true,
          output: '',
          exitCode: 0,
          networkErrors: [],
          observedTransitions: [],
        };
      },
    });

    const result = await verifier.verify(fixture.bundle, policy(1));

    expect(result.outcome).toBe('blocked');
    expect(result.diagnostics[0]).toMatchObject({ code: ARXIC_VERIFY_TRANSITIONS_MISSING });
  });

  test('blocks a two-run verification when one otherwise-passing replay skips a transition', async () => {
    const fixture = await stagedFixture();
    const verifier = verifierFor(fixture, {
      runSuite: async (run) => {
        await writeRunArtifacts(fixture.outputDirectory, run);
        return {
          passed: true,
          output: '',
          exitCode: 0,
          networkErrors: [],
          observedTransitions: run === 1 ? [] : ['login-page->home'],
        };
      },
    });

    const result = await verifier.verify(fixture.bundle, policy(2));

    expect(result.outcome).toBe('blocked');
    expect(result.diagnostics[0]).toMatchObject({ code: ARXIC_VERIFY_TRANSITIONS_MISSING });
  });

  test('blocks a passing legacy fixture which returns no transition receipt', async () => {
    const fixture = await stagedFixture();
    const verifier = verifierFor(fixture, {
      runSuite: async () => {
        await writeRunArtifacts(fixture.outputDirectory, 1);
        return {
          passed: true,
          output: '',
          exitCode: 0,
          networkErrors: [],
        };
      },
    });

    const result = await verifier.verify(fixture.bundle, policy(1));

    expect(result.outcome).toBe('blocked');
    expect(result.diagnostics[0]).toMatchObject({ code: ARXIC_VERIFY_TRANSITIONS_MISSING });
  });

  test('blocks malformed receipt output rather than trusting a successful process result', async () => {
    const fixture = await stagedFixture();
    const verifier = verifierFor(fixture, {
      runSuite: async () => {
        await writeRunArtifacts(fixture.outputDirectory, 1);
        return {
          passed: true,
          output: '',
          exitCode: 0,
          networkErrors: [],
          receiptError:
            'Transition receipt contains an untrusted, duplicate, or forged step witness',
        };
      },
    });

    const result = await verifier.verify(fixture.bundle, policy(1));

    expect(result.outcome).toBe('blocked');
    expect(result.diagnostics[0]).toMatchObject({ code: ARXIC_VERIFY_TRANSITIONS_MISSING });
  });

  test('defaults to blocking structured HTTP and console errors when policy omits forbidNetworkErrors', () => {
    const result = classifyVerification({
      subject: 'authentication.login',
      runs: [{ passed: true }],
      policy: { requiredRuns: 1 } as StagedBundle['workflow']['verification'],
      networkErrors: ['http-response 500 http://127.0.0.1:3000/api/login', 'console-error boom'],
    });

    expect(result.outcome).toBe('blocked');
    expect(result.diagnostics[0]).toMatchObject({ code: ARXIC_VERIFY_BLOCKED_NETWORK });
  });

  test('validates receipt nonce, step names, URL witnesses, and structured page events', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'arxic-transition-receipt-'));
    temporaryDirectories.push(directory);
    const receiptPath = join(directory, 'receipts.json');
    const nonce = 'runner-owned-nonce';
    const expectation = {
      path: receiptPath,
      nonce,
      testTitle: 'authentication.login',
      transitions: [{ id: 'login-page->home', stepName: 'login-page → home' }],
    };
    await writeFile(
      receiptPath,
      JSON.stringify({
        schemaVersion: 1,
        kind: 'arxic-transition-receipts',
        correlationSha256: createHash('sha256').update(nonce).digest('hex'),
        testTitle: 'authentication.login',
        transitions: [
          {
            id: 'login-page->home',
            stepName: 'login-page → home',
            url: 'http://127.0.0.1:3000/',
          },
        ],
        events: [
          { kind: 'http-response', status: 500, url: 'http://127.0.0.1:3000/api/login' },
          { kind: 'console-error', message: 'unexpected app error' },
        ],
      }),
    );

    await expect(readTransitionReceipts(expectation)).resolves.toEqual({
      ok: true,
      transitions: ['login-page->home'],
      networkErrors: ['http-response 500 http://127.0.0.1:3000/api/login', 'console-error'],
    });
    await writeFile(
      receiptPath,
      JSON.stringify({
        schemaVersion: 1,
        kind: 'arxic-transition-receipts',
        correlationSha256: createHash('sha256').update(nonce).digest('hex'),
        testTitle: 'authentication.login',
        transitions: [
          {
            id: 'forged->transition',
            stepName: 'forged → transition',
            url: 'http://127.0.0.1:3000/',
          },
        ],
        events: [],
      }),
    );
    await expect(readTransitionReceipts(expectation)).resolves.toEqual({
      ok: false,
      error: 'Transition receipt contains an untrusted, duplicate, or forged step witness',
    });
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

  test('blocks when no action-owned screenshot privacy policy is configured', async () => {
    const fixture = await stagedFixture();
    const result = await verifierFor(fixture, { screenshotPrivacyPolicy: undefined }).verify(
      fixture.bundle,
      policy(1),
    );

    expect(result.outcome).toBe('blocked');
    expect(result.diagnostics[0]).toMatchObject({ code: ARXIC_VERIFY_SCREENSHOT_PRIVACY });
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
    screenshotPrivacyPolicy: screenshotPolicy(),
    captureCorrelation: (run) => `verifier-unit-correlation-${run}`,
    now: () => '2026-08-09T12:00:00.000Z',
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
  const bundle = await new PlaywrightCompiler({
    outputDirectory,
    origin: 'http://127.0.0.1:3000',
    now: () => '2026-08-09T12:00:00.000Z',
  }).compile(workflow(), observations());
  return {
    outputDirectory,
    artifactsDirectory,
    bundle,
  };
}

async function writeRunArtifacts(outputDirectory: string, run: number): Promise<void> {
  const screenshots = join(outputDirectory, 'artifacts/screenshots');
  const results = join(outputDirectory, 'test-results', `run-${run}`);
  await Promise.all([mkdir(screenshots, { recursive: true }), mkdir(results, { recursive: true })]);
  const screenshot = join(screenshots, 'step-1-login-page-home.png');
  const bytes = validPng();
  const policyJson = process.env[SCREENSHOT_PRIVACY_POLICY_ENV];
  const policySha256 = process.env[SCREENSHOT_PRIVACY_POLICY_SHA256_ENV];
  const correlation = process.env[SCREENSHOT_CAPTURE_CORRELATION_ENV];
  if (!policyJson || !policySha256 || !correlation) throw new Error('privacy environment missing');
  await Promise.all([
    writeFile(screenshot, bytes),
    writeFile(
      screenshotCaptureReceiptPath(screenshot),
      canonicalJson({
        schemaVersion: 1,
        kind: 'arxic-untrusted-screenshot-capture',
        screenshotFile: 'step-1-login-page-home.png',
        screenshotSha256: createHash('sha256').update(bytes).digest('hex'),
        screenshotBytes: bytes.length,
        policySha256,
        correlationSha256: createHash('sha256').update(correlation).digest('hex'),
        captureMode: (JSON.parse(policyJson) as { capture: { mode: string } }).capture.mode,
        playwrightVersion: '1.62.1',
        browserVersion: '140.0.0.0',
        capturedAt: '2026-08-09T12:00:00.000Z',
      }),
    ),
    writeFile(join(results, 'trace.zip'), await traceZip(run)),
  ]);
}

function validPng(): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(Buffer.from([0, 0x11, 0x22, 0x33, 0xff]))),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(testCrc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([length, typeBytes, data, checksum]);
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
        action: {
          intent: 'Submit login credentials',
          inputRefs: { email: 'persona.email', password: 'persona.password' },
        },
        assertions: [{ intent: 'url:/' }],
        evidenceRefs: ['src:login-handler', 'run:login'],
      },
    ],
    negativeCases: [],
    verification: { requiredRuns: 2, screenshotCheckpoints: ['home'], forbidNetworkErrors: true },
    evidenceRefs: ['src:login-handler', 'run:login'],
  };
}

function observations() {
  return [
    {
      kind: 'source' as const,
      repo: 'https://github.com/anthonykewl20/arxic',
      commit: '0123456789abcdef0123456789abcdef01234567',
      path: 'app/login.ts',
      startLine: 1,
      endLine: 2,
      blobSha256: 'a'.repeat(64),
      extractor: 'verifier-unit',
    },
    {
      kind: 'runtime' as const,
      runId: 'run-verifier-unit',
      appBuildDigest: 'b'.repeat(64),
      browser: 'chromium',
      browserVersion: '1.62.1',
      url: 'http://127.0.0.1:3000/login',
      timestamp: '2026-08-09T12:00:00.000Z',
    },
  ];
}

function screenshotPolicy() {
  return serializeScreenshotPrivacyPolicy({
    schemaVersion: 1,
    id: 'verifier-unit-heading',
    authority: {
      kind: 'repository-policy',
      reference: 'packages/verifier/src/index.test.ts',
      recordedAt: '2026-08-09T12:00:00.000Z',
    },
    capture: {
      mode: 'approved-region',
      region: { kind: 'role', role: 'heading', name: 'Safe heading', exact: true },
      masks: [],
    },
  }).policy;
}

function canonicalJson(value: unknown): string {
  const canonicalize = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(canonicalize);
    if (item && typeof item === 'object') {
      return Object.fromEntries(
        Object.entries(item as Record<string, unknown>)
          .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
          .map(([key, child]) => [key, canonicalize(child)]),
      );
    }
    return item;
  };
  return `${JSON.stringify(canonicalize(value))}\n`;
}
