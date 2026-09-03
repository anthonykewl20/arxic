import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import type { StagedBundle, Workflow } from '@arxic/contracts';
import { validateDiagnostic } from '@arxic/contracts';
import { PlaywrightCompiler, REPLAY_PERSONA_STORAGE_STATE_ENV } from '@arxic/playwright-compiler';
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
  ARXIC_VERIFY_FIXTURE_LOGIN_BLOCKED,
  ARXIC_VERIFY_FIXTURE_NOT_DECLARED,
  ARXIC_VERIFY_FLAKY_RUNS,
  ARXIC_VERIFY_REDACTION_FAILED,
  ARXIC_VERIFY_RUN_FAILURE,
  ARXIC_VERIFY_SUITE_UNAVAILABLE,
  ARXIC_VERIFY_SCREENSHOT_PRIVACY,
  ARXIC_VERIFY_TRANSITIONS_MISSING,
  ARXIC_VERIFY_TRACE_SANITIZATION_FAILED,
  PlaywrightVerifier,
  captureRunArtifacts,
  classifyVerification,
  ensurePlaywrightModule,
  readTransitionReceipts,
  runPlaywrightSuite,
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
    const verifier = verifierFor(fixture, {
      runSuite: async (_run, _receipts, suiteDirectory) => {
        await mkdir(join(suiteDirectory, 'artifacts', 'screenshots'), {
          recursive: true,
        });
        const source = join(suiteDirectory, 'artifacts', 'screenshots', 'proof.png');
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
  });

  test('classifies a failed run honestly when artifact retention also fails (#258)', async () => {
    // #258: a failed run structurally produces no checkpoint screenshots, so the
    // screenshot inventory gate fails as a CONSEQUENCE. The old behavior let the
    // artifact gate mask the run cause; the honest classification is
    // contradicted with the failure evidence retained and the artifact gate
    // reported alongside.
    const fixture = await stagedFixture();
    const verifier = verifierFor(fixture, {
      runSuite: async (_run, _receipts, suiteDirectory) => {
        const screenshots = join(suiteDirectory, 'artifacts', 'screenshots');
        await mkdir(screenshots, { recursive: true });
        await writeFile(join(screenshots, 'step-1-login-page-profile.png'), validPng());
        return {
          passed: false,
          output: 'Error: expect(page).toHaveURL failed',
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
    expect(result.diagnostics[0]).toMatchObject({ code: ARXIC_VERIFY_APP_DEFECT });
    expect(result.diagnostics.map(({ code }) => code)).toContain(ARXIC_VERIFY_RUN_FAILURE);
    expect(result.diagnostics.map(({ code }) => code)).toContain(ARXIC_VERIFY_ARTIFACT_MISSING);
  });

  test('classifies a passing and failing split honestly when artifact retention also fails (#258)', async () => {
    const fixture = await stagedFixture();
    const verifier = verifierFor(fixture, {
      runSuite: async (run) => ({
        passed: run === 1,
        output: run === 1 ? '' : 'Error: expect(page).toHaveURL failed',
        exitCode: run === 1 ? 0 : 1,
        networkErrors: [],
        // The passing run carries its transition receipt; the failing run has
        // none because the assertion aborted it — this test isolates the
        // split + artifact-retention interaction, not receipt integrity.
        ...(run === 1 ? { observedTransitions: ['login-page->home'] } : {}),
      }),
    });

    const result = await verifier.verify(fixture.bundle, { ...policy(2), trace: 'retain' });

    expect(result.outcome).toBe('contradicted');
    expect(result.diagnostics[0]).toMatchObject({ code: ARXIC_VERIFY_FLAKY_RUNS });
    expect(result.runs).toEqual([{ passed: true }, { passed: false }]);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: ARXIC_VERIFY_ARTIFACT_MISSING })]),
    );
  });

  test('classifies every failing runtime run honestly when artifact retention also fails (#258)', async () => {
    const fixture = await stagedFixture();
    const verifier = verifierFor(fixture, {
      runSuite: async () => ({
        passed: false,
        output: 'Error: expect(page).toHaveURL failed',
        exitCode: 1,
        networkErrors: [],
      }),
    });

    const result = await verifier.verify(fixture.bundle, policy(2));

    expect(result.outcome).toBe('contradicted');
    expect(result.diagnostics[0]).toMatchObject({ code: ARXIC_VERIFY_APP_DEFECT });
    expect(result.diagnostics.filter(({ code }) => code === ARXIC_VERIFY_RUN_FAILURE)).toHaveLength(
      2,
    );
    expect(result.diagnostics.map(({ code }) => code)).toContain(ARXIC_VERIFY_ARTIFACT_MISSING);
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
      runSuite: async (_run, _receipts, suiteDirectory) => {
        await writeRunArtifacts(suiteDirectory, 1);
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
      runSuite: async (run, _receipts, suiteDirectory) => {
        await writeRunArtifacts(suiteDirectory, run);
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
      runSuite: async (_run, _receipts, suiteDirectory) => {
        await writeRunArtifacts(suiteDirectory, 1);
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

  test('requires an event receipt even when the workflow has no required transitions', async () => {
    const fixture = await stagedFixture(noRequiredTransitionsWorkflow());
    const verifier = verifierFor(fixture, {
      runSuite: async (_run, expectation) => {
        expect(expectation.transitions).toEqual([]);
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

    expect(result.outcome, JSON.stringify(result.diagnostics)).toBe('verified');
  });

  test('blocks a no-required-transitions workflow when its event receipt is absent', async () => {
    const fixture = await stagedFixture(noRequiredTransitionsWorkflow());
    const verifier = verifierFor(fixture, {
      runSuite: async () => {
        return { passed: true, output: '', exitCode: 0, networkErrors: [] };
      },
    });

    const result = await verifier.verify(fixture.bundle, policy(1));

    expect(result.outcome).toBe('blocked');
    expect(result.diagnostics[0]).toMatchObject({ code: ARXIC_VERIFY_TRANSITIONS_MISSING });
  });

  test('blocks malformed receipt output rather than trusting a successful process result', async () => {
    const fixture = await stagedFixture();
    const verifier = verifierFor(fixture, {
      runSuite: async (_run, _receipts, suiteDirectory) => {
        await writeRunArtifacts(suiteDirectory, 1);
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
    expect(result.artifacts).toEqual([]);
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

  test('gives forbidden network errors blocked precedence over flaky run evidence', () => {
    const result = classifyVerification({
      subject: 'authentication.login',
      runs: [{ passed: true }, { passed: false }],
      policy: { requiredRuns: 2, forbidNetworkErrors: true },
      networkErrors: ['run 2: console-error unexpected app error'],
    });

    expect(result.outcome).toBe('blocked');
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: ARXIC_VERIFY_BLOCKED_NETWORK })]),
    );
  });

  test.each([
    { runs: [], requiredRuns: 2, label: 'zero runs' },
    { runs: [{ passed: true }, { passed: false }], requiredRuns: 3, label: 'partial mixed runs' },
  ])('blocks $label before classifying runtime evidence', ({ runs, requiredRuns }) => {
    const result = classifyVerification({
      subject: 'authentication.login',
      runs,
      policy: { requiredRuns, forbidNetworkErrors: true },
    });

    expect(result.outcome).toBe('blocked');
    expect(result.diagnostics[0]).toMatchObject({ code: ARXIC_VERIFY_SUITE_UNAVAILABLE });
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
    await expect(readFile(receiptPath)).rejects.toMatchObject({ code: 'ENOENT' });
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

  test('blocks and deletes a receipt whose serialized console event exposes a persona secret', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'arxic-transition-receipt-redaction-'));
    temporaryDirectories.push(directory);
    const receiptPath = join(directory, 'receipts.json');
    const secret = 'ReceiptSecret9!';
    const nonce = 'runner-owned-nonce';
    await writeFile(
      receiptPath,
      JSON.stringify({
        schemaVersion: 1,
        kind: 'arxic-transition-receipts',
        correlationSha256: createHash('sha256').update(nonce).digest('hex'),
        testTitle: 'authentication.login',
        transitions: [],
        events: [{ kind: 'console-error', message: `leaked ${secret}` }],
      }),
    );

    await expect(
      readTransitionReceipts({
        path: receiptPath,
        nonce,
        testTitle: 'authentication.login',
        transitions: [],
        forbiddenSubstrings: [secret],
      }),
    ).resolves.toEqual({ ok: false, redactionFailure: true });
    await expect(readFile(receiptPath)).rejects.toMatchObject({ code: 'ENOENT' });

    const result = classifyVerification({
      subject: 'authentication.login',
      runs: [{ passed: true }],
      policy: policy(1),
      receiptRedactionFailures: ['run 1: transition receipt contained forbidden persona content'],
    });
    expect(result.outcome).toBe('blocked');
    expect(result.diagnostics[0]).toMatchObject({ code: ARXIC_VERIFY_REDACTION_FAILED });
    expect(result.diagnostics[0]?.message).not.toContain(secret);
  });

  test('blocks malformed event URL witnesses instead of allowing URL parsing to escape', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'arxic-transition-receipt-url-'));
    temporaryDirectories.push(directory);
    const receiptPath = join(directory, 'receipts.json');
    const nonce = 'runner-owned-nonce';
    await writeFile(
      receiptPath,
      JSON.stringify({
        schemaVersion: 1,
        kind: 'arxic-transition-receipts',
        correlationSha256: createHash('sha256').update(nonce).digest('hex'),
        testTitle: 'authentication.login',
        transitions: [],
        events: [{ kind: 'http-response', status: 500, url: 'forged non-url witness' }],
      }),
    );

    await expect(
      readTransitionReceipts({
        path: receiptPath,
        nonce,
        testTitle: 'authentication.login',
        transitions: [],
      }),
    ).resolves.toEqual({
      ok: false,
      error: 'Transition receipt contains a malformed page or context event',
    });
  });

  test('removes inherited receipt configuration from a receipt-free Playwright child run', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'arxic-receipt-env-'));
    temporaryDirectories.push(directory);
    const stalePath = join(directory, 'stale-receipts.json');
    const observedPath = join(directory, 'observed-env.json');
    const previousPath = process.env.ARXIC_TRANSITION_RECEIPTS_PATH;
    const previousNonce = process.env.ARXIC_TRANSITION_RECEIPTS_NONCE;
    process.env.ARXIC_TRANSITION_RECEIPTS_PATH = stalePath;
    process.env.ARXIC_TRANSITION_RECEIPTS_NONCE = 'stale-nonce';
    try {
      await Promise.all([
        writeFile(
          join(directory, 'playwright.config.ts'),
          "import { defineConfig } from '@playwright/test';\nexport default defineConfig({ testDir: './tests', use: { browserName: 'chromium', headless: true } });\n",
        ),
        mkdir(join(directory, 'tests'), { recursive: true }).then(() =>
          writeFile(
            join(directory, 'tests/probe.spec.ts'),
            `import { test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
test('receipt-free probe', async ({ page }) => {
  await page.setContent('<main>probe</main>');
  await writeFile(${JSON.stringify(observedPath)}, JSON.stringify({ path: process.env.ARXIC_TRANSITION_RECEIPTS_PATH ?? null, nonce: process.env.ARXIC_TRANSITION_RECEIPTS_NONCE ?? null }));
});
`,
          ),
        ),
      ]);
      await ensurePlaywrightModule(directory);

      const pass = await runPlaywrightSuite({ testDirectory: directory });

      expect(pass.passed, pass.output).toBe(true);
      await expect(readFile(observedPath, 'utf8')).resolves.toBe('{"path":null,"nonce":null}');
      await expect(readFile(stalePath)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      if (previousPath === undefined) delete process.env.ARXIC_TRANSITION_RECEIPTS_PATH;
      else process.env.ARXIC_TRANSITION_RECEIPTS_PATH = previousPath;
      if (previousNonce === undefined) delete process.env.ARXIC_TRANSITION_RECEIPTS_NONCE;
      else process.env.ARXIC_TRANSITION_RECEIPTS_NONCE = previousNonce;
    }
  }, 120_000);

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
    const verifier = verifierFor(fixture, {
      runSuite: async (_run, _receipts, suiteDirectory) => {
        const results = join(suiteDirectory, 'test-results', 'invalid-trace');
        await mkdir(results, { recursive: true });
        await writeFile(join(results, 'trace.zip'), 'malformed trace archive');
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
  });

  test('blocks and removes eligible output when raw trace cleanup cannot unlink the source', async () => {
    const fixture = await stagedFixture();
    let lockedSuiteDirectory: string | undefined;
    const verifier = verifierFor(fixture, {
      runSuite: async (_run, _receipts, suiteDirectory) => {
        lockedSuiteDirectory = suiteDirectory;
        const results = join(suiteDirectory, 'test-results', 'locked-trace');
        await mkdir(results, { recursive: true });
        await writeFile(join(results, 'trace.zip'), await traceZip(1));
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
    } finally {
      if (lockedSuiteDirectory) {
        await chmod(join(lockedSuiteDirectory, 'test-results', 'locked-trace'), 0o700).catch(
          () => undefined,
        );
      }
    }
  });

  test('gives trace sanitization failure blocked precedence over mixed runtime results', async () => {
    const fixture = await stagedFixture();
    const verifier = verifierFor(fixture, {
      runSuite: async (run, _receipts, suiteDirectory) => {
        const results = join(suiteDirectory, 'test-results', `run-${run}`);
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
        code === ARXIC_VERIFY_FLAKY_RUNS ||
        code === ARXIC_VERIFY_APP_DEFECT ||
        code === ARXIC_VERIFY_RUN_FAILURE
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
      runSuite: async (run, _receipts, suiteDirectory) => {
        await writeRunArtifacts(suiteDirectory, run);
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
    console.error(
      'VERIFY_OUTCOME:',
      result.outcome,
      '| diagnostics[0]:',
      result.diagnostics[0]?.code,
    );

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

// #368: the replay-persona capture (#reset → replayPersonaStorageState) and
// the ARXIC_REPLAY_PERSONA_STORAGE_STATE injection (#execute) must be gated on
// the SAME workflowPerformsLogin predicate the fixture generator uses. A
// login-owning workflow's generated fixture replays anonymous by contract and
// ignores the injected state entirely — capturing it is one wasted real-browser
// login per pass, and its LOGIN-BLOCKED failure mode can no longer serve the
// fixture. The capture is a REAL browser login against the declared origin, so
// these tests stage on an origin nothing will ever listen on (port 1): any
// attempted capture fails fast (connection refused) and deterministically,
// which is exactly the observable the gating needs.
describe('PlaywrightVerifier replay-persona capture gating (#368)', () => {
  const unreachableOrigin = 'http://127.0.0.1:1';

  test(
    'skips the replay-persona capture for a login-owning workflow',
    { timeout: 30_000 },
    async () => {
      const fixture = await stagedFixture(undefined, unreachableOrigin);
      let suiteRuns = 0;
      let observedReplayStateEnv: string | undefined = '__unset__';
      const verifier = new PlaywrightVerifier({
        outputDirectory: fixture.outputDirectory,
        artifactsDir: fixture.artifactsDirectory,
        origin: unreachableOrigin,
        ensurePlaywrightModule: false,
        persona: { email: 'persona@example.test', password: 'PersonaPassword9!' },
        replayPersona: replayDeclaration(),
        runSuite: async (_run, _receipts, suiteDirectory) => {
          suiteRuns += 1;
          observedReplayStateEnv = process.env[REPLAY_PERSONA_STORAGE_STATE_ENV];
          await writeRunArtifacts(suiteDirectory, 1);
          return {
            passed: true,
            output: '',
            exitCode: 0,
            networkErrors: [],
            observedTransitions: ['login-page->home'],
          };
        },
        screenshotPrivacyPolicy: screenshotPolicy(),
        captureCorrelation: (run) => `verifier-unit-correlation-${run}`,
        now: () => '2026-08-09T12:00:00.000Z',
      });

      const result = await verifier.verify(fixture.bundle, {
        ...policy(1),
        screenshotCheckpoints: ['home'],
        trace: 'retain',
      });

      expect(result.outcome, JSON.stringify(result.diagnostics)).toBe('verified');
      expect(result.runs).toEqual([{ passed: true }]);
      expect(suiteRuns).toBe(1);
      expect(observedReplayStateEnv).toBeUndefined();
    },
  );

  test(
    'still captures the replay-persona state for a post-login workflow (fail-closed)',
    { timeout: 60_000 },
    async () => {
      const fixture = await stagedFixture(postLoginWorkflow(), unreachableOrigin);
      let suiteRuns = 0;
      const verifier = new PlaywrightVerifier({
        outputDirectory: fixture.outputDirectory,
        artifactsDir: fixture.artifactsDirectory,
        origin: unreachableOrigin,
        ensurePlaywrightModule: false,
        persona: { email: 'persona@example.test', password: 'PersonaPassword9!' },
        replayPersona: replayDeclaration(),
        runSuite: async () => {
          suiteRuns += 1;
          return {
            passed: true,
            output: '',
            exitCode: 0,
            networkErrors: [],
            observedTransitions: [],
          };
        },
        screenshotPrivacyPolicy: screenshotPolicy(),
        captureCorrelation: (run) => `verifier-unit-correlation-${run}`,
        now: () => '2026-08-09T12:00:00.000Z',
      });

      const result = await verifier.verify(fixture.bundle, policy(1));

      expect(result.outcome).toBe('blocked');
      expect(result.runs).toEqual([]);
      expect(suiteRuns).toBe(0);
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          code: ARXIC_VERIFY_FIXTURE_LOGIN_BLOCKED,
          severity: 'blocked',
        }),
      );
    },
  );

  test(
    'refuses a declared replay persona without a persona for a login-owning workflow (fail-closed)',
    { timeout: 30_000 },
    async () => {
      const fixture = await stagedFixture(undefined, unreachableOrigin);
      let suiteRuns = 0;
      const verifier = new PlaywrightVerifier({
        outputDirectory: fixture.outputDirectory,
        artifactsDir: fixture.artifactsDirectory,
        origin: unreachableOrigin,
        ensurePlaywrightModule: false,
        replayPersona: replayDeclaration(),
        runSuite: async () => {
          suiteRuns += 1;
          return {
            passed: true,
            output: '',
            exitCode: 0,
            networkErrors: [],
            observedTransitions: ['login-page->home'],
          };
        },
        screenshotPrivacyPolicy: screenshotPolicy(),
        captureCorrelation: (run) => `verifier-unit-correlation-${run}`,
        now: () => '2026-08-09T12:00:00.000Z',
      });

      const result = await verifier.verify(fixture.bundle, policy(1));

      expect(result.outcome).toBe('blocked');
      expect(result.runs).toEqual([]);
      expect(suiteRuns).toBe(0);
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          code: ARXIC_VERIFY_FIXTURE_NOT_DECLARED,
          severity: 'blocked',
        }),
      );
    },
  );
});

// #308 (F-E7): the campaign's first fully-verifying run (directus-dg12-run5)
// ended with artifacts/{00..09,13}.json MISSING from the run root while
// artifacts/{10,11,12}.json (committed after verification) survived — the
// stage-10 verification window destroyed the immutable stage artifacts.
// Root cause (traced to the exact function): the screenshot-privacy
// retention in playwright-screenshot-privacy/attestation.ts inventories and
// then REMOVES everything under its source roots ('artifacts',
// 'test-results' relative to the suite directory) — and the CLI wires the
// suite directory to the RUN ROOT, so the orchestrator's stage artifacts are
// inventoried as capture data and purged (purgeValidatedSourceRoot does
// rm(root, recursive)). This pins the invariant at the verifier seam.
test('#308 stage artifacts under outputDirectory/artifacts survive verification', async () => {
  const fixture = await stagedFixture();
  const artifactsDirectory = join(fixture.outputDirectory, 'artifacts');
  await mkdir(artifactsDirectory, { recursive: true });
  await Promise.all([
    writeFile(join(artifactsDirectory, '00.json'), '{"stage":0}\n'),
    writeFile(join(artifactsDirectory, '13.json'), '{"stage":13}\n'),
  ]);
  const result = await verifierFor(fixture).verify(fixture.bundle, policy(1));
  expect(['blocked', 'failed', 'verified']).toContain(result.outcome);
  const survived = await Promise.all(
    ['00.json', '13.json'].map(async (name) => {
      try {
        return await readFile(join(artifactsDirectory, name), 'utf8');
      } catch {
        return undefined;
      }
    }),
  );
  expect(survived).toEqual(['{"stage":0}\n', '{"stage":13}\n']);
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

async function stagedFixture(
  inputWorkflow = workflow(),
  origin = 'http://127.0.0.1:3000',
): Promise<{
  bundle: StagedBundle;
  outputDirectory: string;
  artifactsDirectory: string;
}> {
  const outputDirectory = await mkdtemp(join(tmpdir(), 'arxic-verifier-stage-'));
  const artifactsDirectory = await mkdtemp(join(tmpdir(), 'arxic-verifier-artifacts-'));
  temporaryDirectories.push(outputDirectory, artifactsDirectory);
  const bundle = await new PlaywrightCompiler({
    outputDirectory,
    origin,
    now: () => '2026-08-09T12:00:00.000Z',
  }).compile(inputWorkflow, observations(origin));
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

function noRequiredTransitionsWorkflow(): Workflow {
  const fixture = workflow();
  fixture.transitions[0]!.required = false;
  return fixture;
}

/** #368: a post-login workflow (no login identity ref) — the capture IS its start state. */
function postLoginWorkflow(): Workflow {
  const fixture = workflow();
  fixture.states = [{ id: 'home' }, { id: 'logged-out' }];
  fixture.transitions = [
    {
      from: 'home',
      to: 'logged-out',
      action: { intent: 'click Logout' },
      assertions: [{ intent: 'text:Logged out' }],
      evidenceRefs: ['src:login-handler', 'run:login'],
    },
  ];
  fixture.verification = {
    ...fixture.verification,
    screenshotCheckpoints: ['logged-out'],
  };
  return fixture;
}

function replayDeclaration() {
  return {
    mode: 'per-pass-login' as const,
    login: {
      route: '/login',
      fields: [
        { label: 'Email', inputRef: 'persona.email' as const },
        { label: 'Password', inputRef: 'persona.password' as const },
      ],
      submit: { label: 'Login' },
    },
  };
}

function observations(origin = 'http://127.0.0.1:3000') {
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
      url: `${origin}/login`,
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
