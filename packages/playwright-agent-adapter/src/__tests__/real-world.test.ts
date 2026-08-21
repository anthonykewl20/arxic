import { execFile } from 'node:child_process';
import { createServer } from 'node:net';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import type { ChildProcess } from 'node:child_process';
import {
  SCREENSHOT_CAPTURE_CORRELATION_ENV,
  SCREENSHOT_CAPTURED_AT_ENV,
  SCREENSHOT_PRIVACY_POLICY_ENV,
  SCREENSHOT_PRIVACY_POLICY_SHA256_ENV,
  serializeScreenshotPrivacyPolicy,
} from '@arxic/playwright-screenshot-privacy';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  PlaywrightAgentAdapter,
  REQUIRED_TOOLS,
  generateSpecFromWorkflow,
  installedChromiumVersion,
  runFallback,
} from '..';
import { elementIdentityProbe } from '../exploration-driver';
import { loginWorkflow } from './workflow-fixture';

const execute = promisify(execFile);
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const appDir = resolve(root, 'test-fixtures/reference-auth-app');
const nextCli = resolve(appDir, 'node_modules/next/dist/bin/next');
let app: ChildProcess | undefined;
let origin = '';
let database = '';
const temporaryProjects: string[] = [];

describe('real Playwright agent and Chromium proof', () => {
  beforeAll(async () => {
    await execute('pnpm', ['--filter', 'reference-auth-app', 'build'], {
      cwd: root,
      timeout: 120_000,
    });
    const port = await freePort();
    origin = `http://127.0.0.1:${port}`;
    const directory = await mkdtemp(join(tmpdir(), 'arxic-agent-real-'));
    temporaryProjects.push(directory);
    database = join(directory, 'auth.db');
    const { spawn } = await import('node:child_process');
    app = spawn(process.execPath, [nextCli, 'start', '-p', String(port)], {
      cwd: appDir,
      env: { ...process.env, ARXIC_DB_PATH: database },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });
    await readiness(origin, app);
    expect((await fetch(`${origin}/__arxic/reset`, { method: 'POST' })).status).toBe(204);
    const seeded = await fetch(`${origin}/__arxic/seed`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        personaId: 'agent-user',
        email: 'agent@example.test',
        password: 'Hunter2!',
      }),
    });
    expect(seeded.status).toBe(201);
  }, 120_000);

  afterAll(async () => {
    await stop(app);
    await Promise.all(temporaryProjects.map((path) => rm(path, { recursive: true, force: true })));
    for (const path of temporaryProjects) await expect(access(path)).rejects.toThrow();
  });

  it('handshakes twice deterministically and runs login in real Chromium through the real agent', async () => {
    const project = await mkdtemp(join(tmpdir(), 'arxic-agent-project-'));
    temporaryProjects.push(project);
    expect(
      await generateSpecFromWorkflow(loginWorkflow(), { origin, testDir: project }),
    ).toMatchObject({
      ok: true,
    });
    const configPath = join(project, 'playwright.config.ts');
    await writeFile(
      configPath,
      [
        "import { defineConfig } from '@playwright/test';",
        "export default defineConfig({ testDir: '.', workers: 1, use: { browserName: 'chromium', headless: true, trace: 'retain-on-failure' } });",
      ].join('\n'),
    );
    await writeFile(
      join(project, 'real-login.spec.ts'),
      [
        "import { test, expect } from '@playwright/test';",
        "test('real reference login', async ({ page }) => {",
        `  await page.goto(${JSON.stringify(`${origin}/login`)});`,
        "  await page.getByLabel('Email').fill('agent@example.test');",
        "  await page.getByLabel('Password').fill('Hunter2!');",
        "  await page.getByRole('button', { name: 'Login' }).click();",
        `  await expect(page).toHaveURL(${JSON.stringify(`${origin}/`)});`,
        '});',
      ].join('\n'),
    );
    const firstAdapter = new PlaywrightAgentAdapter({ configPath, timeoutMs: 120_000 });
    const first = await firstAdapter.handshake();
    await firstAdapter.close();
    const adapter = new PlaywrightAgentAdapter({ configPath, timeoutMs: 120_000 });
    const second = await adapter.handshake();
    expect(first.ok).toBe(true);
    expect(second.serverInfo).toEqual({ name: 'Playwright Test Runner', version: '1.62.1' });
    expect(second.tools).toEqual(first.tools);
    for (const [name, keys] of Object.entries(REQUIRED_TOOLS)) {
      const tool = second.tools.find((item) => item.name === name);
      expect(Object.keys(tool?.inputSchema?.properties ?? {}).sort()).toEqual([...keys].sort());
    }
    const listed = await adapter.listTests();
    expect(listed.ok).toBe(true);
    expect(listed.output).toContain('real-login.spec.ts');
    const run = await adapter.runTests({ locations: ['real-login.spec.ts'] });
    expect(run.ok).toBe(true);
    expect(run.output).toMatch(/1 passed|passed.*1/iu);
    await adapter.close();
  }, 120_000);

  it('generates, lists, and runs the real staged login Workflow in Chromium as observed', async () => {
    const testDir = await mkdtemp(join(tmpdir(), 'arxic-fallback-real-'));
    temporaryProjects.push(testDir);
    const workflow = loginWorkflow();
    workflow.id = 'ARXIC_BROWSER_VERSION:fake';
    const generated = await generateSpecFromWorkflow(workflow, { origin, testDir });
    expect(generated).toMatchObject({ ok: true, diagnostics: [] });
    const policy = serializeScreenshotPrivacyPolicy({
      schemaVersion: 1,
      id: 'fallback-reference-heading',
      authority: {
        kind: 'repository-policy',
        reference: 'docs/evidence/M1-SCREENSHOT-PRIVACY/README.md',
        recordedAt: '2026-08-09T12:00:00.000Z',
      },
      capture: {
        mode: 'approved-region',
        region: { kind: 'role', role: 'heading', name: 'Reference Auth App', exact: true },
        masks: [],
      },
    });
    const environment = {
      ARXIC_INPUT_PERSONA_EMAIL: 'agent@example.test',
      ARXIC_INPUT_PERSONA_PASSWORD: 'Hunter2!',
      [SCREENSHOT_PRIVACY_POLICY_ENV]: policy.json,
      [SCREENSHOT_PRIVACY_POLICY_SHA256_ENV]: policy.sha256,
      [SCREENSHOT_CAPTURE_CORRELATION_ENV]: 'fallback-real-world-correlation-0001',
      [SCREENSHOT_CAPTURED_AT_ENV]: '2026-08-09T12:01:00.000Z',
    };
    const previous = new Map(
      Object.keys(environment).map((name) => [name, process.env[name]] as const),
    );
    Object.assign(process.env, environment);
    let result: Awaited<ReturnType<typeof runFallback>>;
    try {
      result = await runFallback({ testDir });
    } finally {
      for (const [name, value] of previous) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
    expect(result.listed).toBeGreaterThanOrEqual(1);
    expect(result.passed).toBeGreaterThanOrEqual(1);
    expect(result.failed).toBe(0);
    expect(result.disposition).toBe('observed');
    expect(result.diagnostics).toEqual([]);
    expect(result.output).toContain('ARXIC_BROWSER_VERSION:fake');
    expect(await installedChromiumVersion()).not.toBe('fake');
  }, 120_000);

  // DG-289 (#289, C-1): the trusted referential-identity probe serialized
  // into the page by the exploration driver must stay serialization-safe
  // (no named inner functions, no closure captures) and must evaluate in a
  // real page — at baseline product code the tsx lane injected `__name`
  // into serialized callbacks and killed every such evaluation.
  it('evaluates the serialization-safe element-identity probe in real Chromium', async () => {
    expect(String(elementIdentityProbe)).not.toContain('__name');
    const { chromium } = await import('@playwright/test');
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(origin);
      const heading = await page.locator('h1').first().elementHandle();
      const alias = await page.locator('h1').nth(0).elementHandle();
      const other = await page.locator('body').first().elementHandle();
      if (!heading || !alias || !other) throw new Error('reference app handles missing');
      expect(await page.evaluate(elementIdentityProbe, [heading, alias])).toBe(true);
      expect(await page.evaluate(elementIdentityProbe, [heading, other])).toBe(false);
    } finally {
      await browser.close();
    }
  }, 60_000);
});

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveReady, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolveReady());
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise<void>((resolveClose, reject) =>
    server.close((error) => (error ? reject(error) : resolveClose())),
  );
  return port;
}

async function readiness(url: string, child: ChildProcess): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null)
      throw new Error(`next start exited before readiness (${String(child.exitCode)})`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch (error) {
      if (attempt === 79) throw error;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error('next start readiness timed out');
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
