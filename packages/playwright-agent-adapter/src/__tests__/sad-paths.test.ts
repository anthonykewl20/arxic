import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  PlaywrightAgentAdapter,
  REQUIRED_TOOLS,
  evaluateHealProposal,
  generateSpecFromWorkflow,
  runFallback,
  validateHandshake,
} from '..';
import { loginWorkflow } from './workflow-fixture';

const stub = fileURLToPath(new URL('./stub-mcp.mjs', import.meta.url));
const server = { name: 'Playwright Test Runner', version: '1.62.1' };
const tools = () =>
  Object.entries(REQUIRED_TOOLS).map(([name, keys]) => ({
    name,
    inputSchema: { properties: Object.fromEntries(keys.map((key) => [key, {}])) },
  }));

describe('Playwright agent sad paths resolve blocked', () => {
  it('fails closed when test_run is absent from both validator and process handshake', async () => {
    expect(
      validateHandshake(
        server,
        tools().filter((tool) => tool.name !== 'test_run'),
      ),
    ).toMatchObject({
      ok: false,
      missingTools: ['test_run'],
    });
    const configPath = join(await mkdtemp(join(tmpdir(), 'arxic-missing-')), 'missing.config.ts');
    await writeFile(configPath, '');
    const adapter = new PlaywrightAgentAdapter({ configPath, cliPath: stub });
    expect(await adapter.handshake()).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'ARXIC-AGENT-TOOL-MISSING', severity: 'blocked' }],
    });
    await adapter.close();
  });

  it('fails closed when the test_run schema drifts in validator and process handshake', async () => {
    const changed = tools().map((tool) =>
      tool.name === 'test_run' ? { ...tool, inputSchema: { properties: { changed: {} } } } : tool,
    );
    expect(validateHandshake(server, changed)).toMatchObject({
      ok: false,
      schemaDrift: ['test_run'],
    });
    const configPath = join(await mkdtemp(join(tmpdir(), 'arxic-drift-')), 'drift.config.ts');
    await writeFile(configPath, '');
    const adapter = new PlaywrightAgentAdapter({ configPath, cliPath: stub });
    expect(await adapter.handshake()).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'ARXIC-AGENT-SCHEMA-DRIFT', severity: 'blocked' }],
    });
    await adapter.close();
  });

  for (const [name, proposedSpec] of [
    ['test skip', "test.skip('x', () => expect(1).toBe(1))"],
    ['test fixme', "test.fixme('x', () => expect(1).toBe(1))"],
    ['test only', "test.only('x', () => expect(1).toBe(1))"],
    ['member-call skip', "test('x', () => test.skip())"],
    ['member-call fixme', "test('x', () => test.fixme())"],
    ['member-call only', "test('x', () => suite.only())"],
    ['quarantine', "test('quarantined x', () => expect(1).toBe(1))"],
  ]) {
    it(`rejects ${name}`, () => {
      expect(
        evaluateHealProposal({
          originalSpec: "test('x', () => expect(1).toBe(1))",
          proposedSpec,
          allowedOrigins: [],
        }),
      ).toMatchObject({ accepted: false, diagnostic: { severity: 'blocked' } });
    });
  }

  it('rejects a deleted assertion', () => {
    expect(
      evaluateHealProposal({
        originalSpec: 'expect(page).toHaveURL("/")',
        proposedSpec: 'page.url()',
        allowedOrigins: [],
      }),
    ).toMatchObject({ accepted: false, diagnostic: { severity: 'blocked' } });
  });

  it('rejects an assertion weakened to a pass-through matcher', () => {
    expect(
      evaluateHealProposal({
        originalSpec: "expect(page).toHaveURL('/')",
        proposedSpec: 'expect(true).toBe(true)',
        allowedOrigins: [],
      }),
    ).toMatchObject({ accepted: false, diagnostic: { severity: 'blocked' } });
  });

  it('rejects cross-origin, destructive, and external-side-effect proposals', () => {
    const base = { originalSpec: 'expect(1).toBe(1)', proposedSpec: 'expect(1).toBe(1)' };
    expect(
      evaluateHealProposal({
        ...base,
        origins: ['https://outside.test'],
        allowedOrigins: ['https://safe.test'],
      }),
    ).toMatchObject({ accepted: false, diagnostic: { severity: 'blocked' } });
    expect(
      evaluateHealProposal({ ...base, actionClass: 'destructive', allowedOrigins: [] }),
    ).toMatchObject({ accepted: false, diagnostic: { severity: 'blocked' } });
    expect(
      evaluateHealProposal({ ...base, actionClass: 'external-side-effect', allowedOrigins: [] }),
    ).toMatchObject({ accepted: false, diagnostic: { severity: 'blocked' } });
  });

  it('accepts a locator swap that preserves assertions and boundaries', () => {
    expect(
      evaluateHealProposal({
        originalSpec: "expect(page.locator('#submit')).toBeVisible()",
        proposedSpec: "expect(page.getByRole('button')).toBeVisible()",
        origins: ['https://safe.test'],
        allowedOrigins: ['https://safe.test'],
        actionClass: 'read-only',
      }),
    ).toEqual({ accepted: true });
  });

  it('passes shell metacharacters literally without creating a marker', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'arxic-agent-shell-'));
    const marker = join(directory, 'pwned');
    const configPath = `nonexistent; touch ${marker}; $(touch ${marker})`;
    const adapter = new PlaywrightAgentAdapter({ configPath, timeoutMs: 10_000 });
    expect(await adapter.handshake()).toMatchObject({ ok: false });
    await adapter.close();
    await expect(access(marker)).rejects.toThrow();
  });

  it('blocks an unavailable agent while a valid Workflow IR still yields a listable fallback', async () => {
    const configPath = join(
      await mkdtemp(join(tmpdir(), 'arxic-unavailable-')),
      'playwright.config.ts',
    );
    await writeFile(configPath, '');
    const adapter = new PlaywrightAgentAdapter({
      configPath,
      cliPath: '/definitely/not/an/agent.js',
      timeoutMs: 5_000,
    });
    expect(await adapter.handshake()).toMatchObject({ ok: false });
    await adapter.close();
    const testDir = await mkdtemp(join(tmpdir(), 'arxic-fallback-'));
    const generated = await generateSpecFromWorkflow(loginWorkflow(), {
      origin: 'http://127.0.0.1:9',
      testDir,
    });
    expect(generated).toMatchObject({ ok: true, diagnostics: [] });
    const result = await runFallback({ testDir });
    expect(result.listed).toBeGreaterThanOrEqual(1);
    expect(result.disposition).toBe('blocked');
    await rm(testDir, { recursive: true, force: true });
  }, 15_000);

  it('blocks invalid Workflow IR without emitting a spec', async () => {
    const testDir = await mkdtemp(join(tmpdir(), 'arxic-invalid-workflow-'));
    const invalid = { ...loginWorkflow(), transitions: [] };
    const generated = await generateSpecFromWorkflow(invalid, {
      origin: 'http://127.0.0.1:9',
      testDir,
    });
    expect(generated).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'ARXIC-AGENT-WORKFLOW-INVALID', severity: 'blocked' }],
    });
    expect(generated).not.toHaveProperty('specPath');
  });
});
