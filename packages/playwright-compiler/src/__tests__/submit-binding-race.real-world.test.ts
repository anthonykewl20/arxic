// #383 real-world proof: the compiled submit-control binding must bind
// text-only-named submit buttons. The captured koel login shape (live
// capture 2026-09-04, koel @ dfec91ff through the campaign AttestationFront,
// real Chromium 151.0.7922.34) renders a label-wrapped
// <button type="submit">Log In</button> whose accessible name is EMPTY in
// Chromium's a11y tree (aria snapshot `- button: Log In` — text content
// only), so the previous emission `getByRole('button', { name: <text>,
// exact: true })` could never bind: the form filter yielded 0 and every
// replay failed `expect(form).toHaveCount(1)` with `Expected: 1 |
// Received: 0` (koel-dg12-hostbound-run14/15, misattributed as
// ARXIC-VERIFY-APP-DEFECT). The name-or-text fallback binds named controls
// identically (union of one) and refuses — strict mode — when the two
// branches match DIFFERENT controls.
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

import { afterAll, beforeAll, expect, test } from 'vitest';
import { PlaywrightCompiler } from '../compiler';
import { buildFormFlowWorkflow } from '../form-flow';
import { startUnnamedSubmitApp, stopUnnamedSubmitApp } from '../test-support/unnamed-submit-app';

const execute = promisify(execFile);
const require = createRequire(import.meta.url);
const COMMIT = '0123456789abcdef0123456789abcdef01234567';
const PERSONA = {
  email: 'arxic-383@example.test',
  password: 'Arxic383Proof!',
};

let origin = '';
let server: Awaited<ReturnType<typeof startUnnamedSubmitApp>>['server'] | undefined;
const temporaryDirectories: string[] = [];

beforeAll(async () => {
  const running = await startUnnamedSubmitApp();
  origin = running.origin;
  server = running.server;
}, 60_000);

afterAll(async () => {
  if (server) await stopUnnamedSubmitApp(server);
  await Promise.all(temporaryDirectories.map((path) => rm(path, { recursive: true, force: true })));
});

function unnamedSubmitWorkflow(route: string, postActionRoute: string, heading: string) {
  const built = buildFormFlowWorkflow({
    identity: {
      id: 'authentication.login.unnamed-submit',
      title: 'Log in',
      domain: 'authentication',
      persona: 'registered-user',
    },
    route,
    fields: [
      { label: 'Your email address', inputRef: 'persona.email' },
      { label: 'Your password', inputRef: 'persona.password' },
    ],
    submitControlName: 'Log In',
    observation: {
      url: `${origin}${postActionRoute}`,
      headings: [heading],
      runtimeEvidenceRef: 'run:post-action-observation',
    },
    scope: { commit: COMMIT, environment: 'local-test', browser: 'chromium' },
    sourceEvidence: {
      ref: 'src:unnamed-submit-handler',
      path: 'packages/playwright-compiler/src/test-support/unnamed-submit-app.ts',
      range: [40, 70],
    },
    personaFacts: [{ fixture: 'user.exists' }],
  });
  if (!built.ok) throw new Error(JSON.stringify(built.diagnostics));
  return built.workflow;
}

async function compileAndRun(
  route: string,
  postActionRoute: string,
  heading: string,
): Promise<{ passed: boolean; output: string; spec: string }> {
  const outputDirectory = await mkdtemp(join(tmpdir(), 'arxic-383-submit-out-'));
  temporaryDirectories.push(outputDirectory);
  const compiler = new PlaywrightCompiler({ outputDirectory, origin, captureScreenshots: false });
  await compiler.compile(unnamedSubmitWorkflow(route, postActionRoute, heading), [
    {
      kind: 'source',
      repo: 'https://github.com/anthonykewl20/arxic',
      commit: COMMIT,
      path: 'packages/playwright-compiler/src/test-support/unnamed-submit-app.ts',
      startLine: 40,
      endLine: 70,
      blobSha256: 'a'.repeat(64),
      extractor: 'arxic-383-unnamed-submit',
    },
    {
      kind: 'runtime',
      runId: 'run-383-entry',
      appBuildDigest: 'b'.repeat(64),
      browser: 'chromium',
      browserVersion: '1.62.1',
      url: `${origin}${route}`,
      timestamp: new Date().toISOString(),
    },
  ]);
  const { readFile } = await import('node:fs/promises');
  const spec = await readFile(join(outputDirectory, 'tests/workflow.spec.ts'), 'utf8');
  const packageRoot = dirname(require.resolve('@playwright/test/package.json'));
  const scope = join(outputDirectory, 'node_modules', '@playwright');
  await mkdir(scope, { recursive: true });
  await symlink(packageRoot, join(scope, 'test'), 'dir');
  try {
    const result = await execute(process.execPath, [join(packageRoot, 'cli.js'), 'test'], {
      cwd: outputDirectory,
      maxBuffer: 16 * 1024 * 1024,
      timeout: 120_000,
      env: {
        ...process.env,
        ARXIC_INPUT_PERSONA_EMAIL: PERSONA.email,
        ARXIC_INPUT_PERSONA_PASSWORD: PERSONA.password,
      },
    });
    return { passed: true, output: result.stdout, spec };
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string };
    return { passed: false, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}`, spec };
  }
}

test('the unnamed (empty-accessible-name) submit control binds via the name-or-text fallback and the flow verifies', async () => {
  const result = await compileAndRun('/', '/done', 'Signed In');
  expect(result.output, result.output).toContain('1 passed');
  expect(result.output).not.toContain('strict mode violation');
  expect(result.output).not.toContain('Received: 0');
  // The emission binds the submit by name OR exact text, scoped in the form.
  expect(result.spec).toContain('submitControl(page, "Log In")');
  expect(result.spec).toContain('submitControl(form, "Log In").click()');
}, 240_000);

test('a genuinely ambiguous name/text pair still refuses (strict mode — no silent pick)', async () => {
  const result = await compileAndRun('/ambiguous', '/done', 'Signed In');
  expect(result.passed).toBe(false);
  expect(result.output, result.output).toContain('strict mode violation');
}, 240_000);

test('the fallback is a union — a control both named and texted resolves once (named-submit regression pin)', async () => {
  // The named-submit case is the existing redirect-login-app shape, covered
  // by observation-form-flow; this pins the emission-side property directly:
  // the helper's two branches must OR, not sequence (a sequenced
  // name-then-text fallback would mask ambiguity on named controls).
  const result = await compileAndRun('/', '/done', 'Signed In');
  expect(result.spec).toContain(".or(root.locator('button').filter({ hasText:");
}, 240_000);
