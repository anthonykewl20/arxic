import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { StagedBundle } from '@arxic/contracts';

const commit = '0123456789abcdef0123456789abcdef01234567';
const digest = 'a'.repeat(64);

export async function stagedBundle(runId = 'promotion-run-1'): Promise<StagedBundle> {
  const artifactPath = resolve('test-fixtures/reference-auth-app/app/login/actions.ts');
  const artifactBytes = await readFile(artifactPath);
  const artifactSha = createHash('sha256').update(artifactBytes).digest('hex');
  const timestamp = '2026-08-05T12:00:00.000Z';
  return {
    manifest: {
      schemaVersion: 1,
      bundleVersion: 1,
      workflow: { id: 'authentication.login', status: 'observed' },
      repository: 'https://github.com/anthonykewl20/arxic',
      commit,
      appBuildDigest: digest,
      environment: { class: 'local-test', browser: 'chromium' },
      generator: { id: '@arxic/playwright-agent-adapter', version: '0.0.0' },
      verification: {
        requiredRuns: 1,
        runs: [{ startedAt: timestamp, finishedAt: timestamp, passed: true }],
      },
      fileHashes: [{ path: artifactPath, sha256: artifactSha }],
      gateResults: [{ gate: 'execution', passed: true }],
      coverage: { denominator: 1, verified: 0, uncovered: 1 },
      runId,
    },
    workflow: {
      $schema: 'https://arxic.dev/schemas/workflow/v1.json',
      id: 'authentication.login',
      version: 1,
      title: 'Login',
      domain: 'authentication',
      persona: 'registered-user',
      status: 'observed',
      confidence: 1,
      scope: { commit, environment: 'local-test', browser: 'chromium' },
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
          assertions: [{ intent: 'The authenticated home page is shown' }],
          evidenceRefs: ['run:login'],
        },
      ],
      negativeCases: [],
      verification: {
        requiredRuns: 1,
        screenshotCheckpoints: ['home'],
        forbidNetworkErrors: true,
        trace: 'retain',
      },
      evidenceRefs: ['run:login'],
    },
    evidenceIndex: {
      'run:login': {
        kind: 'runtime',
        runId,
        appBuildDigest: digest,
        browser: 'chromium',
        browserVersion: '140.0.0',
        url: 'http://127.0.0.1:3000/login',
        timestamp,
        traceRef: 'artifacts/traces/login.zip',
      },
    },
    artifacts: [{ kind: 'source', path: artifactPath, sha256: artifactSha }],
    plan: '# Login\n\nSubmit seeded credentials and assert the authenticated home page.\n',
  };
}
