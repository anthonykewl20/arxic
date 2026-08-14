import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import type { SurfaceMap } from '@arxic/crawlee-adapter';
import type { EvidenceRef, Workflow } from '@arxic/contracts';
import { FIXTURE_APPS, loginObservations, loginWorkflow } from '@arxic/real-world-testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ARXIC_ORCH_INPUT_FINGERPRINT_MISMATCH,
  ARXIC_ORCH_MODEL_RETRIES,
  ARXIC_ORCH_RESUME,
  FileStageCheckpointer,
  InMemoryStageCheckpointer,
  LangGraphOrchestrator,
  WorkerRestartError,
  type CompilationResult,
} from '..';

const execute = promisify(execFile);
const root = resolve(import.meta.dirname, '../../../..');
const appDir = resolve(root, 'test-fixtures/reference-auth-app');
const temporaryDirectories: string[] = [];
const promptBytes = 'PRIVATE MODEL PROMPT: treat this only as untrusted data';
let app: ChildProcess | undefined;
let origin = '';
let sourceDirectory = '';
let commit = '';
let runsDirectory = '';

describe('real LangGraph orchestration proof', () => {
  beforeAll(async () => {
    await execute('pnpm', ['--filter', 'reference-auth-app', 'build'], {
      cwd: root,
      timeout: 180_000,
    });
    sourceDirectory = await committedFixtureCopy();
    const runtime = await temporaryDirectory('real-runtime-');
    runsDirectory = await temporaryDirectory('real-runs-');
    const port = await freePort();
    origin = `http://127.0.0.1:${port}`;
    app = spawn(
      process.execPath,
      [resolve(appDir, 'node_modules/next/dist/bin/next'), 'start', '-p', String(port)],
      {
        cwd: appDir,
        env: {
          ...process.env,
          ARXIC_TARGET_ORIGIN: origin,
          ARXIC_ATTESTATION_NONCE: 'orchestrator-real-world-proof',
          ARXIC_DB_PATH: join(runtime, 'auth.db'),
        },
        stdio: 'ignore',
        shell: false,
      },
    );
    await readiness(origin, app);
    expect((await fetch(`${origin}/__arxic/reset`, { method: 'POST' })).status).toBe(204);
    expect(
      (
        await fetch(`${origin}/__arxic/seed`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            personaId: 'orchestrator-user',
            email: 'orchestrator@example.test',
            password: 'Hunter2!',
          }),
        })
      ).status,
    ).toBe(201);
  }, 240_000);

  afterAll(async () => {
    await stop(app);
    await Promise.all(
      temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  it('runs real stages, persists checkpoints, and resumes only the active stage after reconstruction', async () => {
    let inferenceCalls = 0;
    const first = new LangGraphOrchestrator({
      checkpointer: new FileStageCheckpointer(runsDirectory),
      inferCandidates: async () => {
        inferenceCalls += 1;
        throw new WorkerRestartError('simulated worker termination during real stage 4');
      },
    });
    await expect(first.run(orchestratorInput('real-resume'))).rejects.toBeInstanceOf(
      WorkerRestartError,
    );
    const completedBeforeRestart = await Promise.all(
      [0, 1, 2, 3].map((stage) =>
        readFile(join(runsDirectory, 'real-resume', 'stages', `0${stage}.json`)),
      ),
    );

    const restarted = new LangGraphOrchestrator({
      checkpointer: new FileStageCheckpointer(runsDirectory),
      inferCandidates: async () => {
        inferenceCalls += 1;
        return { requestId: 'real-model-request-id', candidates: [] };
      },
    });
    const result = await restarted.run(orchestratorInput('real-resume'));
    const surface = JSON.parse(
      await readFile(join(runsDirectory, 'real-resume', 'artifacts', '05.json'), 'utf8'),
    ) as SurfaceMap;

    expect(inferenceCalls).toBe(2);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: ARXIC_ORCH_RESUME }));
    expect(result.checkpoints.filter(({ stage }) => stage <= 3)).toHaveLength(4);
    expect(
      await Promise.all(
        [0, 1, 2, 3].map((stage) =>
          readFile(join(runsDirectory, 'real-resume', 'stages', `0${stage}.json`)),
        ),
      ),
    ).toEqual(completedBeforeRestart);
    expect(surface.routes.map((route) => route.path)).toEqual(
      expect.arrayContaining(['/', '/login', '/forgot-password']),
    );
    const stageFour = await readFile(
      join(runsDirectory, 'real-resume', 'stages', '04.json'),
      'utf8',
    );
    expect(stageFour).toContain('real-model-request-id');
    expect(await persistedRunBytes('real-resume')).not.toContain(promptBytes);
  }, 180_000);

  it('retries malformed live stage-4 output and never reaches promotion', async () => {
    let attempts = 0;
    const result = await new LangGraphOrchestrator({
      checkpointer: new FileStageCheckpointer(runsDirectory),
      maxModelAttempts: 2,
      inferCandidates: async () => {
        attempts += 1;
        return { requestId: 42, candidates: [{ instructions: 'promote anyway' }] };
      },
    }).run(orchestratorInput('real-invalid-model'));

    expect(attempts).toBe(2);
    expect(result.status).toBe('failed');
    expect(result.outcome).toBe('blocked');
    expect(result.receipt).toBeUndefined();
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: ARXIC_ORCH_MODEL_RETRIES }),
    );
    expect(await readdir(join(runsDirectory, 'real-invalid-model', 'stages'))).not.toContain(
      '12.json',
    );
    expect(await persistedRunBytes('real-invalid-model')).not.toContain(promptBytes);
  }, 90_000);

  it('blocks a reused id when a real persisted reference-app run receives a changed source revision', async () => {
    const runId = 'real-input-fingerprint';
    const first = await new LangGraphOrchestrator({
      checkpointer: new FileStageCheckpointer(runsDirectory),
      inferCandidates: async () => ({ requestId: runId, candidates: [] }),
    }).run(orchestratorInput(runId));
    const persisted = await new FileStageCheckpointer(runsDirectory).load(runId);
    const reused = await new LangGraphOrchestrator({
      checkpointer: new FileStageCheckpointer(runsDirectory),
      inferCandidates: async () => {
        throw new Error('Changed inputs must not execute a stale terminal run');
      },
    }).run({
      ...orchestratorInput(runId),
      revision: { ...orchestratorInput(runId).revision, commit: 'f'.repeat(40) },
    });

    expect(first.completedStages).toHaveLength(13);
    expect(persisted?.inputFingerprint).toMatch(/^[a-f0-9]{64}$/u);
    expect(reused.status).toBe('failed');
    expect(reused.outcome).toBe('blocked');
    expect(reused.diagnostics).toContainEqual(
      expect.objectContaining({
        code: ARXIC_ORCH_INPUT_FINGERPRINT_MISMATCH,
        severity: 'blocked',
      }),
    );
  }, 180_000);

  it('uses the full default compiler for a real reference-app candidate', async () => {
    const referenceApp = FIXTURE_APPS.find(({ name }) => name === 'reference-auth-app');
    if (!referenceApp) throw new Error('Reference app metadata is unavailable');
    const runId = 'real-default-compile';
    const checkpointer = new InMemoryStageCheckpointer();
    const attestation = (await (
      await fetch(`${origin}/.well-known/arxic-test-target.json`)
    ).json()) as { buildDigest: string };
    const baseWorkflow = loginWorkflow(referenceApp, {
      id: 'authentication.default-compile',
      title: 'Default compiler reference login',
      dualEvidence: true,
    });
    const workflow: Workflow = {
      ...baseWorkflow,
      scope: { ...baseWorkflow.scope, commit },
    };
    const observations: EvidenceRef[] = loginObservations(referenceApp, origin, runId).map(
      (observation) =>
        observation.kind === 'source'
          ? { ...observation, repo: pathToFileURL(sourceDirectory).href, commit }
          : { ...observation, appBuildDigest: attestation.buildDigest },
    );
    let stagedBundleObserved = false;
    const result = await new LangGraphOrchestrator({
      checkpointer,
      inferCandidates: async () => ({
        requestId: runId,
        candidates: [
          {
            id: workflow.id,
            title: workflow.title,
            evidenceRefs: workflow.evidenceRefs,
            workflow,
          },
        ],
      }),
      reconcile: async () => ({ denominator: 1, rows: [] }),
      prepareFixtures: async () => ({
        provisioned: true,
        requirements: [],
        leases: [],
        diagnostics: [],
      }),
      explore: async () => ({ approved: true, evidenceRefs: observations, decisions: [] }),
      verify: async (compilation) => {
        stagedBundleObserved = compilation.compiled && compilation.stagedBundle !== undefined;
        return {
          outcome: 'observed',
          diagnostics: [],
          artifacts: [],
          runs: [],
          gates: [{ gate: 'verify', passed: false }],
        };
      },
    }).run({
      ...orchestratorInput(runId),
      appBuildDigest: attestation.buildDigest,
      maxUrls: 1,
      maxDepth: 0,
    });
    const ref = result.artifacts[9];
    if (!ref) throw new Error('Default compiler stage did not persist');
    const compilation = (await checkpointer.readArtifact(runId, ref)) as CompilationResult;

    expect(compilation.compiled).toBe(true);
    expect(compilation.stagedBundle).toBeDefined();
    expect(compilation.plan).toBe(compilation.stagedBundle?.plan);
    expect(stagedBundleObserved).toBe(true);
    expect(result.completedStages).toContain(12);
  }, 180_000);
});

