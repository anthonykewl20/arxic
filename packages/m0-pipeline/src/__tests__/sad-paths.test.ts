import { createServer } from 'node:http';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { M0Pipeline, verifyStagedSuite, type StagedSuitePass } from '..';
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

  it.each(['config', 'spec'] as const)(
    'blocks when the generated %s instrumentation seam drifts',
    async (drift) => {
      await withAttestedTarget(async (origin, artifactsDir) => {
        const pipeline = new M0Pipeline({
          generateSpec: async (_workflow, { testDir }) => {
            const specPath = join(testDir, 'workflow.spec.ts');
            const configPath = join(testDir, 'playwright.config.ts');
            await mkdir(testDir, { recursive: true });
            await writeFile(
              specPath,
              drift === 'spec'
                ? "import { test, expect } from '@playwright/test';\ntest('x');\n"
                : "import { test, expect } from '@playwright/test';\n\ntest('x');\n",
            );
            await writeFile(
              configPath,
              drift === 'config'
                ? "export default { use: { trace: 'off' } };\n"
                : "export default { use: { trace: 'retain-on-failure' } };\n",
            );
            return { ok: true, specPath, configPath, diagnostics: [] };
          },
        });
        const result = await pipeline.run(pipelineInput(origin, artifactsDir));
        expect(result.outcome).toBe('blocked');
        expect(result.diagnostics.map(({ code }) => code)).toContain('ARXIC-EXIT-COMPILE-FAILED');
        expect(result.runs).toEqual([]);
      });
    },
  );

  it('does not promote a pipeline-level contradicted result', async () => {
    await withAttestedTarget(async (origin, artifactsDir) => {
      const pipeline = new M0Pipeline({
        generateSpec: async (_workflow, { testDir }) => {
          const specPath = join(testDir, 'workflow.spec.ts');
          const configPath = join(testDir, 'playwright.config.ts');
          await mkdir(testDir, { recursive: true });
          await writeFile(
            specPath,
            `import { test, expect } from '@playwright/test';\n\ntest('x', async ({ page }) => { await page.goto(${JSON.stringify(origin)}); expect(false).toBe(true); });\n`,
          );
          await writeFile(configPath, "export default { use: { trace: 'retain-on-failure' } };\n");
          return { ok: true, specPath, configPath, diagnostics: [] };
        },
      });
      const result = await pipeline.run(pipelineInput(origin, artifactsDir));
      expect(result.outcome).toBe('contradicted');
      expect(result.runs).toEqual([{ passed: false }, { passed: false }]);
      expect(result.receipt).toBeUndefined();
      expect(result.diagnostics.map(({ code }) => code)).toContain('ARXIC-EXIT-PROMOTION-SKIPPED');
    });
  });
});

async function withAttestedTarget(
  test: (origin: string, artifactsDir: string) => Promise<void>,
): Promise<void> {
  const artifactsDir = await mkdtemp(join(tmpdir(), 'arxic-exit-pipeline-sad-'));
  let origin = '';
  const server = createServer((_request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(
      JSON.stringify({
        environmentClass: 'local-test',
        origin,
        allowedOrigins: [origin],
        buildDigest: 'a'.repeat(64),
        nonce: 'reference-auth-app-fixture-v1',
      }),
    );
  });
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not allocate test port');
  origin = `http://127.0.0.1:${address.port}`;
  try {
    await test(origin, artifactsDir);
  } finally {
    await new Promise<void>((resolveClose, reject) =>
      server.close((error) => (error ? reject(error) : resolveClose())),
    );
  }
}

function pipelineInput(origin: string, artifactsDir: string) {
  return {
    candidate: loginWorkflow(),
    target: {
      origin,
      appDir: artifactsDir,
      commit: '0123456789abcdef0123456789abcdef01234567',
      appBuildDigest: 'a'.repeat(64),
    },
    rulepacksDir: join(artifactsDir, 'missing-rulepacks'),
    artifactsDir,
    persona: { email: 'user@example.test', password: 'Hunter2!' },
  };
}
