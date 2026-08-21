/**
 * DG-289 (#289) — SURFACE-005 no-spend crawl harness (contract gate G-4).
 *
 * Purpose (frozen scenario, issue #289): import the CLI SOURCE under tsx
 * (mirroring dg11-run-validation.ts:1162 — the exact lane where tsx's
 * transform injects the `__name` helper into serialized page.evaluate
 * callbacks), boot the reference-auth-app — or, with `--target koel`, the
 * read-only third-party koel clone at its DG-11-pinned commit — on an
 * ephemeral loopback port, run the crawl stage in real Chromium via the
 * CLI's discovery path with a loopback stub-model endpoint (zero spend by
 * construction: the stub has NO upstream), and assert:
 *
 *   1. crawl completion — the stage-5 surface artifact records the
 *      crawl-root app routes (at bd3bc0a the crawl root failed with
 *      ARXIC-SURFACE-005 and the artifact recorded ZERO routes); and
 *   2. zero crawl-root ARXIC-SURFACE-005 entries in diagnostics.jsonl.
 *
 * All outputs (config, run artifacts, app database, captured logs) are
 * written ONLY to a per-run `mkdtemp` directory, which is left in place for
 * evidence inspection. Nothing is written into the repository. The harness
 * tears down the app, docker container (koel), stub model, and attestation
 * front, and exits:
 *
 *   0 — both assertions green
 *   1 — assertion failure (offending SURFACE-005 lines printed verbatim)
 *   2 — environment/boot blocked (SP-3: honest blocked classification,
 *       never fabricated success)
 *
 * Invocation (from the repository root; see CONTRACT CHANGE REQUEST
 * issuecomment-5360467441 — `pnpm --filter` exec runs the child with
 * cwd = apps/worker, so the script path must be repo-root-relative FROM
 * THAT DIRECTORY):
 *
 *   pnpm --filter @arxic/worker exec tsx \
 *     ../../packages/intent-proposal-spike/scripts/surface005-crawl-harness.ts \
 *     --target ref-app
 *   pnpm --filter @arxic/worker exec tsx \
 *     ../../packages/intent-proposal-spike/scripts/surface005-crawl-harness.ts \
 *     --target koel
 *
 * Zero-spend guard: this harness NEVER spends. It refuses to run when
 * ARXIC_DG11_CONFIRM_REAL_SPEND=1 (that flag belongs to the real-model DG-11
 * lane), never reads real model credentials, and forces ARXIC_MODEL_BASE_URL
 * / ARXIC_MODEL_API_KEY to its own loopback stub for the duration of the
 * run (restored afterwards).
 */
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer, type Server } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { sha256 } from '@arxic/contracts';
import { assertCloneAtPin, AttestationFront, cloneBuildDigest } from './dg11-run-validation';

const execute = promisify(execFile);
const repoRoot = resolve(fileURLToPath(import.meta.url), '../../../..');
const KOEL_PIN = 'dfec91ff290509c622ff7cf392fb5e506841ee2b';
const KOEL_IMAGE = 'koel-php83:rehearsal';
const SURFACE005 = 'ARXIC-SURFACE-005';

/** SP-3: classify a boot/environment failure as blocked (never fabricated success). */
class HarnessBlocked extends Error {
  constructor(
    readonly reason: string,
    detail: string,
  ) {
    super(detail);
  }
}

type TargetName = 'ref-app' | 'koel';

type BootedTarget = {
  origin: string;
  describe: () => string;
  stop: () => Promise<void>;
};

function usage(): never {
  console.error('usage: surface005-crawl-harness.ts [--target ref-app|koel]');
  process.exit(2);
}

/** Upper bound for the whole in-process CLI run; a hung lane is blocked, never a hang. */
const RUN_TIMEOUT_MS = 480_000;

