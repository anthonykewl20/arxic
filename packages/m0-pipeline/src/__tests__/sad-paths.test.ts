import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { verifyStagedSuite, type StagedSuitePass } from '..';
import { loginWorkflow } from './workflow-fixture';

const artifact = (kind: 'screenshot' | 'trace', run: number) => ({
  kind,
  path: `/runtime/run-${run}/${kind}`,
  sha256: String(run).repeat(64),
});

async function scriptedVerifier(
  passes: boolean[],
  observations: string[][] = passes.map((passed) => (passed ? ['login-page->home'] : [])),
) {
  const testDir = await mkdtemp(join(tmpdir(), 'arxic-exit-sad-'));
  await writeFile(join(testDir, 'workflow.spec.ts'), 'test');
  return verifyStagedSuite({
    workflow: loginWorkflow(),
    origin: 'http://127.0.0.1:1',
    testDir,
    artifactsDir: testDir,
    persona: { email: 'user@example.test', password: 'Hunter2!' },
    policy: { requiredRuns: 2, forbidNetworkErrors: true, trace: 'retain' },
    resetAndSeed: async () => undefined,
    executeRun: async (run): Promise<StagedSuitePass> => ({
      passed: passes[run - 1] ?? false,
      artifacts: [artifact('screenshot', run), artifact('trace', run)],
      observedTransitions: observations[run - 1] ?? [],
    }),
  });
}

describe('M0 exit sad paths', () => {
  it('classifies one pass and one failure as contradicted flaky runs without promotion', async () => {
    const result = await scriptedVerifier([true, false]);
    expect(result.outcome).toBe('contradicted');
    expect(result.runs).toEqual([{ passed: true }, { passed: false }]);
    expect(result.diagnostics.map(({ code }) => code)).toContain('ARXIC-EXIT-FLAKY-RUNS');
    expect(result).not.toHaveProperty('receipt');
  });

  it('classifies an app defect that fails both runs as contradicted without promotion', async () => {
    const result = await scriptedVerifier(
      [false, false],
      [['login-page->home'], ['login-page->home']],
    );
    expect(result.outcome).toBe('contradicted');
    expect(result.runs).toEqual([{ passed: false }, { passed: false }]);
    expect(result.diagnostics.map(({ code }) => code)).toContain(
      'ARXIC-EXIT-APP-DEFECT-CONTRADICTED',
    );
    expect(result).not.toHaveProperty('receipt');
  });

  it('blocks when a required transition has no runtime observation', async () => {
    const result = await scriptedVerifier([true, true], [[], []]);
    expect(result.outcome).toBe('blocked');
    expect(result.diagnostics.map(({ code }) => code)).toContain(
      'ARXIC-EXIT-EVIDENCE-GATE-BLOCKED',
    );
    expect(result).not.toHaveProperty('receipt');
  });
});
