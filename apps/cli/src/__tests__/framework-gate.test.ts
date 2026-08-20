import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '@arxic/contracts';
import type { RunExecutor, RunResult } from '../executor';
import { runAction } from '../run';

const execute = promisify(execFile);
const root = resolve(import.meta.dirname, '../../../..');
const rulepacksDir = resolve(root, 'rulepacks');
const koelEvidenceDir = resolve(
  root,
  'packages/ast-grep-adapter/src/__tests__/fixtures/framework-evidence/koel',
);
const gitEnvironment = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Arxic Test',
  GIT_COMMITTER_NAME: 'Arxic Test',
  GIT_AUTHOR_EMAIL: 'test@arxic.invalid',
  GIT_COMMITTER_EMAIL: 'test@arxic.invalid',
  GIT_AUTHOR_DATE: '2026-08-17T12:00:00Z',
  GIT_COMMITTER_DATE: '2026-08-17T12:00:00Z',
};

function configYaml(frameworks: string[], repository: string, languages: string[]): string {
  return `version: 1
source:
  repository: ${repository}
  revision: HEAD
  languages: [${languages.join(', ')}]
scope:
  domains: [authentication]
  frameworks: [${frameworks.join(', ')}]
  browsers: [chromium]
  personas: [anonymous]
target:
  origin: http://127.0.0.1:1
  environmentClass: local-test
  attestationPath: /.well-known/arxic-test-target.json
  allowedOrigins: [http://127.0.0.1:1]
policy:
  maxUrls: 10
  maxDepth: 2
  maxRuntimeMinutes: 5
  mutation: leased-fixtures-only
  externalNetwork: deny
  screenshots: transition-checkpoints
  trace: retain
  humanApproval: []
fixtures: {}
models:
  provider: configured-adapter
  sourceRetention: disabled
`;
}

// Executor that records whether the pipeline was ever reached.
function recordingExecutor(calls: string[]): RunExecutor {
  const result: RunResult = {
    runId: 'gate-test',
    status: 'completed',
    outcome: 'observed',
    diagnostics: [],
    runDirectory: '/tmp/arxic-gate-test-unused',
    state: {
      runId: 'gate-test',
      status: 'completed',
      outcome: 'observed',
      completedStages: [],
      artifacts: {},
      checkpoints: [],
      diagnostics: [],
      promotionEligible: false,
    },
  };
  return {
    async execute(): Promise<RunResult> {
      calls.push('executed');
      return result;
    },
  };
}

async function scenario(options: {
  frameworks: string[];
  files?: Record<string, string>;
  rulepacksDir?: string;
  languages?: string[];
}): Promise<{ exitCode: number; diagnostics: readonly Diagnostic[]; executed: string[] }> {
  const directory = await mkdtemp(join(tmpdir(), 'arxic-fw-cli-'));
  for (const [path, content] of Object.entries(options.files ?? {}))
    await writeFile(join(directory, path), content);
  await writeFile(
    join(directory, 'arxic.yaml'),
    configYaml(options.frameworks, directory, options.languages ?? ['typescript']),
    'utf8',
  );
  // Real runs resolve a commit with git, so the gate scenario is a committed
  // repository — the same shape runAction drives in production.
  await execute('git', ['init', '--initial-branch=main'], { cwd: directory, env: gitEnvironment });
  await execute('git', ['add', '.'], { cwd: directory, env: gitEnvironment });
  await execute('git', ['commit', '-m', 'gate scenario'], {
    cwd: directory,
    env: gitEnvironment,
  });
  const executed: string[] = [];
  const outcome = await runAction({
    configPath: 'arxic.yaml',
    out: 'runs',
    runId: 'gate-test',
    cwd: directory,
    executor: recordingExecutor(executed),
    rulepacksDir: options.rulepacksDir ?? rulepacksDir,
    now: () => '2026-08-17T12:00:00.000Z',
  });
  return { exitCode: outcome.exitCode, diagnostics: outcome.diagnostics, executed };
}

// The pinned koel composer fixtures (frozen digests in issue #283): real
// evidence files from koel @ dfec91ff… resolving laravel/framework v13.24.0.
async function koelFiles(extra: Record<string, string> = {}): Promise<Record<string, string>> {
  return {
    'composer.json': await readFile(join(koelEvidenceDir, 'composer.json'), 'utf8'),
    'composer.lock': await readFile(join(koelEvidenceDir, 'composer.lock'), 'utf8'),
    ...extra,
  };
}

