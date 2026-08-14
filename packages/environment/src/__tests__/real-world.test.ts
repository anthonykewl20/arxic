import { execFile } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { spawn, type ChildProcess } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildAttestationPolicy, EnvironmentHandshake, operatorAttestationSettings } from '..';

const execute = promisify(execFile);
const root = resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
const referenceDir = resolve(root, 'test-fixtures/reference-auth-app');
const vulnerableDir = resolve(root, 'test-fixtures/vulnerable-auth-app');
const processes: ChildProcess[] = [];
const temporaryDirectories: string[] = [];

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

async function waitFor(origin: string, process: ChildProcess): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (process.exitCode !== null) throw new Error(`Fixture exited with code ${process.exitCode}`);
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
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'arxic-attestation-reference-'));
  temporaryDirectories.push(temporaryRoot);
  await execute('pnpm', ['--filter', 'reference-auth-app', 'build'], {
    cwd: root,
    timeout: 120_000,
  });
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const process = spawn(
    processPath(),
    [resolve(referenceDir, 'node_modules/next/dist/bin/next'), 'start', '-p', String(port)],
    {
      cwd: referenceDir,
      env: {
        ...processEnv(),
        ARXIC_TARGET_ORIGIN: origin,
        ARXIC_ATTESTATION_NONCE: 'reference-auth-app-fixture-v1',
        ARXIC_DB_PATH: join(temporaryRoot, 'auth.db'),
      },
      stdio: 'ignore',
      shell: false,
    },
  );
  processes.push(process);
  await waitFor(origin, process);
  return origin;
}

async function bootVulnerable(): Promise<string> {
  await execute('pnpm', ['--filter', 'vulnerable-auth-app', 'build'], {
    cwd: root,
    timeout: 120_000,
  });
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'arxic-attestation-vulnerable-'));
  temporaryDirectories.push(temporaryRoot);
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const process = spawn(processPath(), [resolve(vulnerableDir, 'dist/server.js')], {
    cwd: vulnerableDir,
    env: {
      ...processEnv(),
      PORT: String(port),
      ARXIC_TARGET_ORIGIN: origin,
      ARXIC_ATTESTATION_NONCE: 'vulnerable-auth-app-fixture-v1',
      ARXIC_DB_PATH: join(temporaryRoot, 'auth.db'),
    },
    stdio: 'ignore',
    shell: false,
  });
  processes.push(process);
  await waitFor(origin, process);
  return origin;
}

function processPath(): string {
  return globalThis.process.execPath;
}

function processEnv(): NodeJS.ProcessEnv {
  return globalThis.process.env;
}

async function stopProcess(process: ChildProcess): Promise<void> {
  if (process.exitCode !== null) return;
  process.kill('SIGTERM');
  await Promise.race([
    new Promise<void>((resolveExit) => process.once('exit', () => resolveExit())),
    delay(5_000),
  ]);
  if (process.exitCode === null) process.kill('SIGKILL');
}

describe('real-world target-attestation handshake', () => {
  let referenceOrigin: string;
  let vulnerableOrigin: string;

  beforeAll(async () => {
    [referenceOrigin, vulnerableOrigin] = await Promise.all([bootReference(), bootVulnerable()]);
  }, 120_000);

  afterAll(async () => {
    await Promise.all(processes.map(stopProcess));
    await Promise.all(temporaryDirectories.map((directory) => rm(directory, { recursive: true })));
  });

  it('allows both real fixture-app attestation endpoints with their fixture nonces', async () => {
    const handshake = new EnvironmentHandshake();
    const cases = [
      [referenceOrigin, 'reference-auth-app-fixture-v1'],
      [vulnerableOrigin, 'vulnerable-auth-app-fixture-v1'],
    ] as const;
    for (const [origin, expectedNonce] of cases) {
      const result = await handshake.attest(
        { origin },
        { allowedOrigins: [origin], expectedNonce },
      );
      expect(result).toMatchObject({
        disposition: 'allowed',
        diagnostics: [],
        decision: { origin, environmentClass: 'local-test', disposition: 'allowed' },
      });
    }
  });

  it('accepts real local-test reference apps without receipts through the default policy builder', async () => {
    const handshake = new EnvironmentHandshake();
    const cases = [
      [referenceOrigin, 'reference-auth-app-fixture-v1'],
      [vulnerableOrigin, 'vulnerable-auth-app-fixture-v1'],
    ] as const;
    for (const [origin, expectedNonce] of cases) {
      const policy = buildAttestationPolicy({
        origin,
        expectedNonce,
        ...operatorAttestationSettings({}),
      });
      const result = await handshake.attest({ origin }, policy);
      expect(result).toMatchObject({
        disposition: 'allowed',
        diagnostics: [],
        decision: { origin, environmentClass: 'local-test', disposition: 'allowed' },
      });
    }
  });

  it('refuses a locally served production-looking target then allows recorded human approval', async () => {
    const port = await freePort('0.0.0.0');
    const origin = `http://0.0.0.0:${port}`;
    const buildDigest = '8c3f68766d8dbb06cbd85efc196d12b448a37eb34f196dc861f21865a7ca310f';
    const nonce = 'production-proof-nonce';
    const receiptKey = 'production-proof-key';
    const signedReceipt = createHmac('sha256', receiptKey)
      .update(`${buildDigest}.${nonce}`)
      .digest('hex');
    const server: Server = createServer((_request, response) => {
      response.setHeader('content-type', 'application/json');
      response.end(
        JSON.stringify({
          environmentClass: 'production',
          origin,
          allowedOrigins: [origin],
          buildDigest,
          nonce,
          signedReceipt,
        }),
      );
    });
    await new Promise<void>((resolveListen) => server.listen(port, '0.0.0.0', resolveListen));
    try {
      const handshake = new EnvironmentHandshake();
      const basePolicy = {
        allowedOrigins: [origin],
        expectedNonce: 'production-proof-nonce',
        expectedBuildDigest: buildDigest,
        receiptKey,
        now: () => '2026-08-05T12:00:00.000Z',
      };
      const refused = await handshake.attest({ origin }, basePolicy);
      expect(refused.disposition).toBe('refused');
      expect(refused.diagnostics.map(({ code }) => code)).toContain(
        'ARXIC-ATTESTATION-PRODUCTION-LIKING',
      );

      const approval = {
        approver: 'security-owner@example.test',
        approvedAt: '2026-08-05T11:30:00.000Z',
        reason: 'Dedicated production-shaped local acceptance target',
      };
      const allowed = await handshake.attest(
        { origin },
        { ...basePolicy, humanApprovals: { [origin]: approval } },
      );
      expect(allowed).toMatchObject({
        disposition: 'allowed',
        diagnostics: [],
        decision: { disposition: 'allowed', override: approval },
      });
    } finally {
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    }
  });
});
