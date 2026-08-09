import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { inspectPlaywrightTrace } from '@arxic/playwright-trace-sanitizer';
import { ZipFile } from 'yazl';
import { M0Pipeline, retainRunArtifacts, verifyStagedSuite, type StagedSuitePass } from '..';
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
  it('rejects source-derived sensitive trace filenames and removes their raw bytes', async () => {
    const testDir = await mkdtemp(join(tmpdir(), 'arxic-exit-sensitive-name-'));
    const artifactsDir = await mkdtemp(join(tmpdir(), 'arxic-exit-trace-retained-'));
    const resultDirectory = join(testDir, 'test-results', 'run');
    const rawPath = join(resultDirectory, 'sessionOpaqueFilenameCanary.zip');
    await mkdir(resultDirectory, { recursive: true });
    await writeFile(rawPath, await sensitiveTrace('ordinary-value'));

    await expect(retainRunArtifacts(testDir, artifactsDir, 1, [])).rejects.toThrow(
      'filename rejected',
    );
    await expect(readFile(rawPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('sanitizes retained traces at the M0 artifact boundary and removes raw bytes', async () => {
    const testDir = await mkdtemp(join(tmpdir(), 'arxic-exit-trace-source-'));
    const artifactsDir = await mkdtemp(join(tmpdir(), 'arxic-exit-trace-retained-'));
    const resultDirectory = join(testDir, 'test-results', 'run');
    const rawPath = join(resultDirectory, 'trace.zip');
    const credential = 'm0-persona-credential';
    await mkdir(resultDirectory, { recursive: true });
    await writeFile(rawPath, await sensitiveTrace(credential));

    const artifacts = await retainRunArtifacts(testDir, artifactsDir, 1, [credential]);

    expect(artifacts.map(({ kind }) => kind)).toEqual(['trace', 'trace-sanitization-report']);
    await expect(readFile(rawPath)).rejects.toMatchObject({ code: 'ENOENT' });
    const trace = artifacts[0]!;
    await expect(
      inspectPlaywrightTrace({
        tracePath: trace.path,
        provenancePath: `${trace.path}.sanitization.json`,
        forbiddenSubstrings: [credential],
      }),
    ).resolves.toMatchObject({ ok: true });
  });

  it.each(['renamed-zip', 'png-trailing-zip', 'png-split-zip'] as const)(
    'rejects a %s trace carrier before M0 screenshot retention',
    async (variant) => {
      const testDir = await mkdtemp(join(tmpdir(), 'arxic-exit-carrier-source-'));
      const artifactsDir = await mkdtemp(join(tmpdir(), 'arxic-exit-carrier-retained-'));
      const resultDirectory = join(testDir, 'artifacts', 'screenshots');
      const source = join(resultDirectory, 'proof.png');
      const rawTrace = await sensitiveTrace('carrier-value');
      const split = Math.floor(rawTrace.byteLength / 2);
      const bytes =
        variant === 'renamed-zip'
          ? rawTrace
          : variant === 'png-trailing-zip'
            ? Buffer.concat([validPng(), rawTrace])
            : pngWithAncillaryPayloads([rawTrace.subarray(0, split), rawTrace.subarray(split)]);
      await mkdir(resultDirectory, { recursive: true });
      await writeFile(join(resultDirectory, '00-safe.png'), validPng());
      await writeFile(source, bytes);

      await expect(retainRunArtifacts(testDir, artifactsDir, 1, [])).rejects.toThrow(
        'strict trace-carrier-free PNG',
      );
      await expect(readFile(source)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(readdir(join(artifactsDir, 'verification', 'run-1'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    },
  );

  it('maps a rejected screenshot trace carrier to blocked without retained refs', async () => {
    const testDir = await mkdtemp(join(tmpdir(), 'arxic-exit-carrier-action-'));
    const artifactsDir = await mkdtemp(join(tmpdir(), 'arxic-exit-carrier-action-retained-'));
    const source = join(testDir, 'artifacts', 'screenshots', 'proof.png');
    await writeFile(join(testDir, 'workflow.spec.ts'), 'test');

    const result = await verifyStagedSuite({
      workflow: loginWorkflow(),
      origin: 'http://127.0.0.1:1',
      testDir,
      artifactsDir,
      persona: { email: 'user@example.test', password: 'Hunter2!' },
      policy: {
        requiredRuns: 1,
        forbidNetworkErrors: true,
        screenshotCheckpoints: ['home'],
        trace: 'discard',
      },
      resetAndSeed: async () => undefined,
      executeRun: async () => {
        await mkdir(join(testDir, 'artifacts', 'screenshots'), { recursive: true });
        await writeFile(source, await sensitiveTrace('carrier-value'));
        return {
          passed: true,
          artifacts: await retainRunArtifacts(testDir, artifactsDir, 1, []),
          observedTransitions: ['login-page->home'],
        };
      },
    });

    expect(result.outcome).toBe('blocked');
    expect(result.artifacts.map(({ kind }) => kind)).toEqual(['spec']);
    await expect(readFile(source)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects a safe but unrelated screenshot as required-checkpoint evidence', async () => {
    const testDir = await mkdtemp(join(tmpdir(), 'arxic-exit-checkpoint-source-'));
    const artifactsDir = await mkdtemp(join(tmpdir(), 'arxic-exit-checkpoint-retained-'));
    const screenshotDirectory = join(testDir, 'artifacts', 'screenshots');
    await mkdir(screenshotDirectory, { recursive: true });
    await writeFile(join(screenshotDirectory, 'step-1-login-page-profile.png'), validPng());

    await expect(retainRunArtifacts(testDir, artifactsDir, 1, [], ['home'])).rejects.toThrow(
      'Screenshot checkpoint mapping failed (missing-source)',
    );
    await expect(readdir(join(artifactsDir, 'verification', 'run-1'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('removes a malformed raw M0 trace and retains nothing when sanitization blocks', async () => {
    const testDir = await mkdtemp(join(tmpdir(), 'arxic-exit-trace-source-'));
    const artifactsDir = await mkdtemp(join(tmpdir(), 'arxic-exit-trace-retained-'));
    const resultDirectory = join(testDir, 'test-results', 'run');
    const rawPath = join(resultDirectory, 'trace.zip');
    await mkdir(resultDirectory, { recursive: true });
    await writeFile(rawPath, 'not a trace archive');

    await expect(retainRunArtifacts(testDir, artifactsDir, 1, [])).rejects.toThrow(
      'Trace sanitization failed',
    );
    await expect(readFile(rawPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

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
      expect(result.outcome, JSON.stringify(result.diagnostics)).toBe('contradicted');
      expect(result.runs).toEqual([{ passed: false }, { passed: false }]);
      expect(result.receipt).toBeUndefined();
      expect(result.diagnostics.map(({ code }) => code)).toContain('ARXIC-EXIT-PROMOTION-SKIPPED');
    });
  });
});

async function sensitiveTrace(value: string): Promise<Buffer> {
  const archive = new ZipFile();
  archive.addBuffer(
    Buffer.from(
      `${JSON.stringify({ type: 'context-options', version: 8, browserName: 'chromium' })}\n${JSON.stringify(
        {
          type: 'before',
          callId: 'call@1',
          startTime: 1,
          class: 'Frame',
          method: 'fill',
          params: { selector: 'internal:label=Password', value },
        },
      )}\n${JSON.stringify({ type: 'after', callId: 'call@1', endTime: 2 })}\n`,
    ),
    'trace.trace',
  );
  archive.end();
  const chunks: Buffer[] = [];
  for await (const chunk of archive.outputStream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function validPng(): Buffer {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  );
}

function pngWithAncillaryPayloads(payloads: readonly Buffer[]): Buffer {
  const png = validPng();
  const type = Buffer.from('raWx');
  const chunks = payloads.map((payload) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(payload.byteLength);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(testCrc32(Buffer.concat([type, payload])));
    return Buffer.concat([length, type, payload, crc]);
  });
  return Buffer.concat([
    png.subarray(0, png.byteLength - 12),
    ...chunks,
    png.subarray(png.byteLength - 12),
  ]);
}

function testCrc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

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
