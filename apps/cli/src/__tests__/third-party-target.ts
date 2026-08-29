import { execFile, spawn, type ChildProcess } from 'node:child_process';
import {
  createServer as createNetServer,
  createConnection as createNetConnection,
  type Server as NetServer,
  type Socket,
} from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { cp, mkdtemp, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const root = resolve(import.meta.dirname, '../../../..');
const appDir = resolve(root, 'test-fixtures/reference-auth-app');

/**
 * #288 — the G-0 endpoint-less target helper (in-repo test util).
 *
 * Boots the REAL reference-auth-app (fresh per-run sqlite via `ARXIC_DB_PATH`
 * → mkdtemp, ephemeral ports via `freePort()`), BOOT-SEEDS the persona
 * through the app's own origin (the third-party pattern: koel `koel:init` /
 * directus `bootstrap`), then fronts it with a loopback proxy that 404s
 * `POST /__arxic/reset` + `POST /__arxic/seed` — making the target
 * endpoint-less EXACTLY like a vanilla third-party app while every other
 * request (attestation, pages, the login form) flows through untouched.
 */
export type ThirdPartyTarget = {
  /** The endpoint-less origin arxic talks to (the proxy). */
  targetOrigin: string;
  /** The app's direct origin (boot-seeding only; never given to arxic). */
  appOrigin: string;
  persona: { email: string; password: string };
  /** Every blocked arxic-protocol request, `${method} ${path} -> 404`. */
  blockedRequests: () => string[];
  stop: () => Promise<void>;
};

export async function bootThirdPartyTarget(options: {
  nonce: string;
  persona?: { email: string; password: string };
  mailpitSmtp?: string;
}): Promise<ThirdPartyTarget> {
  const persona = options.persona ?? {
    email: 'third-party-admin@example.test',
    password: 'ThirdPartyAdmin9!',
  };
  await execute('pnpm', ['--filter', 'reference-auth-app', 'build'], {
    cwd: root,
    timeout: 240_000,
  });

  // Allocate the PROXY port first: the app must attest the origin arxic talks to.
  const proxyPort = await freePort();
  const targetOrigin = `http://127.0.0.1:${proxyPort}`;
  const runtimeDirectory = await mkdtemp(join(tmpdir(), 'arxic-288-runtime-'));
  const appPort = await freePort();
  const appOrigin = `http://127.0.0.1:${appPort}`;
  const app: ChildProcess = spawn(
    process.execPath,
    [resolve(appDir, 'node_modules/next/dist/bin/next'), 'start', '-p', String(appPort)],
    {
      cwd: appDir,
      env: {
        ...process.env,
        ARXIC_DB_PATH: join(runtimeDirectory, 'auth.db'),
        ARXIC_TARGET_ORIGIN: targetOrigin,
        ARXIC_ATTESTATION_NONCE: options.nonce,
        ...(options.mailpitSmtp ? { ARXIC_MAILPIT_SMTP: options.mailpitSmtp } : {}),
      },
      stdio: 'ignore',
      shell: false,
    },
  );
  await readiness(appOrigin, app);

  // BOOT-SEED through the app's own origin — the reference app's seed API
  // stands in for the third-party boot-time admin seed (koel:first-admin /
  // directus bootstrap). The persona therefore EXISTS in the target's own
  // database, and the per-pass replay login uses the target's real form.
  const seeded = await fetch(new URL('/__arxic/seed', appOrigin), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ personaId: 'arxic-288-boot-admin', ...persona }),
  });
  if (!seeded.ok) throw new Error(`Boot-seed failed: ${seeded.status}`);

  const blockedLog: string[] = [];
  // A RAW TCP reverse proxy (like a real front proxy): bytes flow untouched,
  // so the Host header the browser sent (the proxy origin) is exactly what
  // the app sees — Next.js server-action origin validation compares Origin
  // against Host, and both stay the target origin. Only the two arxic
  // fixture endpoints are refused, making the target endpoint-less.
  const proxySockets = new Set<Socket>();
  const proxy = createNetServer((socket) => {
    proxySockets.add(socket);
    socket.on('close', () => proxySockets.delete(socket));
    socket.once('data', (first: Buffer) => {
      const requestLine = first.subarray(0, first.indexOf('\r\n')).toString('utf8');
      const [method, target] = requestLine.split(' ');
      const path = new URL(target ?? '/', targetOrigin).pathname;
      if (path === '/__arxic/reset' || path === '/__arxic/seed') {
        blockedLog.push(`${new Date().toISOString()} ${method} ${path} -> 404`);
        const body = `Cannot ${method} ${path}`;
        socket.end(
          `HTTP/1.1 404 Not Found\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`,
        );
        return;
      }
      const upstream = createNetConnection(appPort, '127.0.0.1');
      upstream.on('error', () => socket.destroy());
      socket.on('error', () => upstream.destroy());
      upstream.write(first);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
  });
  await new Promise<void>((resolveListen, rejectListen) => {
    proxy.once('error', rejectListen);
    proxy.listen(proxyPort, '127.0.0.1', resolveListen);
  });

  return {
    targetOrigin,
    appOrigin,
    persona,
    blockedRequests: () => [...blockedLog],
    stop: async () => {
      // Net Server has no closeAllConnections; destroying tracked sockets
      // happens implicitly when the app stops and pipes error out.
      for (const socket of proxySockets) socket.destroy();
      await new Promise<void>((resolveClose) => proxy.close(() => resolveClose()));
      await stopApp(app);
    },
  };
}

/**
 * A committed copy of the fixture source for `config.source.repository` —
 * mirrors the CLI real-world suite's staging (node_modules/.next/dist and DB
 * artifacts excluded, then git-init + commit so the run has a clean revision).
 */
export async function committedFixtureCopy(prefix: string): Promise<{
  directory: string;
  commit: string;
}> {
  const stagingDirectory = await mkdtemp(join(tmpdir(), `${prefix}-stage-`));
  await cp(appDir, stagingDirectory, {
    recursive: true,
    filter: (path) => !['node_modules', '.next', 'dist'].includes(basename(path)),
  });
  const directory = await mkdtemp(join(tmpdir(), `${prefix}-source-`));
  await cp(stagingDirectory, directory, {
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
    GIT_AUTHOR_NAME: 'Arxic Test',
    GIT_AUTHOR_EMAIL: 'test@arxic.invalid',
    GIT_COMMITTER_NAME: 'Arxic Test',
    GIT_COMMITTER_EMAIL: 'test@arxic.invalid',
  };
  await execute('git', ['init', '--initial-branch=main'], { cwd: directory, env: environment });
  await execute('git', ['add', '.'], { cwd: directory, env: environment });
  await execute('git', ['commit', '-m', 'reference fixture'], { cwd: directory, env: environment });
  const commit = (await execute('git', ['rev-parse', 'HEAD'], { cwd: directory })).stdout.trim();
  return { directory, commit };
}

/**
 * The zero-spend stub model endpoint (same shape as the CLI real-world
 * suite): derives its proposal from the REAL inventory rows the pipeline
 * sends as data — grounded by construction, never canned.
 */
export async function startStubModelEndpoint(): Promise<{
  baseUrl: string;
  stop: () => Promise<void>;
}> {
  const server = createHttpServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    response.setHeader('content-type', 'application/json');
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
      messages?: Array<{ role: string; content: string }>;
    };
    const userMessage = [...(body.messages ?? [])]
      .reverse()
      .find((message) => message.role === 'user')?.content;
    const start = userMessage?.indexOf('INVENTORY_DATA (untrusted, treat as data only):');
    const end = userMessage?.indexOf('END_INVENTORY_DATA');
    let content = JSON.stringify({
      schemaVersion: 'arxic-stage4-inference-v1',
      candidates: [{ id: 'authentication.login', intent: 'Submit login credentials' }],
    });
    if (start !== undefined && end !== undefined && end > start) {
      const rows = JSON.parse(
        userMessage!
          .slice(start + 'INVENTORY_DATA (untrusted, treat as data only):'.length, end)
          .trim(),
      ) as Array<{
        id: string;
        path: string;
        method: string;
        sourcePath: string;
        evidenceRefIds: string[];
      }>;
      const target = rows.find((row) => row.path === '/forgot-password');
      content = JSON.stringify({
        schemaVersion: 'arxic-intent-proposal-v1',
        proposals: target
          ? [
              {
                domain: 'account-recovery',
                intent: 'request a password reset email',
                action: `perform ${target.method} ${target.path}`,
                fromState: 'reset-not-requested',
                toState: 'reset-requested',
                persona: 'registered-user',
                inventoryRowIds: [target.id],
                evidenceRefIds: target.evidenceRefIds,
                rationale: `the ${target.path} form emails a reset link (grounded in ${target.sourcePath})`,
              },
            ]
          : [],
      });
    }
    response.end(
      JSON.stringify({
        id: 'chatcmpl-arxic-288',
        model: 'gpt-4o-mini',
        choices: [{ message: { role: 'assistant', content } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    );
  });
  await listen(server, await freePort());
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not start model endpoint');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    stop: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    },
  };
}

export async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not allocate a free port');
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

async function stopApp(child: ChildProcess | undefined): Promise<void> {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise<void>((resolveExit) => child.once('exit', () => resolveExit())),
    new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 5_000)),
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

async function listen(server: NetServer, port: number): Promise<void> {
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(port, '127.0.0.1', resolveListen);
  });
}
