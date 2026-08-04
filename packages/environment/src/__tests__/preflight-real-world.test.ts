import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runPreflightAttestation } from '..';

const execute = promisify(execFile);
const root = resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
const referenceDir = resolve(root, 'test-fixtures/reference-auth-app');
const vulnerableDir = resolve(root, 'test-fixtures/vulnerable-auth-app');
const nonce = 'm0-15-reference-targets';
const processes: ChildProcess[] = [];
const temporaryDirectories: string[] = [];
let productionServer: Server | undefined;

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

async function freePort(host = '127.0.0.1'): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveListen) => server.listen(0, host, resolveListen));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not allocate a port');
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  return address.port;
}

async function waitFor(origin: string, child: ChildProcess): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Fixture exited with code ${child.exitCode}`);
    try {
      if ((await fetch(origin)).ok) return;
    } catch {
      await delay(250);
      continue;
    }
    await delay(250);
  }
  throw new Error(`Fixture did not become ready: ${origin}`);
}

async function bootReference(): Promise<string> {
  await execute('pnpm', ['--filter', 'reference-auth-app', 'build'], {
    cwd: root,
    timeout: 120_000,
  });
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'arxic-preflight-reference-'));
  temporaryDirectories.push(temporaryRoot);
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(
    process.execPath,
    [resolve(referenceDir, 'node_modules/next/dist/bin/next'), 'start', '-p', String(port)],
    {
      cwd: referenceDir,
      env: {
        ...process.env,
        ARXIC_TARGET_ORIGIN: origin,
        ARXIC_ATTESTATION_NONCE: nonce,
        ARXIC_DB_PATH: join(temporaryRoot, 'auth.db'),
      },
      stdio: 'ignore',
      shell: false,
    },
  );
  processes.push(child);
  await waitFor(origin, child);
  return origin;
}

async function bootVulnerable(): Promise<string> {
  await execute('pnpm', ['--filter', 'vulnerable-auth-app', 'build'], {
    cwd: root,
    timeout: 120_000,
  });
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'arxic-preflight-vulnerable-'));
  temporaryDirectories.push(temporaryRoot);
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [resolve(vulnerableDir, 'dist/server.js')], {
    cwd: vulnerableDir,
    env: {
      ...process.env,
      PORT: String(port),
      ARXIC_TARGET_ORIGIN: origin,
      ARXIC_ATTESTATION_NONCE: nonce,
      ARXIC_DB_PATH: join(temporaryRoot, 'auth.db'),
    },
    stdio: 'ignore',
    shell: false,
  });
  processes.push(child);
  await waitFor(origin, child);
  return origin;
}

async function bootProductionStub(): Promise<string> {
  const port = await freePort('0.0.0.0');
  const origin = `http://0.0.0.0:${port}`;
  productionServer = createServer((_request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(
      JSON.stringify({
        environmentClass: 'production',
        origin,
        allowedOrigins: [origin],
        buildDigest: '8c3f68766d8dbb06cbd85efc196d12b448a37eb34f196dc861f21865a7ca310f',
        nonce,
      }),
    );
  });
  await new Promise<void>((resolveListen) =>
    productionServer?.listen(port, '0.0.0.0', resolveListen),
  );
  return origin;
}

async function stopProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise<void>((resolveExit) => child.once('exit', () => resolveExit())),
    delay(5_000),
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

describe('real-world preflight attestation', () => {
  let referenceOrigin: string;
  let vulnerableOrigin: string;
  let productionOrigin: string;

  beforeAll(async () => {
    [referenceOrigin, vulnerableOrigin] = await Promise.all([bootReference(), bootVulnerable()]);
    productionOrigin = await bootProductionStub();
  }, 120_000);

  afterAll(async () => {
    await Promise.all(processes.map(stopProcess));
    if (productionServer) {
      await new Promise<void>((resolveClose) => productionServer?.close(() => resolveClose()));
    }
    await Promise.all(temporaryDirectories.map((directory) => rm(directory, { recursive: true })));
  });

  it('accepts both reference apps, refuses production, and records deterministic decisions', async () => {
    const artifactsDir = await mkdtemp(join(tmpdir(), 'arxic-preflight-artifacts-'));
    temporaryDirectories.push(artifactsDir);
    const targets = [
      { id: 'reference-auth-app', origin: referenceOrigin },
      { id: 'vulnerable-auth-app', origin: vulnerableOrigin },
      { id: 'production-stub', origin: productionOrigin },
    ];
    const policy = {
      allowedOrigins: targets.map(({ origin }) => origin),
      expectedNonce: nonce,
      now: () => '2026-08-05T16:00:00.000Z',
    };
    const first = await runPreflightAttestation({
      targets,
      policy,
      artifactsDir,
      now: () => '2026-08-05T16:01:00.000Z',
    });
    const firstBytes = await readFile(first.artifactPath, 'utf8');
    const firstArtifact = JSON.parse(firstBytes) as {
      generatedAt: string;
      targets: Array<{ id: string; environmentClass: string; disposition: string }>;
    };
    const second = await runPreflightAttestation({
      targets,
      policy,
      artifactsDir,
      now: () => '2026-08-05T16:02:00.000Z',
    });
    const secondBytes = await readFile(second.artifactPath, 'utf8');
    const secondArtifact = JSON.parse(secondBytes) as typeof firstArtifact;

    expect(first.accepted).toEqual(['reference-auth-app', 'vulnerable-auth-app']);
    expect(first.refused).toEqual(['production-stub']);
    expect(first.results).toMatchObject([
      { id: 'reference-auth-app', environmentClass: 'local-test', disposition: 'allowed' },
      { id: 'vulnerable-auth-app', environmentClass: 'local-test', disposition: 'allowed' },
      { id: 'production-stub', environmentClass: 'production', disposition: 'refused' },
    ]);
    expect(firstArtifact.targets).toEqual(first.results);
    expect(firstArtifact.targets.map(({ disposition }) => disposition)).toEqual([
      'allowed',
      'allowed',
      'refused',
    ]);
    expect(firstBytes.replace(firstArtifact.generatedAt, '<generatedAt>')).toBe(
      secondBytes.replace(secondArtifact.generatedAt, '<generatedAt>'),
    );
  });
});
