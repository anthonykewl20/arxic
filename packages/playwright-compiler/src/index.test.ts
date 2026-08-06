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
  CompileError,
  PlaywrightCompiler,
  compileDiagnostic,
  enforceCompilePolicy,
} from './index';

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

  test.each(["page.locator('#login')", "page.$('.login')", "page.locator('xpath=//button')"])(
    'blocks a CSS or XPath locator without diagnostic rationale: %s',
    (source) => {
      const result = enforceCompilePolicy({ spec: source, fixture: '', workflow: loginWorkflow() });
      expect(result).toMatchObject({
        passed: false,
        diagnostics: [{ code: ARXIC_COMPILE_LOCATOR_NONSEMANTIC, severity: 'blocked' }],
      });
    },
  );

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
    expect(bundle.artifacts).toHaveLength(4);
    expect(bundle.plan).toContain('login-page → home');
    const spec = await readFile(join(directory, 'tests/workflow.spec.ts'), 'utf8');
    expect(spec).toMatch(/getByLabel\(['"]Email['"]\)/u);
    expect(spec).toContain("getByRole('button'");
    expect(spec).toContain('artifacts/screenshots/home.png');
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
  });

  test('compiler errors expose one frozen blocked diagnostic', () => {
    const error = new CompileError(
      compileDiagnostic(ARXIC_COMPILE_WORKFLOW_INVALID, 'workflow', 'Invalid'),
    );
    expect(error.diagnostic.severity).toBe('blocked');
  });
});

function compiler(): PlaywrightCompiler {
  return new PlaywrightCompiler({
    outputDirectory: join(tmpdir(), 'unused'),
    origin: 'http://localhost',
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