const laravelV14Lock = JSON.stringify(
  { packages: [{ name: 'laravel/framework', version: 'v14.0.0' }] },
  undefined,
  2,
);

describe('DG-10 CLI config gate: framework verdicts fail fast or proceed per pack range', () => {
  it('frameworks: [laravel] with the pinned koel composer fixtures is ACCEPTED (13.24.0, lockfile tier) and reaches the executor (issue #283 flip)', async () => {
    const outcome = await scenario({
      frameworks: ['laravel'],
      languages: ['php'],
      files: await koelFiles(),
    });
    expect(outcome.executed).toEqual(['executed']);
    expect(outcome.exitCode).not.toBe(2);
    expect(outcome.diagnostics.filter((diagnostic) => diagnostic.severity === 'blocked')).toEqual(
      [],
    );
    const accepted = outcome.diagnostics.find(
      (diagnostic) => diagnostic.code === 'ARXIC-RULES-FRAMEWORK-ACCEPTED',
    );
    expect(accepted).toMatchObject({ severity: 'observed', subject: 'framework:laravel' });
    expect(accepted?.message).toContain('13.24.0');
    expect(accepted?.message).toContain('lockfile');
    expect(accepted?.message).toContain('laravel-auth@0.1.0');
    expect(accepted?.message).toContain('>=13 <14');
    expect(JSON.stringify(outcome.diagnostics)).not.toContain('/tmp/');
  });

  it('a framework with no installed pack still exits 2 before any crawl, with a path-free unknown-framework diagnostic (AC-5)', async () => {
    const outcome = await scenario({ frameworks: ['symfony'] });
    expect(outcome.executed).toEqual([]);
    expect(outcome.exitCode).toBe(2);
    const unknown = outcome.diagnostics.find(
      (diagnostic) => diagnostic.code === 'ARXIC-RULES-FRAMEWORK-UNKNOWN',
    );
    expect(unknown).toMatchObject({ severity: 'blocked', subject: 'framework:symfony' });
    expect(JSON.stringify(outcome.diagnostics)).not.toContain('/tmp/');
    expect(JSON.stringify(outcome.diagnostics)).not.toContain(rulepacksDir);
  });

  it('SP-3 — frameworks: [laravel] with composer.lock pinning v14.0.0 exits 2 pre-crawl (REJECTED blocked)', async () => {
    const outcome = await scenario({
      frameworks: ['laravel'],
      languages: ['php'],
      files: { 'composer.lock': laravelV14Lock },
    });
    expect(outcome.executed).toEqual([]);
    expect(outcome.exitCode).toBe(2);
    const rejected = outcome.diagnostics.find(
      (diagnostic) => diagnostic.code === 'ARXIC-RULES-FRAMEWORK-REJECTED',
    );
    expect(rejected).toMatchObject({ severity: 'blocked', subject: 'framework:laravel' });
    expect(rejected?.message).toContain('14.0.0');
    expect(rejected?.message).toContain('>=13 <14');
    expect(JSON.stringify(outcome.diagnostics)).not.toContain('/tmp/');
  });

  it('SP-4 — an exact-match arxic.waivers.json waives the laravel v14 rejection; a malformed waiver fails closed', async () => {
    const waiver = {
      version: 1,
      frameworkWaivers: [
        {
          framework: 'laravel',
          version: '14.0.0',
          packVersionRange: '>=13 <14',
          reason: 'operator reviewed laravel-auth rules against Laravel 14',
          approvedBy: 'anthonykewl20',
          recordedAt: '2026-08-20T00:00:00.000Z',
        },
      ],
    };
    const waived = await scenario({
      frameworks: ['laravel'],
      languages: ['php'],
      files: {
        'composer.lock': laravelV14Lock,
        'arxic.waivers.json': JSON.stringify(waiver, undefined, 2),
      },
    });
    expect(waived.executed).toEqual(['executed']);
    expect(waived.exitCode).not.toBe(2);
    expect(waived.diagnostics.filter((diagnostic) => diagnostic.severity === 'blocked')).toEqual(
      [],
    );
    expect(
      waived.diagnostics.some((diagnostic) => diagnostic.code === 'ARXIC-RULES-FRAMEWORK-WAIVED'),
    ).toBe(true);

    const malformed = await scenario({
      frameworks: ['laravel'],
      languages: ['php'],
      files: { 'composer.lock': laravelV14Lock, 'arxic.waivers.json': '{ not json' },
    });
    expect(malformed.executed).toEqual([]);
    expect(malformed.exitCode).toBe(2);
    expect(
      malformed.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === 'ARXIC-RULES-WAIVER-INVALID' && diagnostic.severity === 'blocked',
      ),
    ).toBe(true);
  });

  it('SP-2 — frameworks: [laravel] with no laravel version evidence proceeds UNDETECTED (observed, non-blocking)', async () => {
    // The CLI gate layer deliberately elides ARXIC-RULES-FRAMEWORK-UNDETECTED
    // from the pre-crawl record (config/framework-gate.ts filters it — the
    // same non-blocking path the pre-#283 express workaround rode); the
    // UNDETECTED-on-record diagnostic itself is asserted at the adapter level
    // in packages/ast-grep-adapter/src/__tests__/framework-gate.test.ts. Here
    // the observable is: the run proceeds, nothing is blocked.
    const outcome = await scenario({
      frameworks: ['laravel'],
      languages: ['php'],
      files: { 'index.ts': 'export const ok = true;\n' },
    });
    expect(outcome.executed).toEqual(['executed']);
    expect(outcome.exitCode).not.toBe(2);
    expect(outcome.diagnostics.filter((diagnostic) => diagnostic.severity === 'blocked')).toEqual(
      [],
    );
    expect(
      outcome.diagnostics.some((diagnostic) => diagnostic.code.startsWith('ARXIC-RULES-FRAMEWORK')),
    ).toBe(false);
  });

  it('an out-of-range framework version exits 2 before any crawl (fail fast, no run directory)', async () => {
    const outcome = await scenario({
      frameworks: ['nextjs'],
      files: {
        'package.json': JSON.stringify(
          { name: 'next-17-app', dependencies: { next: '17.0.0' } },
          undefined,
          2,
        ),
      },
    });
    expect(outcome.executed).toEqual([]);
    expect(outcome.exitCode).toBe(2);
    expect(
      outcome.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === 'ARXIC-RULES-FRAMEWORK-REJECTED' && diagnostic.severity === 'blocked',
      ),
    ).toBe(true);
    expect(JSON.stringify(outcome.diagnostics)).not.toContain('/tmp/');
  });

  it('a recorded waiver in the repository lets a fail-fast rejection proceed to the executor', async () => {
    const waiver = {
      version: 1,
      frameworkWaivers: [
        {
          framework: 'nextjs',
          version: '17.0.0',
          packVersionRange: '>=15 <17',
          reason: 'operator accepted nextjs-auth on Next 17 after manual review',
          approvedBy: 'anthonykewl20',
          recordedAt: '2026-08-17T00:00:00.000Z',
        },
      ],
    };
    const outcome = await scenario({
      frameworks: ['nextjs'],
      files: {
        'package.json': JSON.stringify(
          { name: 'next-17-app', dependencies: { next: '17.0.0' } },
          undefined,
          2,
        ),
        'arxic.waivers.json': JSON.stringify(waiver, undefined, 2),
      },
    });
    expect(outcome.executed).toEqual(['executed']);
    expect(outcome.exitCode).not.toBe(2);
    expect(
      outcome.diagnostics.some((diagnostic) => diagnostic.code === 'ARXIC-RULES-FRAMEWORK-WAIVED'),
    ).toBe(true);
  });

  it('an in-range framework reaches the executor without gate diagnostics', async () => {
    const outcome = await scenario({
      frameworks: ['nextjs'],
      files: {
        'package.json': JSON.stringify(
          { name: 'next-16-app', dependencies: { next: '16.2.6' } },
          undefined,
          2,
        ),
      },
    });
    expect(outcome.executed).toEqual(['executed']);
    expect(
      outcome.diagnostics.filter((diagnostic) =>
        diagnostic.code.startsWith('ARXIC-RULES-FRAMEWORK'),
      ),
    ).toHaveLength(1);
  });

  it('skips the gate when the rulepacks root is absent (legacy executor environments; stage 3 still reports)', async () => {
    const outcome = await scenario({
      frameworks: ['laravel'],
      rulepacksDir: join(tmpdir(), 'arxic-definitely-missing-rulepacks'),
    });
    expect(outcome.executed).toEqual(['executed']);
    expect(outcome.exitCode).not.toBe(2);
  });
});
