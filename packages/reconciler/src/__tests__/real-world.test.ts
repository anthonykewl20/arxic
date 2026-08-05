import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { AstGrepAdapter } from '@arxic/ast-grep-adapter';
import type { SourceRevision, Workflow } from '@arxic/contracts';
import { CrawleeSurfaceDiscoverer } from '@arxic/crawlee-adapter';
import { SourceUaAdapter } from '@arxic/source-ua-adapter';
import { afterAll, describe, expect, it } from 'vitest';
import { reconcile } from '..';

const execute = promisify(execFile);
const root = resolve(import.meta.dirname, '../../../..');
const temporaryDirectories: string[] = [];
const gitEnvironment = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Arxic Test',
  GIT_AUTHOR_EMAIL: 'test@arxic.invalid',
  GIT_COMMITTER_NAME: 'Arxic Test',
  GIT_COMMITTER_EMAIL: 'test@arxic.invalid',
  GIT_AUTHOR_DATE: '2026-08-05T12:00:00Z',
  GIT_COMMITTER_DATE: '2026-08-05T12:00:00Z',
};

describe('real candidate reconciliation', () => {
  afterAll(async () => {
    await Promise.all(
      temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  it.each([
    ['reference-auth-app', 'nextjs'],
    ['vulnerable-auth-app', 'express'],
  ] as const)(
    'reconciles real Tree-sitter/sg evidence with real Crawlee/Chromium for %s without greenwashing',
    async (fixture, framework) => {
      const repository = await makeRepository(fixture);
      const source = await new SourceUaAdapter({ now: () => '2026-08-05T00:00:00.000Z' }).collect({
        revision: repository.revision,
      });
      const rules = await new AstGrepAdapter({
        packs: [resolve(root, 'rulepacks/nextjs'), resolve(root, 'rulepacks/express')],
        now: () => '2026-08-05T00:00:00.000Z',
      }).scan({ revision: repository.revision, framework, features: ['login'] });
      const routeRefs = source.events.flatMap((event) =>
        'ref' in event && event.ref.kind === 'source' && event.ref.ruleId?.startsWith('route:')
          ? [event.ref]
          : [],
      );
      const loginChain = rules.chains.find(
        (chain) => chain.feature === 'login' && chain.status === 'connected',
      );
      expect(routeRefs.length).toBeGreaterThan(0);
      expect(loginChain?.evidence.length).toBeGreaterThanOrEqual(3);

      const running = await bootApp(fixture);
      try {
        const surface = await new CrawleeSurfaceDiscoverer({
          maxConcurrency: 2,
          maxRequestRetries: 1,
        }).collect({
          origin: running.origin,
          maxUrls: 16,
          maxDepth: 2,
          appBuildDigest: 'b'.repeat(64),
        });
        const candidates = [
          ...(fixture === 'reference-auth-app'
            ? [
                {
                  id: `${framework}.root`,
                  title: 'Observed root route',
                  evidenceRefs: ['src:real-root'],
                  workflow: routeWorkflow(`${framework}.root`, '/', []),
                },
              ]
            : []),
          {
            id: `${framework}.login`,
            title: 'Login route and guard',
            evidenceRefs: loginChain!.evidence.map((_, index) => `src:real-login:${index}`),
            workflow: routeWorkflow(`${framework}.login`, '/login', ['email', 'password']),
          },
          {
            id: `${framework}.source-only`,
            title: 'Static-only structural symbol',
            evidenceRefs: ['src:real-structural-symbol'],
          },
          ...(fixture === 'vulnerable-auth-app'
            ? [
                {
                  id: 'express.csrf',
                  title: 'CSRF protection coverage requirement',
                  evidenceRefs: [],
                },
                {
                  id: 'express.login-csrf-claim',
                  title: 'Static login guard candidate claims CSRF protection',
                  evidenceRefs: loginChain!.evidence.map(
                    (_, index) => `src:real-login-guard:${index}`,
                  ),
                  workflow: routeWorkflow('express.login-csrf-claim', '/login', [
                    'email',
                    'password',
                  ]),
                },
              ]
            : []),
        ];
        const matrix = await reconcile({ candidates, surface });
        const outcomes = new Set(matrix.rows.map((row) => row.outcome));

        expect(surface.routes.some((route) => route.evidence?.kind === 'runtime')).toBe(true);
        expect(outcomes.has('hypothesized')).toBe(true);
        expect(outcomes.has('blocked') || outcomes.has('contradicted')).toBe(true);
        expect(matrix.summary.verifiedTransitionCoverage).toBe(0);
        expect(matrix.rows.some((row) => row.outcome === ('verified' as never))).toBe(false);
        if (fixture === 'vulnerable-auth-app') {
          expect(outcomes.has('observed')).toBe(false);
          expect(matrix.rows.some((row) => row.kind === 'runtime-only')).toBe(false);
          expect(JSON.stringify([...source.events, ...rules.events]).toLowerCase()).not.toContain(
            'csrf',
          );
          expect(matrix.rows.find((row) => row.candidateId === 'express.csrf')).toMatchObject({
            outcome: 'blocked',
            diagnostics: [{ code: 'ARXIC-RECON-UNSUPPORTED', severity: 'blocked' }],
          });
          expect(
            matrix.rows.find((row) => row.candidateId === 'express.login-csrf-claim'),
          ).toMatchObject({
            outcome: 'contradicted',
            diagnostics: [{ code: 'ARXIC-RECON-CONFLICT', severity: 'contradicted' }],
          });
          expect(outcomes).toEqual(new Set(['hypothesized', 'blocked', 'contradicted']));
        } else {
          expect(outcomes.has('observed')).toBe(true);
          expect(matrix.rows.some((row) => row.kind === 'runtime-only')).toBe(true);
        }
      } finally {
        await stop(running.process);
      }
    },
    300_000,
  );
});

function routeWorkflow(id: string, route: string, inputs: readonly string[]): Workflow {
  return {
    $schema: 'https://arxic.dev/schemas/workflow/v1.json',
    id,
    version: 1,
    title: id,
    domain: 'authentication',
    persona: 'anonymous',
    status: 'hypothesized',
    confidence: 0.8,
    scope: {
      commit: 'a'.repeat(40),
      environment: 'local-test',
      browser: 'chromium',
    },
    preconditions: [],
    states: [{ id: route }, { id: 'complete' }],
    transitions: [
      {
        from: route,
        to: 'complete',
        action: {
          intent: `Use ${route}`,
          inputRefs: Object.fromEntries(inputs.map((input) => [input, `persona.${input}`])),
        },
        assertions: [{ intent: 'The route responds' }],
        evidenceRefs: ['src:real-transition'],
      },
    ],
    negativeCases: [],
    verification: {
      requiredRuns: 2,
      screenshotCheckpoints: [],
      forbidNetworkErrors: true,
    },
    evidenceRefs: ['src:real-workflow'],
  };
}

async function makeRepository(
  fixture: 'reference-auth-app' | 'vulnerable-auth-app',
): Promise<{ revision: SourceRevision }> {
  const directory = await mkdtemp(join(tmpdir(), 'arxic-reconciler-source-'));
  temporaryDirectories.push(directory);
  await cp(resolve(root, 'test-fixtures', fixture), directory, {
    recursive: true,
    filter: (path) => !['node_modules', '.next', 'dist'].includes(basename(path)),
  });
  await writeFile(
    join(directory, '.gitignore'),
    'node_modules/\n.next/\ndist/\nauth.db*\ntsconfig.tsbuildinfo\n',
  );
  await git(directory, 'init', '--initial-branch=main');
  await git(directory, 'add', '.');
  await git(directory, 'commit', '-m', 'fixture');
  const commit = await git(directory, 'rev-parse', 'HEAD');
  return {
    revision: { repository: pathToFileURL(directory).href, commit, dirty: false },
  };
}

async function bootApp(
  fixture: 'reference-auth-app' | 'vulnerable-auth-app',
): Promise<{ origin: string; process: ChildProcess }> {
  await execute('pnpm', ['--filter', fixture, 'build'], { cwd: root, timeout: 240_000 });
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const appDirectory = resolve(root, 'test-fixtures', fixture);
  const databaseDirectory = await mkdtemp(join(tmpdir(), 'arxic-reconciler-runtime-'));
  temporaryDirectories.push(databaseDirectory);
  const args =
    fixture === 'reference-auth-app'
      ? [resolve(appDirectory, 'node_modules/next/dist/bin/next'), 'start', '-p', String(port)]
      : [resolve(appDirectory, 'dist/server.js')];
  const child = spawn(process.execPath, args, {
    cwd: appDirectory,
    env: {
      ...process.env,
      PORT: String(port),
      ARXIC_DB_PATH: join(databaseDirectory, 'auth.db'),
      ARXIC_TARGET_ORIGIN: origin,
      ARXIC_ATTESTATION_NONCE: 'reconciler-real-world-proof',
    },
    stdio: 'ignore',
    shell: false,
  });
  await readiness(origin, child);
  return { origin, process: child };
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  return (await execute('git', args, { cwd, env: gitEnvironment, encoding: 'utf8' })).stdout.trim();
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not allocate fixture port');
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  return address.port;
}

async function readiness(origin: string, child: ChildProcess): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Reference app exited with ${child.exitCode}`);
    try {
      if ((await fetch(origin)).ok) return;
    } catch {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
    }
  }
  throw new Error('Reference app readiness timed out');
}

async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise<void>((resolveExit) => child.once('exit', () => resolveExit())),
    new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 5_000)),
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
}
