import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { EvidenceRef, Workflow } from '@arxic/contracts';
import { validateDiagnostic, validateManifest } from '@arxic/contracts';
import { afterEach, describe, expect, test } from 'vitest';
import {
  ARXIC_COMPILE_DIAGNOSTIC_CODES,
  ARXIC_COMPILE_FORBIDDEN_API,
  ARXIC_COMPILE_LOCATOR_NONSEMANTIC,
  ARXIC_COMPILE_SECRET_EXPOSURE,
  ARXIC_COMPILE_UNSUPPORTED_STEP,
  ARXIC_COMPILE_WORKFLOW_INVALID,
  ARXIC_PROBE_DIAGNOSTIC_CODES,
  CompileError,
  PlaywrightCompiler,
  compileDiagnostic,
  enforceCompilePolicy,
  generateSpec,
  probeDiagnostic,
} from './index';
import { screenshotPrivacyRuntimeSource } from '@arxic/playwright-screenshot-privacy';
import { ARXIC_COMPILE_ORIGIN_DENIED, resolveOriginPolicy } from './index';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe('Playwright compiler sad paths', () => {
  test('blocks an invalid workflow instead of dropping the malformed transition', async () => {
    const workflow = loginWorkflow();
    delete (workflow.transitions[0] as Partial<Workflow['transitions'][number]>).action;
    await expect(compiler().compile(workflow, observations())).rejects.toMatchObject({
      diagnostic: { code: ARXIC_COMPILE_WORKFLOW_INVALID, severity: 'blocked' },
    });
  });

  test('blocks a valid but unsupported action pattern', async () => {
    const workflow = loginWorkflow();
    workflow.transitions[0]!.action = { intent: 'Teleport through the application' };
    await expect(compiler().compile(workflow, observations())).rejects.toMatchObject({
      diagnostic: { code: ARXIC_COMPILE_UNSUPPORTED_STEP, severity: 'blocked' },
    });
  });

  test.each([
    'await page.waitForTimeout(5);',
    "await page.waitForLoadState('networkidle');",
    'await page.evaluate(() => 1);',
  ])('blocks forbidden generated API: %s', (source) => {
    const result = enforceCompilePolicy({ spec: source, fixture: '', workflow: loginWorkflow() });
    expect(result).toMatchObject({
      passed: false,
      diagnostics: [{ code: ARXIC_COMPILE_FORBIDDEN_API, severity: 'blocked' }],
    });
  });

  test.each([
    "page.locator('#login')",
    "page.$('.login')",
    "page.$$('.login')",
    "page.locator('xpath=//button')",
  ])('blocks a CSS or XPath locator without diagnostic rationale: %s', (source) => {
    const result = enforceCompilePolicy({ spec: source, fixture: '', workflow: loginWorkflow() });
    expect(result).toMatchObject({
      passed: false,
      diagnostics: [{ code: ARXIC_COMPILE_LOCATOR_NONSEMANTIC, severity: 'blocked' }],
    });
  });

  test('blocks an unrationed CSS locator beside the rationed form scope', () => {
    const result = enforceCompilePolicy({
      spec: `
        const form = page.locator('form').filter({ has: page.getByLabel("Email") });
        const sidebar = page.locator('#sidebar');
      `,
      fixture: '',
      workflow: loginWorkflow(),
      nonSemanticLocatorDiagnostics: [formScopeRationale()],
    });
    expect(result).toMatchObject({
      passed: false,
      diagnostics: [{ code: ARXIC_COMPILE_LOCATOR_NONSEMANTIC, severity: 'blocked' }],
    });
  });

  test.each(["page.$('.login')", "page.locator('xpath=//button')", "locator('#sidebar')"])(
    'does not extend the form-scope rationale to another locator pattern: %s',
    (unapproved) => {
      const result = enforceCompilePolicy({
        spec: `const form = page.locator('form'); ${unapproved};`,
        fixture: '',
        workflow: loginWorkflow(),
        nonSemanticLocatorDiagnostics: [formScopeRationale()],
      });
      expect(result).toMatchObject({
        passed: false,
        diagnostics: [{ code: ARXIC_COMPILE_LOCATOR_NONSEMANTIC, severity: 'blocked' }],
      });
    },
  );

  test("blocks page.locator('form') without its reviewed rationale", () => {
    const result = enforceCompilePolicy({
      spec: "const form = page.locator('form');",
      fixture: '',
      workflow: loginWorkflow(),
    });
    expect(result).toMatchObject({
      passed: false,
      diagnostics: [{ code: ARXIC_COMPILE_LOCATOR_NONSEMANTIC, severity: 'blocked' }],
    });
  });

  test('allows only the exact rationed form-scope locator shape', () => {
    const result = enforceCompilePolicy({
      spec: `
        const form = page.locator('form').filter({ has: page.getByLabel("Email") });
        await form.getByRole('button', { name: /submit/i }).click();
      `,
      fixture: '',
      workflow: loginWorkflow(),
      nonSemanticLocatorDiagnostics: [formScopeRationale()],
    });
    expect(result).toEqual({ passed: true });
  });

  test('blocks secret and PII literals in generated source', () => {
    const workflow = loginWorkflow();
    workflow.preconditions[0] = {
      fixture: 'user.exists',
      parameters: { email: 'person@example.test', password: 'LiteralSecret9!' },
    };
    const result = enforceCompilePolicy({
      spec: "const leaked = 'person@example.test LiteralSecret9!'",
      fixture: '',
      workflow,
    });
    expect(result).toMatchObject({
      passed: false,
      diagnostics: [{ code: ARXIC_COMPILE_SECRET_EXPOSURE, severity: 'blocked' }],
    });
  });

  test('blocks a runtime observation whose origin is outside the action-owned allowlist', async () => {
    const runtime = observations()[1];
    if (!runtime || runtime.kind !== 'runtime') throw new Error('Missing runtime observation');
    runtime.url = 'http://foreign.example/login';
    await expect(
      compiler().compile(
        loginWorkflow(),
        observations().map((item, index) => (index === 1 ? runtime : item)),
      ),
    ).rejects.toMatchObject({
      diagnostic: { code: ARXIC_COMPILE_ORIGIN_DENIED, severity: 'blocked' },
    });
  });

  test('origin-denial diagnostics loop-close through the frozen contract', () => {
    const result = resolveOriginPolicy({
      subject: 'authentication.login',
      declaredOrigin: 'http://approved.example',
      runtimeUrl: 'http://foreign.example/login',
    });
    expect(result.passed).toBe(false);
    if (result.passed) throw new Error('Expected denied origin policy');
    expect(validateDiagnostic(result.diagnostic).ok).toBe(true);
  });

  test.each([
    ['assertion', 'text:Your token=abc123'],
    ['action', 'Click credential=abc123'],
  ] as const)('blocks secret literals embedded in a workflow %s intent', (kind, intent) => {
    const workflow = loginWorkflow();
    if (kind === 'assertion') workflow.transitions[0]!.assertions = [{ intent }];
    else workflow.transitions[0]!.action = { intent };
    const generatedLiteral = kind === 'assertion' ? 'Your token=abc123' : 'credential=abc123';
    const result = enforceCompilePolicy({ spec: generatedLiteral, fixture: '', workflow });
    expect(result).toMatchObject({
      passed: false,
      diagnostics: [{ code: ARXIC_COMPILE_SECRET_EXPOSURE, severity: 'blocked' }],
    });
  });
});

