// #379 real-world proof: the fallback-generator lane's text assertions must
// be strict-mode race-safe on the REAL reference-auth-app in real Chromium.
// The login page renders <h1>Login</h1> AND <button type="submit">Login</button>
// — two elements sharing the EXACT full text "Login". Pre-fix, a
// role-qualified intent (`text@heading:Login`) fell into the generic
// containment branch and asserted the literal grammar string (guaranteed
// miss), and plain `text:` intents resolved every element CONTAINING the
// text (strict-mode-fragile under render races). The role-scoped exact
// emission must resolve the h1 uniquely through the real race AND still
// fail when the heading is absent (race-safety is not traded for
// blindness).
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Workflow } from '@arxic/contracts';
import {
  SCREENSHOT_CAPTURE_CORRELATION_ENV,
  SCREENSHOT_CAPTURED_AT_ENV,
  SCREENSHOT_PRIVACY_POLICY_ENV,
  SCREENSHOT_PRIVACY_POLICY_SHA256_ENV,
  serializeScreenshotPrivacyPolicy,
} from '@arxic/playwright-screenshot-privacy';
import { bootFixtureApp, referenceAuthApp, stopApp } from '@arxic/real-world-testkit';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { generateSpecFromWorkflow, runFallback } from '../fallback-generator';

const root = fileURLToPath(new URL('../../../../', import.meta.url));

let origin = '';
let child: Awaited<ReturnType<typeof bootFixtureApp>>['child'] | undefined;
let runtimeDirectory = '';
const temporaryProjects: string[] = [];

beforeAll(async () => {
  const running = await bootFixtureApp(root, referenceAuthApp, 'arxic-379-fallback-race');
  origin = running.origin;
  child = running.child;
  runtimeDirectory = running.runtimeDirectory;
}, 240_000);

afterAll(async () => {
  await stopApp(child);
  await rm(runtimeDirectory, { recursive: true, force: true });
  await Promise.all(temporaryProjects.map((path) => rm(path, { recursive: true, force: true })));
});

function raceWorkflow(id: string, fromState: string, toState: string, assertion: string): Workflow {
  return {
    $schema: 'https://arxic.dev/schemas/workflow/v1.json',
    id,
    version: 1,
    title: 'Fallback text race proof',
    domain: 'authentication',
    persona: 'anonymous',
    status: 'observed',
    confidence: 1,
    scope: {
      commit: '0123456789abcdef0123456789abcdef01234567',
      environment: 'local-test',
      browser: 'chromium',
    },
    preconditions: [],
    states: [{ id: fromState }, { id: toState }],
    transitions: [
      {
        from: fromState,
        to: toState,
        action: { intent: 'open Login' },
        assertions: [{ intent: assertion }],
        evidenceRefs: ['run:login'],
      },
    ],
    negativeCases: [],
    verification: {
      requiredRuns: 1,
      screenshotCheckpoints: [toState],
      forbidNetworkErrors: true,
      trace: 'retain',
    },
    evidenceRefs: ['run:login'],
  };
}

// Mirrors the #366 proof shape: the screenshot policy approves the page's
// real heading region so the fallback's policy screenshot capture passes
// for a green run (failed runs never reach the capture).
async function withScreenshotPolicy<T>(heading: string, run: () => Promise<T>): Promise<T> {
  const policy = serializeScreenshotPrivacyPolicy({
    schemaVersion: 1,
    id: 'fallback-text-race-policy',
    authority: {
      kind: 'repository-policy',
      reference: 'docs/evidence/FIX-379/README.md',
      recordedAt: '2026-09-04T12:00:00.000Z',
    },
    capture: {
      mode: 'approved-region',
      region: { kind: 'role', role: 'heading', name: heading, exact: true },
      masks: [],
    },
  });
  const environment = {
    [SCREENSHOT_PRIVACY_POLICY_ENV]: policy.json,
    [SCREENSHOT_PRIVACY_POLICY_SHA256_ENV]: policy.sha256,
    [SCREENSHOT_CAPTURE_CORRELATION_ENV]: 'fallback-379-race-correlation-0001',
    [SCREENSHOT_CAPTURED_AT_ENV]: '2026-09-04T12:01:00.000Z',
  };
  const previous = new Map(
    Object.keys(environment).map((name) => [name, process.env[name]] as const),
  );
  Object.assign(process.env, environment);
  try {
    return await run();
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

async function generateAndRun(
  id: string,
  fromState: string,
  toState: string,
  assertion: string,
  heading: string,
): Promise<Awaited<ReturnType<typeof runFallback>>> {
  const testDir = await mkdtemp(join(tmpdir(), 'arxic-379-fallback-run-'));
  temporaryProjects.push(testDir);
  const generated = await generateSpecFromWorkflow(
    raceWorkflow(id, fromState, toState, assertion),
    {
      origin,
      testDir,
    },
  );
  expect(generated.ok, generated.diagnostics.map((item) => item.message).join('; ')).toBe(true);
  return withScreenshotPolicy(heading, () => runFallback({ testDir }));
}

test('the role-qualified heading assertion resolves uniquely through the real strict-mode collision', async () => {
  const result = await generateAndRun(
    'authentication.replay.fallback-heading-race',
    'login-page',
    'login-verified',
    'text@heading:Login',
    'Login',
  );
  expect(result.output, result.output).toContain('1 passed');
  expect(result.output).not.toContain('strict mode violation');
  expect(result.passed).toBe(1);
  expect(result.disposition).toBe('observed');
}, 240_000);

test('the heading assertion still fails when the heading is absent (no blindness traded for race-safety)', async () => {
  const result = await generateAndRun(
    'authentication.replay.fallback-heading-absent',
    'login-page',
    'login-verified',
    'text@heading:Nothing Renders This Heading',
    'Login',
  );
  expect(result.passed).toBe(0);
  expect(result.failed).toBeGreaterThanOrEqual(1);
  expect(result.output, result.output).toContain('Nothing Renders This Heading');
}, 240_000);

test('a plain text assertion resolves exactly on the anonymous home surface', async () => {
  const result = await generateAndRun(
    'authentication.replay.fallback-plain-text',
    'home',
    'home-verified',
    'text:Logged out',
    'Reference Auth App',
  );
  expect(result.output, result.output).toContain('1 passed');
  expect(result.passed).toBe(1);
  expect(result.disposition).toBe('observed');
}, 240_000);
