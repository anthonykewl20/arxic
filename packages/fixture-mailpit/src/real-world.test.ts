import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import type { Workflow } from '@arxic/contracts';
import { MailpitContainer, type StartedMailpit } from '@arxic/environment';
import { OtpAdapter } from '@arxic/fixture-otplib';
import {
  ARXIC_FIXTURE_INBOX_MISSING,
  ARXIC_FIXTURE_MISSING,
  FixtureCoordinator,
  type Candidate,
} from '@arxic/orchestrator-langgraph';
import { authenticator } from 'otplib';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { InboxAdapter, PersonaProvisioner } from './index';

const execute = promisify(execFile);
const root = fileURLToPath(new URL('../../../', import.meta.url));
const appDir = resolve(root, 'test-fixtures/reference-auth-app');
let app: ChildProcess | undefined;
let mailpit: StartedMailpit | undefined;
let origin = '';
let runtimeDirectory = '';
let smtp = '';
let api = '';

describe('real fixture adapters proof', () => {
  beforeAll(async () => {
    const configuredSmtp = process.env.ARXIC_MAILPIT_SMTP;
    const configuredApi = process.env.ARXIC_MAILPIT_API;
    if (configuredSmtp && configuredApi) {
      smtp = configuredSmtp;
      api = configuredApi;
      const health = await fetch(`${api}/api/v1/info`).catch(() => undefined);
      if (!health?.ok)
        throw new Error('ARXIC-FIXTURE-INBOX-MISSING blocked: configured Mailpit is unreachable');
    } else {
      try {
        mailpit = await new MailpitContainer().start();
      } catch (error) {
        throw new Error('ARXIC-FIXTURE-INBOX-MISSING blocked: no real Mailpit is available', {
          cause: error,
        });
      }
      smtp = mailpit.smtp;
      api = mailpit.api;
    }
    await execute('pnpm', ['--filter', 'reference-auth-app', 'build'], {
      cwd: root,
      timeout: 180_000,
    });
    runtimeDirectory = await mkdtemp(join(tmpdir(), 'arxic-fixtures-real-'));
    const port = await freePort();
    origin = `http://127.0.0.1:${port}`;
    app = spawn(
      process.execPath,
      [resolve(appDir, 'node_modules/next/dist/bin/next'), 'start', '-p', String(port)],
      {
        cwd: appDir,
        env: {
          ...process.env,
          ARXIC_DB_PATH: join(runtimeDirectory, 'auth.db'),
          ARXIC_TARGET_ORIGIN: origin,
          ARXIC_MAILPIT_SMTP: smtp.replace(/^smtp:\/\//u, ''),
        },
        stdio: 'ignore',
        shell: false,
      },
    );
    await readiness(origin, app);
  }, 240_000);

  afterAll(async () => {
    await stop(app);
    await mailpit?.stop();
    if (runtimeDirectory) await rm(runtimeDirectory, { recursive: true, force: true });
  });

  test('provisions, exercises, and releases real persona, inbox, and otplib fixtures without leakage', async () => {
    const secret = authenticator.generateSecret();
    const password = 'FixtureProof9!';
    const email = 'fixture-proof@example.test';
    const persona = new PersonaProvisioner({ origin });
    const inbox = new InboxAdapter({ smtp, api });
    const otp = new OtpAdapter();
    const coordinator = new FixtureCoordinator([persona, inbox, otp]);
    const workflowCandidate = candidate([
      {
        fixture: 'persona',
        parameters: { personaId: 'fixture-proof', email, password, mfaSecret: secret },
      },
      { fixture: 'inbox', parameters: { recipient: email } },
      { fixture: 'otp', parameters: { secret } },
    ]);
    const prepared = await coordinator.prepare({ candidates: [workflowCandidate] });
    expect(prepared.provisioned).toBe(true);
    const serialized = JSON.stringify(prepared);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain(password);
    expect(serialized).not.toContain(email);
    const inboxLease = prepared.leases.find((lease) => lease.requirement.kind === 'inbox');
    const otpLease = prepared.leases.find((lease) => lease.requirement.kind === 'otp');
    expect(inboxLease).toBeDefined();
    expect(otpLease).toBeDefined();
    if (!inboxLease || !otpLease) throw new Error('Required real fixture lease is missing');
    await inbox.reset(inboxLease);
    const state: BrowserState = { cookies: new Map() };
    const forgot = await submitServerAction(state, '/forgot-password', { email });
    expect(forgot.status).toBe(303);
    const body = await pollForMessage(inbox, inboxLease, 'Reset your reference app password');
    const resetToken = body.match(/[?&]token=([A-Za-z0-9_-]+)/u)?.[1];
    expect(resetToken).toMatch(/^[A-Za-z0-9_-]+$/u);
    const otpToken = otp.generate(otpLease);
    expect(otp.validate(otpLease, otpToken)).toBe(true);
    await coordinator.release(prepared.leases);
    const emptyInbox = await fetch(
      `${api}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
    );
    expect(emptyInbox.ok).toBe(true);
    const emptyInboxBody: unknown = await emptyInbox.json();
    expect(messageCount(emptyInboxBody)).toBe(0);
    await expect(inbox.readLatest(inboxLease)).rejects.toMatchObject({
      diagnostic: { code: ARXIC_FIXTURE_INBOX_MISSING, severity: 'blocked' },
    });
    const login = await submitServerAction({ cookies: new Map() }, '/login', { email, password });
    expect(login.headers.get('location')).toContain('Invalid%20credentials');
    const missing = await new FixtureCoordinator([]).prepare({ candidates: [workflowCandidate] });
    expect(missing.provisioned).toBe(false);
    expect(missing.diagnostics[0]?.code).toBe(ARXIC_FIXTURE_MISSING);
  }, 60_000);
});

interface BrowserState {
  cookies: Map<string, string>;
}

function captureCookies(state: BrowserState, response: Response): void {
  for (const cookie of response.headers.getSetCookie()) {
    const pair = cookie.split(';', 1)[0] ?? '';
    const separator = pair.indexOf('=');
    const name = pair.slice(0, separator);
    const value = pair.slice(separator + 1);
    if (value) state.cookies.set(name, value);
    else state.cookies.delete(name);
  }
}

async function browserFetch(
  state: BrowserState,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (state.cookies.size > 0) {
    headers.set('cookie', [...state.cookies].map(([key, value]) => `${key}=${value}`).join('; '));
  }
  if (init.method && init.method !== 'GET') headers.set('origin', origin);
  const response = await fetch(`${origin}${path}`, { ...init, headers, redirect: 'manual' });
  captureCookies(state, response);
  return response;
}

function hiddenFields(html: string): URLSearchParams {
  const values = new URLSearchParams();
  for (const input of html.match(/<input[^>]+type="hidden"[^>]+>/gu) ?? []) {
    const name = input.match(/name="([^"]+)"/u)?.[1];
    const value = input.match(/value="([^"]*)"/u)?.[1] ?? '';
    if (name) values.set(name, value.replaceAll('&amp;', '&'));
  }
  return values;
}

async function submitServerAction(
  state: BrowserState,
  path: string,
  fields: Record<string, string>,
): Promise<Response> {
  const page = await browserFetch(state, path);
  expect(page.status).toBe(200);
  const form = hiddenFields(await page.text());
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  const body = new FormData();
  form.forEach((value, key) => body.set(key, value));
  return browserFetch(state, path, { method: 'POST', body });
}

async function pollForMessage(
  inbox: InboxAdapter,
  lease: Parameters<InboxAdapter['readLatest']>[0],
  subject: string,
): Promise<string> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      return await inbox.readLatest(lease, { subject });
    } catch (error) {
      if (
        !error ||
        typeof error !== 'object' ||
        !('diagnostic' in error) ||
        !error.diagnostic ||
        typeof error.diagnostic !== 'object' ||
        !('code' in error.diagnostic) ||
        error.diagnostic.code !== ARXIC_FIXTURE_INBOX_MISSING
      ) {
        throw error;
      }
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error('ARXIC-FIXTURE-INBOX-MISSING blocked: reset email did not arrive');
}

function messageCount(value: unknown): number {
  if (!value || typeof value !== 'object' || !('messages' in value)) return -1;
  return Array.isArray(value.messages) ? value.messages.length : -1;
}

function candidate(preconditions: Workflow['preconditions']): Candidate {
  const workflow: Workflow = {
    $schema: 'https://arxic.dev/schemas/workflow/v1.json',
    id: 'authentication.fixture-real-world',
    version: 1,
    title: 'Fixture real-world proof',
    domain: 'authentication',
    persona: 'registered-user',
    status: 'hypothesized',
    confidence: 0.5,
    scope: {
      commit: '0'.repeat(40),
      environment: 'local-test',
      browser: 'chromium',
    },
    preconditions,
    states: [{ id: 'before' }, { id: 'after' }],
    transitions: [
      {
        from: 'before',
        to: 'after',
        action: { intent: 'Exercise real fixtures' },
        assertions: [{ intent: 'Real fixture outcome is observable' }],
        evidenceRefs: ['src:fixture-real-world'],
      },
    ],
    negativeCases: [],
    verification: { requiredRuns: 2, screenshotCheckpoints: [], forbidNetworkErrors: true },
    evidenceRefs: ['src:fixture-real-world'],
  };
  return { id: workflow.id, title: workflow.title, evidenceRefs: workflow.evidenceRefs, workflow };
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

async function readiness(url: string, child: ChildProcess): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Reference app exited with ${child.exitCode}`);
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
      continue;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
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