describe('Playwright compiler contracts', () => {
  test('validates every compiler diagnostic code through the frozen contract', () => {
    for (const code of ARXIC_COMPILE_DIAGNOSTIC_CODES) {
      expect(
        validateDiagnostic(compileDiagnostic(code, 'workflow', 'Blocked by test policy')).ok,
      ).toBe(true);
    }
  });

  test('validates every sensitivity-probe diagnostic code through the frozen contract', () => {
    for (const code of ARXIC_PROBE_DIAGNOSTIC_CODES) {
      expect(
        validateDiagnostic(probeDiagnostic(code, 'workflow', 'Insensitive assertion')).ok,
      ).toBe(true);
    }
  });

  test('compiles a policy-safe independent staged bundle', async () => {
    const directory = await temporaryDirectory();
    const workflow = loginWorkflow();
    workflow.preconditions[0] = {
      fixture: 'user.exists',
      parameters: { email: 'person@example.test', password: 'LiteralSecret9!' },
    };
    const bundle = await new PlaywrightCompiler({
      outputDirectory: directory,
      origin: 'http://127.0.0.1:3000',
      now: () => '2026-08-06T12:00:00.000Z',
    }).compile(workflow, observations());

    expect(validateManifest(bundle.manifest).ok).toBe(true);
    expect(bundle.manifest.verification.runs).toEqual([
      {
        startedAt: '2026-08-06T12:00:00.000Z',
        finishedAt: '2026-08-06T12:00:00.000Z',
        passed: false,
      },
    ]);
    expect(bundle.manifest.coverage.denominator).toBe(1);
    expect(bundle.artifacts).toHaveLength(5);
    expect(bundle.plan).toContain('login-page → home');
    const spec = await readFile(join(directory, 'tests/workflow.spec.ts'), 'utf8');
    expect(spec).toMatch(/getByLabel\(['"]Email['"]\)/u);
    expect(spec).toContain("getByRole('button'");
    expect(spec).toContain('artifacts/screenshots/step-1-login-page-home.png');
    expect(spec).toContain('capturePolicyScreenshot(page,');
    expect(spec).not.toContain('page.screenshot(');
    expect(spec).toContain('ARXIC_INPUT_PERSONA_EMAIL');
    expect(spec).not.toContain('waitForTimeout');
    expect(spec).not.toContain('waitForLoadState');
    expect(spec).not.toContain('page.evaluate');
    expect(spec).not.toContain('person@example.test');
    expect(spec).not.toContain('LiteralSecret9!');
    expect(spec).not.toContain('persona.email');
    expect(await readFile(join(directory, 'fixtures/workflow.fixture.ts'), 'utf8')).toContain(
      'clearCookies',
    );
    expect(await readFile(join(directory, 'fixtures/workflow.fixture.ts'), 'utf8')).toContain(
      'test.beforeEach',
    );
    expect(await readFile(join(directory, 'fixtures/workflow.fixture.ts'), 'utf8')).toContain(
      'test.afterEach',
    );
    const fixture = await readFile(join(directory, 'fixtures/workflow.fixture.ts'), 'utf8');
    expect(fixture).toContain("context.route('**/*'");
    expect(fixture).toContain("context.routeWebSocket('**/*'");
    expect(fixture).toContain('ARXIC-COMPILE-ORIGIN-DENIED');
    expect(fixture).toContain("error.message.includes('Route is already handled')");
    expect(spec).toContain('configureApprovedOrigins(["http://127.0.0.1:3000"])');
    const config = await readFile(join(directory, 'playwright.config.ts'), 'utf8');
    expect(config).toContain("serviceWorkers: 'block'");
    expect(await readFile(join(directory, 'fixtures/screenshot-privacy.ts'), 'utf8')).toBe(
      screenshotPrivacyRuntimeSource(),
    );
  });

  test('compiler errors expose one frozen blocked diagnostic', () => {
    const error = new CompileError(
      compileDiagnostic(ARXIC_COMPILE_WORKFLOW_INVALID, 'workflow', 'Invalid'),
    );
    expect(error.diagnostic.severity).toBe('blocked');
  });

  test('uses the observed runtime URL for the entry-state goto', () => {
    const generated = generateSpec(
      loginWorkflow(),
      'http://127.0.0.1:3000',
      'http://127.0.0.1:3000/',
    );
    expect(generated.spec).toContain('page.goto("http://127.0.0.1:3000/")');
    expect(generated.spec).not.toContain('page.goto("http://127.0.0.1:3000/login")');
  });

  test('uses runtime URL only for the first transition and state paths thereafter', () => {
    const workflow = loginWorkflow();
    workflow.states.push({ id: 'change-password-page' });
    workflow.transitions.push({
      from: 'home',
      to: 'change-password-page',
      action: { intent: 'Open Change password' },
      assertions: [{ intent: 'url:/change-password' }],
      evidenceRefs: ['src:change-password'],
    });
    const generated = generateSpec(
      workflow,
      'http://127.0.0.1:3000',
      'http://127.0.0.1:3000/observed-entry',
    );
    expect(generated.spec).toContain('page.goto("http://127.0.0.1:3000/observed-entry")');
    expect(generated.spec).toContain('page.goto("http://127.0.0.1:3000/")');
    expect(generated.spec.match(/observed-entry/gu)).toHaveLength(1);
    expect(generated.spec).toContain(
      'enforceNetworkContainment(context, () => page.getByRole(\'link\', { name: "Change password" }).click())',
    );
  });

  test('wraps button actions in fail-fast network containment', () => {
    const workflow = loginWorkflow();
    workflow.transitions[0]!.action = { intent: 'Click Continue' };
    const generated = generateSpec(workflow, 'http://127.0.0.1:3000');
    expect(generated.spec).toContain(
      'enforceNetworkContainment(context, () => page.getByRole(\'button\', { name: "Continue" }).click())',
    );
  });

  test('renders URL assertions as exact-route regexes that permit query strings and fragments', () => {
    const workflow = loginWorkflow();
    workflow.transitions[0]!.assertions = [{ intent: 'url:/' }, { intent: 'url:/change-password' }];
    const generated = generateSpec(workflow, 'http://127.0.0.1:3000');
    expect(generated.spec).toContain(
      'toHaveURL(/^http:\\/\\/127\\.0\\.0\\.1:3000\\/(?:[?#].*)?$/)',
    );
    expect(generated.spec).toContain(
      'toHaveURL(/^http:\\/\\/127\\.0\\.0\\.1:3000\\/change-password(?:[?#].*)?$/)',
    );
  });

  test('guards single-input submit form scope with a submit-button filter and exact count', () => {
    const workflow = loginWorkflow();
    workflow.transitions[0]!.action = {
      intent: 'Submit registered email',
      inputRefs: { email: 'persona.email' },
    };
    const generated = generateSpec(workflow, 'http://127.0.0.1:3000');
    expect(generated.spec).toContain(
      ".filter({ has: page.getByRole('button', { name: /submit|log in|login|sign in|continue|send|change|reset|verify|confirm|enroll|register|sign up/i }) })",
    );
    expect(generated.spec).toContain('await expect(form).toHaveCount(1);');
  });

  test('the generated guarded form scope passes the narrowed locator policy', () => {
    const generated = generateSpec(loginWorkflow(), 'http://127.0.0.1:3000');
    const result = enforceCompilePolicy({
      spec: generated.spec,
      fixture: '',
      workflow: loginWorkflow(),
      nonSemanticLocatorDiagnostics: [formScopeRationale()],
    });
    expect(result).toEqual({ passed: true });
  });

  test('renders camel-case labels, auth submit buttons, and unique transition screenshots', async () => {
    const directory = await temporaryDirectory();
    const workflow = loginWorkflow();
    workflow.states.push({ id: 'change-password-page' });
    workflow.transitions.push(
      {
        from: 'home',
        to: 'change-password-page',
        action: { intent: 'Open Change password' },
        assertions: [{ intent: 'url:/change-password' }],
        evidenceRefs: ['src:change-password', 'run:change-password'],
      },
      {
        from: 'change-password-page',
        to: 'change-password-page',
        action: {
          intent: 'Submit password change',
          inputRefs: {
            currentPassword: 'persona.password',
            newPassword: 'persona.newPassword',
          },
        },
        assertions: [{ intent: 'text:Password changed successfully' }],
        evidenceRefs: ['src:change-password-submit', 'run:change-password-submit'],
      },
    );
    workflow.verification.screenshotCheckpoints = ['home', 'change-password-page'];

    await new PlaywrightCompiler({
      outputDirectory: directory,
      origin: 'http://127.0.0.1:3000',
    }).compile(workflow, observations());

    const spec = await readFile(join(directory, 'tests/workflow.spec.ts'), 'utf8');
    expect(spec).toContain('getByLabel("Current password")');
    expect(spec).toContain('getByLabel("New password")');
    expect(spec).toContain(
      ".filter({ has: page.getByRole('button', { name: /submit|log in|login|sign in|continue|send|change|reset|verify|confirm|enroll|register|sign up/i }) })",
    );
    expect(spec).toContain('await expect(form).toHaveCount(1);');
    expect(spec).toContain('ARXIC_INPUT_PERSONA_NEWPASSWORD');
    expect(spec).toContain('|send|change|reset|verify|confirm|enroll|register|sign up/i');
    expect(spec).toContain('step-2-home-change-password-page.png');
    expect(spec).toContain('step-3-change-password-page-change-password-page.png');
  });
});

function compiler(): PlaywrightCompiler {
  return new PlaywrightCompiler({
    outputDirectory: join(tmpdir(), 'unused'),
    origin: 'http://127.0.0.1:3000',
  });
}

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'arxic-compiler-'));
  directories.push(directory);
  return directory;
}

