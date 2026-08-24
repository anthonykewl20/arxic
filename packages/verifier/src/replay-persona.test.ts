import { createServer, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { StagedBundle, Workflow } from '@arxic/contracts';
import { validateDiagnostic } from '@arxic/contracts';
import { PlaywrightCompiler } from '@arxic/playwright-compiler';
import { serializeScreenshotPrivacyPolicy } from '@arxic/playwright-screenshot-privacy';
import { afterEach, describe, expect, test } from 'vitest';
import {
  ARXIC_VERIFY_FIXTURE_BASELINE_DIVERGENT,
  ARXIC_VERIFY_FIXTURE_DECLARATION_INVALID,
  ARXIC_VERIFY_FIXTURE_DIAGNOSTIC_CODES,
  ARXIC_VERIFY_FIXTURE_LOGIN_BLOCKED,
  ARXIC_VERIFY_FIXTURE_NOT_DECLARED,
  ARXIC_VERIFY_FIXTURE_PROD_REFUSED,
  PlaywrightVerifier,
  loginReplayPersona,
  validateReplayPersonaDeclaration,
  type ReplayPersonaDeclaration,
} from './index';
import type { VerificationPersona } from './reset';

const temporaryDirectories: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections?.();
          server.close(() => resolve());
        }),
    ),
  );
});

const DECLARATION: ReplayPersonaDeclaration = {
  mode: 'per-pass-login',
  login: {
    route: '/login',
    fields: [
      { label: 'Email', inputRef: 'persona.email' },
      { label: 'Password', inputRef: 'persona.password' },
    ],
    submit: { label: 'Login' },
  },
};

const PERSONA: VerificationPersona = {
  email: 'replay-persona@example.test',
  password: 'ReplayPersona9!',
};

describe('replay-persona declaration validation (#288)', () => {
  test('accepts the frozen declaration shape', () => {
    expect(validateReplayPersonaDeclaration(DECLARATION)).toEqual({
      ok: true,
      value: DECLARATION,
    });
  });

  test.each([
    ['a non-object', 'nope'],
    ['an array', [DECLARATION]],
    ['an unknown mode', { ...DECLARATION, mode: 'per-pass-reset' }],
    ['a missing mode', { login: DECLARATION.login }],
    ['a relative route', { ...DECLARATION, login: { ...DECLARATION.login, route: 'login' } }],
    [
      'an absolute URL route',
      {
        ...DECLARATION,
        login: { ...DECLARATION.login, route: 'http://evil.example/login' },
      },
    ],
    [
      'a query-bearing route that changes the path',
      {
        ...DECLARATION,
        login: { ...DECLARATION.login, route: '/login?next=/%2F%2Fevil' },
      },
    ],
    [
      'an empty fields list',
      {
        ...DECLARATION,
        login: { ...DECLARATION.login, fields: [] },
      },
    ],
    [
      'an unknown inputRef',
      {
        ...DECLARATION,
        login: {
          ...DECLARATION.login,
          fields: [{ label: 'Email', inputRef: 'env.ADMIN_EMAIL' }],
        },
      },
    ],
    [
      'a field without a label',
      {
        ...DECLARATION,
        login: { ...DECLARATION.login, fields: [{ label: '', inputRef: 'persona.email' }] },
      },
    ],
    [
      'a missing submit block',
      (() => {
        const login = Object.fromEntries(
          Object.entries(DECLARATION.login as Record<string, unknown>).filter(
            ([key]) => key !== 'submit',
          ),
        );
        return { mode: 'per-pass-login', login };
      })(),
    ],
  ])('rejects %s with DECLARATION-INVALID at the precise subject', (_name, value) => {
    const result = validateReplayPersonaDeclaration(value);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.length).toBeGreaterThan(0);
      for (const diagnostic of result.diagnostics) {
        expect(diagnostic.code).toBe(ARXIC_VERIFY_FIXTURE_DECLARATION_INVALID);
        expect(diagnostic.severity).toBe('blocked');
        expect(diagnostic.subject).toMatch(/^config\.fixtures\.replayPersona/u);
        expect(validateDiagnostic(diagnostic).ok).toBe(true);
      }
    }
  });

  test('every frozen ARXIC-VERIFY-FIXTURE-* code validates through the frozen contract', () => {
    expect([...ARXIC_VERIFY_FIXTURE_DIAGNOSTIC_CODES]).toEqual([
      ARXIC_VERIFY_FIXTURE_NOT_DECLARED,
      ARXIC_VERIFY_FIXTURE_PROD_REFUSED,
      ARXIC_VERIFY_FIXTURE_DECLARATION_INVALID,
      ARXIC_VERIFY_FIXTURE_LOGIN_BLOCKED,
      ARXIC_VERIFY_FIXTURE_BASELINE_DIVERGENT,
    ]);
    for (const code of ARXIC_VERIFY_FIXTURE_DIAGNOSTIC_CODES) {
      expect(
        validateDiagnostic({
          code,
          severity: 'blocked',
          subject: 'verification.replay-persona',
          message: 'Diagnostic proof',
        }).ok,
      ).toBe(true);
    }
  });
});

