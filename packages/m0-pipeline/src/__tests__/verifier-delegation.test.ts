import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { verifyStagedSuite } from '..';
import { loginWorkflow } from './workflow-fixture';

const classifier = vi.hoisted(() =>
  vi.fn(() => ({ outcome: 'verified' as const, diagnostics: [] })),
);

vi.mock('@arxic/verifier', () => ({
  ARXIC_VERIFY_SUITE_UNAVAILABLE: 'ARXIC-VERIFY-SUITE-UNAVAILABLE',
  artifactRef: async (kind: string, path: string) => ({ kind, path, sha256: 'a'.repeat(64) }),
  captureRunArtifacts: vi.fn(async () => []),
  classifyVerification: classifier,
  verifyDiagnostic: (code: string, severity: string, subject: string, message: string) => ({
    code,
    severity,
    subject,
    message,
  }),
}));

describe('M0 verifier delegation', () => {
  it('delegates the deterministic verification decision to @arxic/verifier', async () => {
    const testDir = await mkdtemp(join(tmpdir(), 'arxic-verifier-delegation-'));
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
        passed: true,
        browserVersion: '140.0.0',
        artifacts: [
          { kind: 'screenshot', path: `/run-${run}.png`, sha256: 'c'.repeat(64) },
          { kind: 'trace', path: `/run-${run}.zip`, sha256: 'd'.repeat(64) },
        ],
        observedTransitions: ['login-page->home'],
      }),
    });

    expect(result.outcome).toBe('verified');
    expect(classifier).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: 'authentication.login',
        policy: expect.objectContaining({ requiredRuns: 2 }),
        runs: [{ passed: true }, { passed: true }],
      }),
    );
  });
});