async function main(): Promise<void> {
  const target = parseTarget(process.argv.slice(2));
  const runId = `surface005-${target}-${new Date().toISOString().replaceAll(/[:.]/g, '-')}`;
  const harnessSha256 = await selfSha256();

  if (process.env.ARXIC_DG11_CONFIRM_REAL_SPEND === '1') {
    blocked(
      'spend-flag-set',
      'ARXIC_DG11_CONFIRM_REAL_SPEND=1 belongs to the real-model DG-11 lane; this harness is zero-spend by construction and refuses to run under a spend acknowledgment.',
    );
  }

  const tempDir = await mkdtemp(join(tmpdir(), `arxic-surface005-${target}-`));
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];
  const environment = saveEnvironment();
  let booted: BootedTarget | undefined;
  let modelServer: Server | undefined;
  let front: AttestationFront | undefined;
  let exitCode = 0;

  try {
    booted = await bootTarget(target, tempDir);
    modelServer = await startStubModel();
    const modelPort = (modelServer.address() as { port: number }).port;
    const modelBaseUrl = `http://127.0.0.1:${modelPort}`;

    process.env.ARXIC_MODEL_BASE_URL = modelBaseUrl;
    process.env.ARXIC_MODEL_API_KEY = `surface005-stub-${randomUUID()}`;
    process.env.ARXIC_MODEL_BUDGET_USD = '1';
    process.env.ARXIC_STATE_DIR = join(tempDir, 'state');
    delete process.env.ARXIC_MAILPIT_SMTP;
    delete process.env.ARXIC_MAILPIT_API;
    await mkdir(join(tempDir, 'state'), { recursive: true });

    const targetOrigin = booted.origin;
    if (target === 'koel') {
      const clonePath = koelClonePath();
      const buildDigest = await cloneBuildDigest(clonePath);
      front = await AttestationFront.start({ appOrigin: targetOrigin, buildDigest });
    }
    const crawlOrigin = front?.origin ?? targetOrigin;

    const configPath = await writeConfig(target, tempDir, crawlOrigin);
    const outDir = join(tempDir, 'runs');

    // The frozen defect lane: CLI SOURCE executed under tsx, bounded so a
    // hung lane classifies blocked instead of hanging the harness.
    const { runCli } = await import('../../../apps/cli/src/index');
    const result = await Promise.race([
      runCli(['run', '--config', configPath, '--out', outDir, '--run-id', runId], {
        cwd: repoRoot,
        rulepacksDir: resolve(repoRoot, 'rulepacks'),
        stdout: { write: (message) => void stdoutLines.push(message) },
        stderr: { write: (message) => void stderrLines.push(message) },
        now: () => new Date().toISOString(),
      }),
      new Promise<never>((_, rejectRun) =>
        setTimeout(
          () => rejectRun(new HarnessBlocked('run-timeout', `runCli exceeded ${RUN_TIMEOUT_MS}ms`)),
          RUN_TIMEOUT_MS,
        ).unref(),
      ),
    ]);

    const runRoot = join(outDir, runId);
    const diagnostics = await readDiagnostics(runRoot);
    const surface = JSON.parse(await readFile(join(runRoot, 'artifacts', '05.json'), 'utf8')) as {
      routes: Array<{ path: string; url: string }>;
    };
    const crawlRoot = `${crawlOrigin}/`;
    const surface005 = diagnostics.filter((diagnostic) => diagnostic.code === SURFACE005);
    const surface005AtRoot = surface005.filter((diagnostic) => diagnostic.subject === crawlRoot);
    const expectedRoots = target === 'ref-app' ? ['/', '/login', '/forgot-password'] : ['/'];
    const recordedPaths = surface.routes.map((route) => route.path);

    const crawlCompleted = expectedRoots.every((path) => recordedPaths.includes(path));
    const zeroAtRoot = surface005AtRoot.length === 0;

    console.log(
      JSON.stringify(
        {
          ok: crawlCompleted && zeroAtRoot,
          target,
          targetDetail: booted.describe(),
          runId,
          harnessSha256,
          tempDir,
          crawlRoot,
          cliExitCode: result.exitCode,
          surfaceRoutes: recordedPaths,
          crawlCompleted,
          surface005AtRoot: surface005AtRoot,
          surface005Elsewhere: surface005.length - surface005AtRoot.length,
          diagnosticsTotal: diagnostics.length,
        },
        null,
        1,
      ),
    );

    if (!crawlCompleted) {
      exitCode = 1;
      console.error(
        `ASSERTION FAILED (crawl completion): expected root routes ${JSON.stringify(expectedRoots)}; recorded ${JSON.stringify(recordedPaths)}`,
      );
    }
    if (!zeroAtRoot) {
      exitCode = 1;
      console.error(
        `ASSERTION FAILED (zero crawl-root ${SURFACE005}): offending diagnostics verbatim:`,
      );
      for (const diagnostic of surface005AtRoot) console.error(JSON.stringify(diagnostic));
    }
    if (exitCode !== 0) {
      await writeFile(join(tempDir, 'cli-stdout.log'), stdoutLines.join(''), 'utf8');
      await writeFile(join(tempDir, 'cli-stderr.log'), stderrLines.join(''), 'utf8');
    }
  } catch (error) {
    // SP-3: boot/environment failures classify blocked (exit 2); they never
    // fabricate success and never mask an already-recorded assertion result.
    const blockedRun = error instanceof HarnessBlocked ? error : undefined;
    exitCode = 2;
    console.error(
      JSON.stringify(
        {
          ok: false,
          blocked: blockedRun?.reason ?? 'harness-error',
          detail: error instanceof Error ? error.message : String(error),
        },
        null,
        1,
      ),
    );
  } finally {
    // Teardown failures are REPORTED but never mask the primary run result:
    // an assertion failure (exit 1) or blocked classification (exit 2).
    try {
      await front?.stop();
    } catch (error) {
      console.error(`teardown warning: attestation front: ${String(error)}`);
    }
    try {
      await stopServer(modelServer);
    } catch (error) {
      console.error(`teardown warning: stub model server: ${String(error)}`);
    }
    try {
      await booted?.stop();
    } catch (error) {
      console.error(`teardown warning: target: ${String(error)}`);
    }
    restoreEnvironment(environment);
  }
  process.exitCode = exitCode;
}