describe('replay-persona per-pass login (#288, real Chromium against a real form)', () => {
  test('logs the persona in through the declared form and lands past the login route', async () => {
    const { origin, attempts } = await formServer();
    await loginReplayPersona({
      origin,
      declaration: DECLARATION,
      persona: PERSONA,
      subject: 'replay.unit',
    });
    expect(attempts.logins).toBe(1);
  }, 60_000);

  test('classifies refused credentials as LOGIN-BLOCKED with the persona value redacted', async () => {
    const { origin } = await formServer();
    const error = await loginReplayPersona({
      origin,
      declaration: DECLARATION,
      persona: { ...PERSONA, password: 'WrongPassword1!' },
      subject: 'replay.unit',
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as { diagnostic: { code: string } }).diagnostic.code).toBe(
      ARXIC_VERIFY_FIXTURE_LOGIN_BLOCKED,
    );
    const diagnostic = (error as { diagnostic: Record<string, string> }).diagnostic;
    expect(validateDiagnostic(diagnostic).ok).toBe(true);
    expect(JSON.stringify(error)).not.toContain('WrongPassword1!');
    expect(JSON.stringify(error)).not.toContain(PERSONA.email);
  }, 60_000);

  test('classifies an unresolvable declared form as LOGIN-BLOCKED (no fabricated pass)', async () => {
    const { origin } = await formServer();
    const error = await loginReplayPersona({
      origin,
      declaration: {
        ...DECLARATION,
        login: {
          route: '/login',
          fields: [{ label: 'Nonexistent', inputRef: 'persona.email' }],
          submit: { label: 'Login' },
        },
      },
      persona: PERSONA,
      subject: 'replay.unit',
    }).catch((caught: unknown) => caught);
    expect((error as { diagnostic: { code: string } }).diagnostic.code).toBe(
      ARXIC_VERIFY_FIXTURE_LOGIN_BLOCKED,
    );
  }, 60_000);

  test('classifies a missing persona value for a declared field as LOGIN-BLOCKED', async () => {
    const { origin } = await formServer();
    const error = await loginReplayPersona({
      origin,
      declaration: DECLARATION,
      persona: { email: PERSONA.email, password: '' },
      subject: 'replay.unit',
    }).catch((caught: unknown) => caught);
    expect((error as { diagnostic: { code: string } }).diagnostic.code).toBe(
      ARXIC_VERIFY_FIXTURE_LOGIN_BLOCKED,
    );
  }, 60_000);
});

describe('PlaywrightVerifier with a declared replay persona (#288)', () => {
  test('refuses fail-closed with NOT-DECLARED before run 1 when no persona is configured', async () => {
    const fixture = await stagedFixture();
    let suiteRuns = 0;
    const verifier = new PlaywrightVerifier({
      outputDirectory: fixture.outputDirectory,
      artifactsDir: fixture.artifactsDirectory,
      origin: 'http://127.0.0.1:3000',
      ensurePlaywrightModule: false,
      replayPersona: DECLARATION,
      runSuite: async () => {
        suiteRuns += 1;
        throw new Error('The suite must never execute after a fixture refusal');
      },
      screenshotPrivacyPolicy: screenshotPolicy(),
      now: () => '2026-08-24T12:00:00.000Z',
    });

    const result = await verifier.verify(fixture.bundle, policy(2));

    expect(result.outcome).toBe('blocked');
    expect(result.runs).toEqual([]);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: ARXIC_VERIFY_FIXTURE_NOT_DECLARED, severity: 'blocked' }),
    );
    expect(suiteRuns).toBe(0);
  });

  test('per-pass login replaces the endpoint protocol: both passes classify with no fixture-endpoint call', async () => {
    const { origin, attempts } = await formServer();
    const fixture = await stagedFixture(origin);
    const verifier = new PlaywrightVerifier({
      outputDirectory: fixture.outputDirectory,
      artifactsDir: fixture.artifactsDirectory,
      origin,
      ensurePlaywrightModule: false,
      replayPersona: DECLARATION,
      persona: PERSONA,
      runSuite: async () => ({
        passed: true,
        output: '',
        exitCode: 0,
        networkErrors: [],
        observedTransitions: ['login-page->home'],
      }),
      screenshotPrivacyPolicy: screenshotPolicy(),
      captureCorrelation: (run) => `replay-unit-correlation-${run}`,
      now: () => '2026-08-24T12:00:00.000Z',
    });

    const result = await verifier.verify(fixture.bundle, policy(2));

    // One leased login PER pass; zero arxic fixture-protocol calls.
    expect(attempts.logins).toBe(2);
    expect(attempts.fixtureProtocol).toBe(0);
    expect(result.runs).toEqual([{ passed: true }, { passed: true }]);
  }, 120_000);
});

