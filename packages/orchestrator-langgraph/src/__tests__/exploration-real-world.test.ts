import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { access, mkdtemp, readdir, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { PlaywrightExplorationDriver, type LocatorPair } from '@arxic/playwright-agent-adapter';
import { inspectPlaywrightTrace } from '@arxic/playwright-trace-sanitizer';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ARXIC_EXPLORATION_APPROVAL_DENIED,
  ARXIC_EXPLORATION_BUDGET_EXHAUSTED,
  runExploration,
  runPlannedExploration,
} from '../exploration';
import type { Candidate } from '../types';

const execute = promisify(execFile);
const root = resolve(import.meta.dirname, '../../../..');
const appDir = resolve(root, 'test-fixtures/reference-auth-app');
const temporaryDirectories: string[] = [];
let app: ChildProcess | undefined;
let origin = '';
let evidenceDir = '';

describe('real stage-8 exploration proof', () => {
  beforeAll(async () => {
    await execute('pnpm', ['--filter', 'reference-auth-app', 'build'], {
      cwd: root,
      timeout: 180_000,
    });
    const runtime = await temporaryDirectory('exploration-runtime-');
    const port = await freePort();
    origin = `http://127.0.0.1:${port}`;
    evidenceDir =
      process.env.ARXIC_EXPLORATION_EVIDENCE_DIR ??
      (await temporaryDirectory('exploration-evidence-'));
    app = spawn(
      process.execPath,
      [resolve(appDir, 'node_modules/next/dist/bin/next'), 'start', '-p', String(port)],
      {
        cwd: appDir,
        env: {
          ...process.env,
          ARXIC_TARGET_ORIGIN: origin,
          ARXIC_ATTESTATION_NONCE: 'exploration-real-world-proof',
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
            personaId: 'exploration-user',
            email: 'exploration@example.test',
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

  it('observes the real login accessibility tree in Chromium within budget', async () => {
    const result = await runExploration({
      runId: 'real-read-only',
      origin,
      appBuildDigest: 'a'.repeat(64),
      candidates: [candidate('submit login form at /login')],
      budget: 8,
      driver: new PlaywrightExplorationDriver({ headless: true, evidenceDir }),
    });
    const tracePath = join(evidenceDir, 'exploration-trace.zip');
    const provenancePath = `${tracePath}.sanitization.json`;
    await Promise.all([access(tracePath), access(provenancePath)]);
    const inspection = await inspectPlaywrightTrace({
      tracePath,
      provenancePath,
      forbiddenSubstrings: ['exploration@example.test', 'Hunter2!', 'exploration-real-world-proof'],
    });
    expect(inspection).toMatchObject({
      ok: true,
      provenance: {
        logicalMembers: expect.arrayContaining(['trace-001.trace']),
        residualScan: { passed: true },
      },
    });
    const screenshots = (await readdir(evidenceDir)).filter((file) => file.endsWith('.png'));
    expect(screenshots.length).toBeGreaterThanOrEqual(1);
    const evidence = result.evidenceRefs.find(
      (item) => item.kind === 'runtime' && item.url.includes('/login'),
    );
    expect(result.approved).toBe(true);
    expect(evidence).toEqual(
      expect.objectContaining({
        kind: 'runtime',
        accessibilitySnapshotSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        browserVersion: expect.stringMatching(/^\d+\.\d+/),
        screenshotRef: expect.stringMatching(/^step-\d{2}-.+\.png$/),
      }),
    );
    if (evidence?.kind === 'runtime') {
      expect(screenshots).toContain(evidence.screenshotRef);
      process.stdout.write(
        `Exploration proof: sanitized action timeline and provenance retained; screenshots ${screenshots.length}\n`,
      );
    }
  }, 120_000);

  it('persists same-element locator proof for the real login fill and click plan', async () => {
    const email: LocatorPair = {
      semantic: { kind: 'label', text: 'Email', exact: true },
      execution: { kind: 'role', role: 'textbox', name: 'Email', exact: true },
    };
    const password: LocatorPair = {
      semantic: { kind: 'label', text: 'Password', exact: true },
      execution: { kind: 'label', text: 'Password', exact: true },
    };
    const submit: LocatorPair = {
      semantic: { kind: 'role', role: 'button', name: 'Login', exact: true },
      execution: { kind: 'role', role: 'button', name: 'Login', exact: true },
    };
    const locatorEvidenceDir = await temporaryDirectory('locator-provenance-evidence-');
    const result = await runPlannedExploration({
      runId: 'real-locator-provenance',
      origin,
      appBuildDigest: 'a'.repeat(64),
      candidates: [],
      budget: 4,
      driver: new PlaywrightExplorationDriver({
        headless: true,
        evidenceDir: locatorEvidenceDir,
      }),
      lease: {
        id: 'real-locator-provenance-lease',
        owner: 'exploration-real-world-test',
        expiresAt: '2099-01-01T00:00:00.000Z',
        inUse: false,
      },
      plan: {
        steps: [
          {
            intent: 'open login page',
            action: 'navigation',
            actionClass: 'read-only',
            kind: 'navigate',
            url: `${origin}/login`,
            required: true,
          },
          {
            intent: 'fill login email',
            action: 'fixture-change',
            actionClass: 'reversible-mutation',
            kind: 'fill',
            locator: email,
            value: 'exploration@example.test',
            required: true,
          },
          {
            intent: 'fill login password',
            action: 'fixture-change',
            actionClass: 'reversible-mutation',
            kind: 'fill',
            locator: password,
            value: 'Hunter2!',
            required: true,
          },
          {
            intent: 'click login submit',
            action: 'form-submit',
            actionClass: 'reversible-mutation',
            kind: 'click',
            locator: submit,
            required: true,
          },
        ],
      },
      now: () => '2026-08-12T00:00:00.000Z',
    });

    expect(result.approved).toBe(true);
    expect(result.locatorProvenance?.records).toEqual([
      { intent: 'fill login email', resolved: true, sameElementProof: true, ...email },
      { intent: 'fill login password', resolved: true, sameElementProof: true, ...password },
      { intent: 'click login submit', resolved: true, sameElementProof: true, ...submit },
    ]);
    expect(JSON.stringify(result.locatorProvenance?.records)).not.toContain('executionHandle');

    const tracePath = join(locatorEvidenceDir, 'exploration-trace.zip');
    const provenancePath = `${tracePath}.sanitization.json`;
    await Promise.all([access(tracePath), access(provenancePath)]);
    const inspection = await inspectPlaywrightTrace({
      tracePath,
      provenancePath,
      forbiddenSubstrings: ['exploration@example.test', 'Hunter2!', 'exploration-real-world-proof'],
    });
    expect(inspection).toMatchObject({
      ok: true,
      provenance: { residualScan: { passed: true } },
    });
    const screenshots = (await readdir(locatorEvidenceDir)).filter((file) => file.endsWith('.png'));
    expect(screenshots).toContain('step-00-open-login-page.png');
    process.stdout.write(
      `Locator provenance proof: ${result.locatorProvenance?.records.length} identity receipts; sanitized timeline retained\n`,
    );
  }, 120_000);

  it('blocks a destructive intent until a human approval is recorded', async () => {
    const withoutApproval = await runExploration({
      runId: 'real-destructive-denied',
      origin,
      appBuildDigest: 'a'.repeat(64),
      candidates: [candidate('delete user at /account')],
      budget: 8,
    });
    expect(withoutApproval.approved).toBe(false);
    expect(withoutApproval.decisions).toContainEqual(
      expect.stringContaining(ARXIC_EXPLORATION_APPROVAL_DENIED),
    );

    const withApproval = await runExploration({
      runId: 'real-destructive-approved',
      origin,
      appBuildDigest: 'a'.repeat(64),
      candidates: [candidate('delete user at /account')],
      approval: {
        approver: 'owner@example.test',
        approvedAt: '2026-08-07T00:00:00.000Z',
        reason: 'authorize policy gate; do not execute destructive action',
      },
      budget: 8,
      driver: new PlaywrightExplorationDriver({ headless: true, evidenceDir }),
    });
    expect(withApproval.approved).toBe(true);
    expect(withApproval.decisions.join('\n')).not.toContain(ARXIC_EXPLORATION_APPROVAL_DENIED);
  }, 120_000);

  it('blocks zero budget without launching a browser or throwing', async () => {
    const result = await runExploration({
      runId: 'real-budget-zero',
      origin,
      candidates: [candidate('navigate to /login')],
      budget: 0,
    });
    expect(result.approved).toBe(false);
    expect(result.evidenceRefs).toEqual([]);
    expect(result.decisions).toContainEqual(
      expect.stringContaining(ARXIC_EXPLORATION_BUDGET_EXHAUSTED),
    );
  }, 120_000);

  it('no-ops empty candidate exploration without touching Chromium', async () => {
    const result = await runExploration({
      runId: 'real-empty',
      origin,
      candidates: [],
      budget: 8,
    });
    expect(result).toEqual({
      approved: true,
      evidenceRefs: [],
      decisions: ['No exploration steps; nothing to observe'],
    });
  }, 120_000);
});

function candidate(intent: string): Candidate {
  return {
    id: `authentication.${intent.startsWith('delete') ? 'delete' : 'login'}`,
    title: 'Login exploration',
    evidenceRefs: ['src:login'],
    workflow: {
      $schema: 'https://arxic.dev/schemas/workflow/v1.json',
      id: `authentication.${intent.startsWith('delete') ? 'delete' : 'login'}`,
      version: 1,
      title: 'Login exploration',
      domain: 'authentication',
      persona: 'registered-user',
      status: 'hypothesized',
      confidence: 0.5,
      scope: { commit: 'a'.repeat(40), environment: 'local-test', browser: 'chromium' },
      preconditions: [],
      states: [{ id: 'signed-out' }, { id: 'signed-in' }],
      transitions: [
        {
          from: 'signed-out',
          to: 'signed-in',
          action: { intent },
          assertions: [{ intent: 'login page is visible' }],
          evidenceRefs: ['src:login'],
        },
      ],
      negativeCases: [],
      verification: {
        requiredRuns: 2,
        screenshotCheckpoints: ['signed-in'],
        forbidNetworkErrors: true,
        trace: 'retain',
      },
      evidenceRefs: ['src:login'],
    },
  };
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