function parseTarget(args: readonly string[]): TargetName {
  if (args.includes('--help') || args.includes('-h')) usage();
  const index = args.indexOf('--target');
  const value = index === -1 ? 'ref-app' : args[index + 1];
  if (value !== 'ref-app' && value !== 'koel') usage();
  return value;
}

function koelClonePath(): string {
  return process.env.ARXIC_SURFACE005_KOEL_REPO ?? '/home/soultransit/devtony/thirdparty-dg/koel';
}

async function bootTarget(target: TargetName, tempDir: string): Promise<BootedTarget> {
  if (target === 'ref-app') return bootReferenceApp(tempDir);
  return bootKoel();
}

async function bootReferenceApp(tempDir: string): Promise<BootedTarget> {
  const appDir = join(repoRoot, 'test-fixtures/reference-auth-app');
  await execute('pnpm', ['--filter', 'reference-auth-app', 'build'], {
    cwd: repoRoot,
    timeout: 240_000,
  });
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const app = spawn(
    process.execPath,
    [resolve(appDir, 'node_modules/next/dist/bin/next'), 'start', '-p', String(port)],
    {
      cwd: appDir,
      env: {
        ...process.env,
        ARXIC_TARGET_ORIGIN: origin,
        ARXIC_ATTESTATION_NONCE: 'surface005-crawl-harness',
        ARXIC_DB_PATH: join(tempDir, 'auth.db'),
      },
      stdio: 'ignore',
      shell: false,
    },
  );
  try {
    await readiness(origin, app, 'reference-auth-app');
    expect200(await fetch(`${origin}/__arxic/reset`, { method: 'POST' }), 'reset');
    expect200(
      await fetch(`${origin}/__arxic/seed`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          personaId: 'surface-user',
          email: 'surface005@example.test',
          password: 'Hunter2!',
        }),
      }),
      'seed',
    );
  } catch (error) {
    await stopChild(app);
    throw error;
  }
  return {
    origin,
    stop: () => stopChild(app),
    describe: () => `reference-auth-app at ${origin}`,
  };
}

