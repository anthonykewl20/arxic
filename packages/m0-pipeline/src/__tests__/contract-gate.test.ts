import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BundleManifest } from '@arxic/contracts';
import { validateDiagnostic, validateManifest } from '@arxic/contracts';
import { ARXIC_VERIFY_SUITE_UNAVAILABLE } from '@arxic/verifier';
import { describe, expect, it } from 'vitest';
import { EXIT_DIAGNOSTIC_CODES, exitDiagnostic, verifyStagedSuite } from '..';
import { loginWorkflow } from './workflow-fixture';

describe('M0 exit contract gate', () => {
  it('loop-closes every ARXIC-EXIT diagnostic through the frozen validator', () => {
    for (const code of EXIT_DIAGNOSTIC_CODES) {
      expect(
        validateDiagnostic(exitDiagnostic(code, 'blocked', 'm0-exit', 'Contract proof')),
      ).toEqual(expect.objectContaining({ ok: true }));
    }
  });

  it('validates the manufactured promoted manifest through the frozen schema', () => {
    const timestamp = '2026-08-05T18:00:00.000Z';
    const manifest: BundleManifest = {
      schemaVersion: 1,
      bundleVersion: 1,
      workflow: { id: 'authentication.login', status: 'verified' },
      repository: 'file:///tmp/reference-auth-app',
      commit: '0123456789abcdef0123456789abcdef01234567',
      appBuildDigest: 'a'.repeat(64),
      environment: { class: 'local-test', browser: 'chromium', persona: 'registered-user' },
      generator: { id: '@arxic/m0-pipeline', version: '0.0.0' },
      verification: {
        requiredRuns: 2,
        runs: [
          { startedAt: timestamp, finishedAt: timestamp, passed: true },
          { startedAt: timestamp, finishedAt: timestamp, passed: true },
        ],
      },
      fileHashes: [{ path: '/tmp/workflow.spec.ts', sha256: 'b'.repeat(64) }],
      gateResults: [
        { gate: 'attestation', passed: true },
        { gate: 'verify', passed: true },
      ],
      coverage: { denominator: 1, verified: 1 },
      runId: 'm0-exit-contract',
    };
    expect(validateManifest(manifest)).toEqual(expect.objectContaining({ ok: true }));
  });

  it.each([
    [[true, true], 'verified'],
    [[true, false], 'contradicted'],
    [[false, false], 'contradicted'],
  ] as const)('maps %j deterministically to %s', async (passes, expected) => {
    const testDir = await mkdtemp(join(tmpdir(), 'arxic-exit-contract-'));
    await writeFile(join(testDir, 'workflow.spec.ts'), 'test');
    const result = await verifyStagedSuite({
      workflow: loginWorkflow(),
      origin: 'http://127.0.0.1:1',
      testDir,
      artifactsDir: testDir,
      persona: { email: 'user@example.test', password: 'Hunter2!' },
      policy: { requiredRuns: 2, forbidNetworkErrors: true, trace: 'retain' },
      resetAndSeed: async () => undefined,
      executeRun: async (run) => ({
        passed: passes[run - 1] ?? false,
        browserVersion: '140.0.0',
        artifacts: [
          { kind: 'screenshot', path: `/run-${run}.png`, sha256: 'c'.repeat(64) },
          { kind: 'trace', path: `/run-${run}.zip`, sha256: 'd'.repeat(64) },
        ],
        observedTransitions: ['login-page->home'],
      }),
    });
    expect(result.outcome).toBe(expected);
  });

  it('blocks a zero-run policy even when every transition is optional', async () => {
    const workflow = loginWorkflow();
    workflow.transitions = workflow.transitions.map((transition) => ({
      ...transition,
      required: false,
    }));
    const result = await verifyStagedSuite({
      workflow,
      origin: 'http://127.0.0.1:1',
      testDir: '/suite-is-not-read-for-zero-runs',
      artifactsDir: '/artifacts-are-not-read-for-zero-runs',
      persona: { email: 'user@example.test', password: 'Hunter2!' },
      policy: { requiredRuns: 0, forbidNetworkErrors: true },
    });
    expect(result.outcome).toBe('blocked');
    expect(result.runs).toEqual([]);
    expect(result.diagnostics.map(({ code }) => code)).toContain(ARXIC_VERIFY_SUITE_UNAVAILABLE);
  });
});
