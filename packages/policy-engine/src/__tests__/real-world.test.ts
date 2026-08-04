import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ARXIC_POLICY_DESTRUCTIVE_WITHOUT_APPROVAL,
  ARXIC_POLICY_ORIGIN_DENIED,
  approvalKey,
  authorize,
} from '..';

const execute = promisify(execFile);
const root = resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
const referenceDir = resolve(root, 'test-fixtures/reference-auth-app');
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
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'arxic-policy-reference-'));
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

describe('real-world policy authorization against reference attestation', () => {
  let origin: string;
  let allowedOrigins: string[];

  beforeAll(async () => {
    origin = await bootReference();
    const response = await fetch(new URL('/.well-known/arxic-test-target.json', origin));
    expect(response.ok).toBe(true);
    const attestation = (await response.json()) as { origin: string; allowedOrigins: string[] };
    origin = attestation.origin;
    allowedOrigins = attestation.allowedOrigins;
  }, 120_000);

  afterAll(async () => {
    await Promise.all(processes.map(stopProcess));
    await Promise.all(temporaryDirectories.map((directory) => rm(directory, { recursive: true })));
  });

  it('authorizes and denies five decisions against live reference-app origin data', () => {
    const navigation = authorize({
      action: 'navigation',
      actionClass: 'read-only',
      origin,
      approvals: {},
      allowedOrigins,
      budget: { remaining: 5 },
    });
    expect(navigation.decision).toBe('allow');

    const formSubmit = authorize({
      action: 'form-submit',
      actionClass: 'reversible-mutation',
      origin,
      approvals: {},
      allowedOrigins,
      lease: {
        id: 'persona:alice',
        owner: 'run-1',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        inUse: false,
      },
    });
    expect(formSubmit.decision).toBe('allow');

    const destructiveDenied = authorize({
      action: 'delete-user',
      actionClass: 'destructive',
      origin,
      approvals: {},
      allowedOrigins,
    });
    expect(destructiveDenied).toMatchObject({
      decision: 'deny',
      diagnostics: [{ code: ARXIC_POLICY_DESTRUCTIVE_WITHOUT_APPROVAL }],
    });

    const destructiveAllowed = authorize({
      action: 'delete-user',
      actionClass: 'destructive',
      origin,
      approvals: {
        [approvalKey('delete-user', origin)]: {
          approver: 'security-owner@example.test',
          approvedAt: new Date().toISOString(),
          reason: 'Approved live-attestation destructive action',
        },
      },
      allowedOrigins,
    });
    expect(destructiveAllowed.decision).toBe('allow');

    const unknownOrigin = authorize({
      action: 'navigation',
      actionClass: 'read-only',
      origin: 'http://evil-not-attested.test',
      approvals: {},
      allowedOrigins,
      budget: { remaining: 5 },
    });
    expect(unknownOrigin).toMatchObject({
      decision: 'deny',
      diagnostics: [{ code: ARXIC_POLICY_ORIGIN_DENIED }],
    });

    for (const result of [
      navigation,
      formSubmit,
      destructiveDenied,
      destructiveAllowed,
      unknownOrigin,
    ]) {
      expect(result.decision).toBeDefined();
      expect(result.snapshot).toBeDefined();
      expect(result.snapshot.inputSha256).toMatch(/^[a-f0-9]{64}$/);
    }
  });
});