async function bootKoel(): Promise<BootedTarget> {
  const clonePath = koelClonePath();
  const pinCheck = await assertCloneAtPin(clonePath, KOEL_PIN);
  if (!pinCheck.ok) {
    throw new HarnessBlocked(
      'koel-pin-mismatch',
      `koel clone at ${clonePath} has HEAD ${pinCheck.head}, not the DG-11 pin ${KOEL_PIN}; checkout the pin and retry (SP-3: blocked, never fabricated).`,
    );
  }
  const dataDir = process.env.ARXIC_SURFACE005_KOEL_DATA ?? join(dirname(clonePath), 'koel-data');
  const hostPort = await freePort();
  const container = `koel-surface005-${randomUUID().slice(0, 8)}`;
  const imagePresent = await execute('docker', ['image', 'inspect', KOEL_IMAGE])
    .then(() => true)
    .catch(() => false);
  if (!imagePresent) {
    throw new HarnessBlocked(
      'koel-image-missing',
      `docker image ${KOEL_IMAGE} not found; build it per thirdparty-dg/BOOT-PROCEDURES.md (SP-3: blocked, never fabricated).`,
    );
  }
  await execute('docker', [
    'run',
    '-d',
    '--name',
    container,
    '-u',
    `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`,
    '-e',
    'HOME=/tmp',
    '-p',
    `127.0.0.1:${hostPort}:8123`,
    '-v',
    `${clonePath}:/var/www/koel`,
    '-v',
    `${dataDir}:/data`,
    '-w',
    '/var/www/koel',
    KOEL_IMAGE,
    'php',
    'artisan',
    'serve',
    '--host=0.0.0.0',
    '--port=8123',
  ]);
  const origin = `http://127.0.0.1:${hostPort}`;
  const stop = async (): Promise<void> => {
    // Report (never swallow) teardown failures: a leaked container would
    // poison later runs, so the operator must see why a stop failed.
    try {
      await execute('docker', ['stop', '-t', '5', container]);
    } catch (error) {
      console.error(`teardown warning: docker stop ${container}: ${String(error)}`);
    }
    try {
      await execute('docker', ['rm', '-f', container]);
    } catch (error) {
      console.error(`teardown warning: docker rm ${container}: ${String(error)}`);
    }
  };
  try {
    // koel is read-only for this harness: the crawl policy admits only
    // GET/HEAD/OPTIONS and never submits forms, and no seed/reset endpoints
    // are touched (unlike the reference app).
    for (let attempt = 0; attempt < 120; attempt += 1) {
      try {
        const response = await fetch(origin, { redirect: 'manual' });
        if (response.status > 0) break;
      } catch {
        // keep polling the container
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
      if (attempt === 119)
        throw new Error(`koel container ${container} did not become reachable at ${origin}`);
    }
  } catch (error) {
    await stop();
    throw error;
  }
  return { origin, stop, describe: () => `koel (read-only) at ${origin} via ${container}` };
}

/**
 * Loopback stub-model endpoint (zero spend): OpenAI-compatible completion
 * responder with NO upstream. It answers every request with a schema-valid
 * EMPTY proposal set, so stage 4 completes honestly with zero candidates and
 * the run proceeds through the crawl (the m1-11 no-model path proves the
 * pipeline shape: exit 1, honest `partial`, stage-5 artifact written).
 */
async function startStubModel(): Promise<Server> {
  const server = createHttpServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    response.setHeader('content-type', 'application/json');
    response.end(
      JSON.stringify({
        id: `chatcmpl-surface005-${randomUUID()}`,
        model: 'configured-adapter',
        choices: [
          {
            message: {
              role: 'assistant',
              content: JSON.stringify({
                schemaVersion: 'arxic-intent-proposal-v1',
                proposals: [],
              }),
            },
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    );
  });
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  return server;
}

async function writeConfig(
  target: TargetName,
  tempDir: string,
  targetOrigin: string,
): Promise<string> {
  const configDirectory = join(tempDir, 'config');
  await mkdir(configDirectory, { recursive: true });
  const configPath = join(configDirectory, 'arxic.yaml');
  const repository = target === 'ref-app' ? await committedFixtureCopy(tempDir) : koelClonePath();
  const revision = target === 'ref-app' ? await gitHead(repository) : KOEL_PIN;
  const source =
    target === 'ref-app'
      ? fixtureConfigBlock(repository, revision)
      : koelConfigBlock(repository, revision);
  await writeFile(
    configPath,
    `${source}target:
  origin: ${JSON.stringify(targetOrigin)}
  environmentClass: local-test
  attestationPath: /.well-known/arxic-test-target.json
  allowedOrigins:
    - ${JSON.stringify(targetOrigin)}
policy:
  maxUrls: 8
  maxDepth: 1
  maxRuntimeMinutes: 30
  mutation: leased-fixtures-only
  externalNetwork: deny
  requiredVerificationRuns: 2
  screenshots: transition-checkpoints
  trace: retain
  humanApproval: [destructive, external-side-effect]
${target === 'ref-app' ? 'fixtures:\n  personaProvisioner: app-seed-api\n' : 'fixtures: {}\n'}models:
  provider: configured-adapter
  sourceRetention: disabled
`,
    'utf8',
  );
  return configPath;
}

function fixtureConfigBlock(repository: string, revision: string): string {
  return `version: 1
source:
  repository: ${JSON.stringify(repository)}
  revision: ${JSON.stringify(revision)}
  languages: [typescript, javascript]
scope:
  domains: [authentication]
  frameworks: [nextjs]
  browsers: [chromium]
  personas: [anonymous, registered-user]
`;
}

/** Mirrors the DG-11 koel template (docs/evidence/DG-11/koel/arxic.yaml). */
function koelConfigBlock(repository: string, revision: string): string {
  return `version: 1
source:
  repository: ${JSON.stringify(repository)}
  revision: ${JSON.stringify(revision)}
  languages: [php]
scope:
  domains: [authentication]
  frameworks: [laravel]
  browsers: [chromium]
  personas: [anonymous, registered-user]
`;
}

async function committedFixtureCopy(tempDir: string): Promise<string> {
  const appDir = join(repoRoot, 'test-fixtures/reference-auth-app');
  const directory = join(tempDir, 'source-repo');
  await cp(appDir, directory, {
    recursive: true,
    filter: (path) => {
      const name = basename(path);
      return (
        !['node_modules', '.next', 'dist'].includes(name) &&
        !name.startsWith('.vitest-auth.db') &&
        !name.startsWith('auth.db')
      );
    },
  });
  await writeFile(join(directory, '.gitignore'), 'node_modules/\n.next/\ndist/\nauth.db*\n');
  const environment = {
    ...process.env,
    GIT_AUTHOR_NAME: 'Arxic Harness',
    GIT_AUTHOR_EMAIL: 'harness@arxic.invalid',
    GIT_COMMITTER_NAME: 'Arxic Harness',
    GIT_COMMITTER_EMAIL: 'harness@arxic.invalid',
  };
  await execute('git', ['init', '--initial-branch=main'], { cwd: directory, env: environment });
  await execute('git', ['add', '.'], { cwd: directory, env: environment });
  await execute('git', ['commit', '-m', 'reference fixture'], {
    cwd: directory,
    env: environment,
  });
  return directory;
}

async function gitHead(repository: string): Promise<string> {
  return (await execute('git', ['rev-parse', 'HEAD'], { cwd: repository })).stdout.trim();
}

type Diagnostic = { code: string; severity: string; subject: string; message: string };

async function readDiagnostics(runRoot: string): Promise<Diagnostic[]> {
  const bytes = await readFile(join(runRoot, 'diagnostics.jsonl'), 'utf8');
  return bytes
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Diagnostic);
}

function saveEnvironment(): Record<string, string | undefined> {
  const names = [
    'ARXIC_MODEL_BASE_URL',
    'ARXIC_MODEL_API_KEY',
    'ARXIC_MODEL_BUDGET_USD',
    'ARXIC_STATE_DIR',
    'ARXIC_MAILPIT_SMTP',
    'ARXIC_MAILPIT_API',
  ];
  return Object.fromEntries(names.map((name) => [name, process.env[name]]));
}

function restoreEnvironment(previous: Record<string, string | undefined>): void {
  for (const [name, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

async function stopServer(server: Server | undefined): Promise<void> {
  if (!server) return;
  server.closeAllConnections();
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
}

async function stopChild(child: ChildProcess | undefined): Promise<void> {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise<void>((resolveExit) => child.once('exit', () => resolveExit())),
    new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 5_000)),
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

async function readiness(url: string, child: ChildProcess, name: string): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`${name} exited with ${child.exitCode}`);
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
    }
  }
  throw new Error(`${name} readiness timed out`);
}

function expect200(response: Response, stage: string): void {
  if (!response.ok) throw new Error(`reference app ${stage} returned ${response.status}`);
}

async function freePort(): Promise<number> {
  const server = createNetServer();
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('could not allocate a port');
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  return address.port;
}

async function selfSha256(): Promise<string> {
  const bytes = await readFile(fileURLToPath(import.meta.url));
  return sha256(bytes.toString('utf8'));
}

function blocked(reason: string, detail: string): never {
  console.error(JSON.stringify({ ok: false, blocked: reason, detail }, null, 1));
  process.exit(2);
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        blocked: 'unhandled',
        detail: error instanceof Error ? error.message : String(error),
      },
      null,
      1,
    ),
  );
  process.exit(2);
});
