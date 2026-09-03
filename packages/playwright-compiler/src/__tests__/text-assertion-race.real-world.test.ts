// #366 real-world proof (gate-finding from PR #365 CI): generated `text:`
// assertions must be strict-mode race-safe on the REAL reference-auth-app.
// The login page renders <h1>Login</h1> AND <button type="submit">Login</button>
// — two elements sharing the EXACT full text "Login" — while the pre-navigation
// home page carries a "Login" nav link. The old unscoped substring emission
// either strict-mode-violated on the pair (ARXIC-VERIFY-RUN-FAILURE flakes) or
// passed spuriously against the still-mounted home DOM. The role-qualified
// heading intent must resolve the h1 uniquely AND still fail when the heading
// is absent (race-safety is not traded for blindness).
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import type { EvidenceRef, Workflow } from '@arxic/contracts';
import {
  bootFixtureApp,
  loginObservations,
  referenceAuthApp,
  stopApp,
} from '@arxic/real-world-testkit';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { PlaywrightCompiler } from '../compiler';

const execute = promisify(execFile);
const require = createRequire(import.meta.url);
// Four levels up from src/__tests__ (the verifier suites sit one level
// shallower — do not copy their three-level URL blindly).
const root = fileURLToPath(new URL('../../../../', import.meta.url));

let origin = '';
let child: Awaited<ReturnType<typeof bootFixtureApp>>['child'] | undefined;
let runtimeDirectory = '';

beforeAll(async () => {
  const running = await bootFixtureApp(root, referenceAuthApp, 'arxic-366-text-race');
  origin = running.origin;
  child = running.child;
  runtimeDirectory = running.runtimeDirectory;
}, 240_000);

afterAll(async () => {
  await stopApp(child);
  await rm(runtimeDirectory, { recursive: true, force: true });
});

// The pre-#365 flake shape: home → login-page asserting the page by text.
// The runtime observation url is overridden to the home entry (exactly like
// apps/cli third-party-replay) so the first goto boots on home and the
// action drives the real navigation race.
function anonymousLoginObservations(): EvidenceRef[] {
  const observations = loginObservations(referenceAuthApp, origin, 'arxic-366-text-race');
  const runtime = observations[1];
  if (!runtime || runtime.kind !== 'runtime') throw new Error('Expected runtime EvidenceRef');
  observations[1] = { ...runtime, url: `${origin}/` };
  return observations;
}

function anonymousLoginWorkflow(assertion: string): Workflow {
  return {
    $schema: 'https://arxic.dev/schemas/workflow/v1.json',
    id: 'authentication.replay.anonymous-login-text-race',
    version: 1,
    title: 'Replay anonymous login surface (text race proof)',
    domain: 'authentication',
    persona: 'registered-user',
    status: 'observed',
    confidence: 1,
    scope: {
      commit: '0123456789abcdef0123456789abcdef01234567',
      environment: 'local-test',
      browser: 'chromium',
    },
    preconditions: [],
    states: [{ id: 'home' }, { id: 'login-page' }],
    transitions: [
      {
        from: 'home',
        to: 'login-page',
        action: { intent: 'open Login' },
        assertions: [{ intent: assertion }],
        evidenceRefs: ['src:login-handler', 'run:login'],
      },
    ],
    negativeCases: [],
    verification: {
      requiredRuns: 2,
      screenshotCheckpoints: ['login-page'],
      forbidNetworkErrors: true,
      trace: 'retain',
    },
    evidenceRefs: ['src:login-handler', 'run:login'],
  };
}

async function compileAndRun(assertion: string): Promise<{ passed: boolean; output: string }> {
  const outputDirectory = await mkdtemp(join(tmpdir(), 'arxic-366-race-out-'));
  try {
    await new PlaywrightCompiler({
      outputDirectory,
      origin,
      captureScreenshots: false,
    }).compile(anonymousLoginWorkflow(assertion), anonymousLoginObservations());
    const packageRoot = dirname(require.resolve('@playwright/test/package.json'));
    const scope = join(outputDirectory, 'node_modules', '@playwright');
    await mkdir(scope, { recursive: true });
    await symlink(packageRoot, join(scope, 'test'), 'dir');
    try {
      const result = await execute(process.execPath, [join(packageRoot, 'cli.js'), 'test'], {
        cwd: outputDirectory,
        maxBuffer: 16 * 1024 * 1024,
        timeout: 120_000,
      });
      return { passed: true, output: result.stdout };
    } catch (error) {
      const failure = error as { stdout?: string; stderr?: string };
      return { passed: false, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` };
    }
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
}

test('the role-qualified heading assertion resolves uniquely through the real navigation race', async () => {
  const result = await compileAndRun('text@heading:Login');
  expect(result.output, result.output).toContain('1 passed');
  expect(result.output).not.toContain('strict mode violation');
}, 240_000);

test('the heading assertion still fails when the heading is absent (no blindness traded for race-safety)', async () => {
  const result = await compileAndRun('text@heading:Nothing Renders This Heading');
  expect(result.passed).toBe(false);
  expect(result.output, result.output).toContain('1 failed');
  expect(result.output).toContain('Nothing Renders This Heading');
}, 240_000);