/** A REAL HTTP app with a labelled login form — the third-party target shape. */
async function formServer(): Promise<{
  origin: string;
  attempts: { logins: number; fixtureProtocol: number };
}> {
  const attempts = { logins: 0, fixtureProtocol: 0 };
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/login' && request.method === 'GET') {
      response.setHeader('content-type', 'text/html');
      response.end(loginHtml());
      return;
    }
    if (url.pathname === '/login' && request.method === 'POST') {
      attempts.logins += 1;
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        // Decode as a real x-www-form-urlencoded body (browsers percent-encode
        // `!` as %21; a raw substring compare against encodeURIComponent output
        // mismatches exactly there).
        const fields = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
        const accepted =
          fields.get('email') === PERSONA.email && fields.get('password') === PERSONA.password;
        if (accepted) {
          response.statusCode = 303;
          response.setHeader('location', '/welcome');
          response.end();
        } else {
          response.statusCode = 200;
          response.setHeader('content-type', 'text/html');
          response.end(loginHtml('Invalid credentials'));
        }
      });
      return;
    }
    if (url.pathname === '/welcome') {
      response.setHeader('content-type', 'text/html');
      response.end('<main><h1>Welcome</h1></main>');
      return;
    }
    if (url.pathname.startsWith('/__arxic/')) {
      attempts.fixtureProtocol += 1;
      response.statusCode = 404;
      response.end();
      return;
    }
    response.statusCode = 404;
    response.end();
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not start form server');
  return { origin: `http://127.0.0.1:${address.port}`, attempts };
}

function loginHtml(error?: string): string {
  return `<!doctype html><html><body><main>
  <h1>Login</h1>
  ${error ? `<p class="error">${error}</p>` : ''}
  <form method="post" action="/login">
    <label>Email<input name="email" type="email" required /></label>
    <label>Password<input name="password" type="password" required /></label>
    <button type="submit">Login</button>
  </form>
</main></body></html>`;
}

function policy(requiredRuns: number) {
  return {
    requiredRuns,
    forbidNetworkErrors: true,
    screenshotCheckpoints: ['home'],
    trace: 'retain' as const,
  };
}

function screenshotPolicy() {
  return serializeScreenshotPrivacyPolicy({
    schemaVersion: 1,
    id: 'replay-unit-mask',
    authority: {
      kind: 'repository-policy',
      reference: 'arxic.yaml:policy.screenshots',
      recordedAt: '2026-08-24T12:00:00.000Z',
    },
    capture: {
      mode: 'masked-page',
      fullPage: true,
      masks: [{ kind: 'role', role: 'main', exact: true }],
    },
  }).policy;
}

async function stagedFixture(origin = 'http://127.0.0.1:3000'): Promise<{
  bundle: StagedBundle;
  outputDirectory: string;
  artifactsDirectory: string;
}> {
  const outputDirectory = await mkdtemp(join(tmpdir(), 'arxic-replay-stage-'));
  const artifactsDirectory = await mkdtemp(join(tmpdir(), 'arxic-replay-artifacts-'));
  temporaryDirectories.push(outputDirectory, artifactsDirectory);
  const bundle = await new PlaywrightCompiler({
    outputDirectory,
    origin,
    now: () => '2026-08-24T12:00:00.000Z',
  }).compile(workflow(), observations(origin));
  return { bundle, outputDirectory, artifactsDirectory };
}

function workflow(): Workflow {
  return {
    $schema: 'https://arxic.dev/schemas/workflow/v1.json',
    id: 'replay.unit.login',
    version: 1,
    title: 'Replay persona unit workflow',
    domain: 'authentication',
    persona: 'registered-user',
    status: 'observed' as const,
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
        evidenceRefs: ['src:login-handler'],
      },
    ],
    negativeCases: [],
    verification: {
      requiredRuns: 2,
      screenshotCheckpoints: ['home'],
      forbidNetworkErrors: true,
      trace: 'retain' as const,
    },
    evidenceRefs: ['src:login-handler'],
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
      extractor: 'replay-unit',
    },
    {
      kind: 'runtime' as const,
      runId: 'run-replay-unit',
      appBuildDigest: 'b'.repeat(64),
      browser: 'chromium',
      browserVersion: '1.62.1',
      url: `${origin}/login`,
      timestamp: '2026-08-24T12:00:00.000Z',
    },
  ];
}