function loginWorkflow(): Workflow {
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
      featureFlags: ['login=true'],
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
        assertions: [{ intent: 'url:/' }, { intent: 'text:Welcome' }],
        evidenceRefs: ['src:login-handler'],
      },
    ],
    negativeCases: [],
    verification: {
      requiredRuns: 2,
      screenshotCheckpoints: ['home'],
      forbidNetworkErrors: true,
      trace: 'retain',
    },
    evidenceRefs: ['src:login-handler'],
  };
}

function observations(): EvidenceRef[] {
  return [
    {
      kind: 'source',
      repo: 'https://github.com/example/arxic-fixture',
      commit: '0123456789abcdef0123456789abcdef01234567',
      path: 'app/login/page.tsx',
      startLine: 1,
      endLine: 10,
      blobSha256: 'a'.repeat(64),
      extractor: 'test',
    },
    {
      kind: 'runtime',
      runId: 'run-compiler-test',
      appBuildDigest: 'b'.repeat(64),
      browser: 'chromium',
      browserVersion: '1.62.1',
      url: 'http://127.0.0.1:3000/login',
      timestamp: '2026-08-06T12:00:00.000Z',
    },
  ];
}

function formScopeRationale() {
  return compileDiagnostic(
    ARXIC_COMPILE_LOCATOR_NONSEMANTIC,
    'authentication.login',
    "Reviewed page.locator('form') form scope",
  );
}