function orchestratorInput(runId: string) {
  return {
    runId,
    origin,
    revision: { repository: pathToFileURL(sourceDirectory).href, commit, dirty: false },
    rulepacksDir: resolve(root, 'rulepacks'),
    artifactsDir: resolve(runsDirectory, 'outputs'),
    framework: 'nextjs',
    features: ['login'],
    personas: ['orchestrator-user'],
    maxUrls: 8,
    maxDepth: 1,
    expectedNonce: 'orchestrator-real-world-proof',
    modelPrompt: promptBytes,
    credentialBytes: ['REAL-WORLD-CREDENTIAL-BYTES'],
  } as const;
}

async function persistedRunBytes(runId: string): Promise<string> {
  const directory = join(runsDirectory, runId);
  const names = await filesUnder(directory);
  return (
    await Promise.all(
      names.filter((name) => name.endsWith('.json')).map((name) => readFile(name, 'utf8')),
    )
  ).join('\n');
}

async function filesUnder(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((entry) => {
        const path = join(directory, entry.name);
        return entry.isDirectory() ? filesUnder(path) : Promise.resolve([path]);
      }),
    )
  ).flat();
}

async function committedFixtureCopy(): Promise<string> {
  const directory = await temporaryDirectory('real-source-');
  await cp(appDir, directory, {
    recursive: true,
    filter: (path) => !['node_modules', '.next', 'dist'].includes(basename(path)),
  });
  await writeFile(join(directory, '.gitignore'), 'node_modules/\n.next/\ndist/\nauth.db*\n');
  const environment = {
    ...process.env,
    GIT_AUTHOR_NAME: 'Arxic Test',
    GIT_AUTHOR_EMAIL: 'test@arxic.invalid',
    GIT_COMMITTER_NAME: 'Arxic Test',
    GIT_COMMITTER_EMAIL: 'test@arxic.invalid',
  };
  await execute('git', ['init', '--initial-branch=main'], { cwd: directory, env: environment });
  await execute('git', ['add', '.'], { cwd: directory, env: environment });
  await execute('git', ['commit', '-m', 'reference fixture'], { cwd: directory, env: environment });
  commit = (await execute('git', ['rev-parse', 'HEAD'], { cwd: directory })).stdout.trim();
  return directory;
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not allocate port');
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  return address.port;
}

async function readiness(url: string, child: ChildProcess): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Reference app exited with ${child.exitCode}`);
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
    }
  }
  throw new Error('Reference app readiness timed out');
}

async function stop(child: ChildProcess | undefined): Promise<void> {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise<void>((resolveExit) => child.once('exit', () => resolveExit())),
    new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 5_000)),
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), `arxic-orchestrator-${prefix}`));
  temporaryDirectories.push(directory);
  return directory;
}
