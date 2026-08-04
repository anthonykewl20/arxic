import { createRequire } from 'node:module';
import { validateDiagnostic } from '@arxic/contracts';
import { describe, expect, it } from 'vitest';
import * as exports from '..';
import {
  AGENT_DIAGNOSTIC_CODES,
  EXPECTED_SERVER_VERSION,
  PLAYWRIGHT_VERSION,
  REQUIRED_TOOLS,
  validateHandshake,
} from '..';

const require = createRequire(import.meta.url);

const expected = {
  planner_setup_page: ['project', 'seedFile'],
  planner_submit_plan: ['overview', 'suites'],
  planner_save_plan: ['overview', 'suites', 'name', 'fileName'],
  generator_setup_page: ['plan', 'project', 'seedFile'],
  generator_read_log: [],
  generator_write_test: ['fileName', 'code'],
  test_list: [],
  test_run: ['locations', 'projects'],
  test_debug: ['test'],
};
const server = { name: 'Playwright Test Runner', version: '1.62.1' };
const tools = Object.entries(expected).map(([name, keys]) => ({
  name,
  inputSchema: { properties: Object.fromEntries(keys.map((key) => [key, {}])) },
}));

describe('ADR §23.14 Playwright 1.62.1 agent contract gate', () => {
  it('keeps the hand-written nine-tool upgrade baseline exact', () => {
    expect(REQUIRED_TOOLS).toEqual(expected);
  });

  it('keeps the handshake version aligned with the installed exact pin', () => {
    const installed = require('@playwright/test/package.json') as { version: string };
    expect(PLAYWRIGHT_VERSION).toBe('1.62.1');
    expect(EXPECTED_SERVER_VERSION).toBe(PLAYWRIGHT_VERSION);
    expect(installed.version).toBe(PLAYWRIGHT_VERSION);
    expect(validateHandshake({ ...server, version: '1.62.2' }, tools)).toMatchObject({
      ok: false,
      schemaDrift: ['serverInfo.version'],
      diagnostics: [{ subject: 'serverInfo.version' }],
    });
  });

  it('loop-closes every exported diagnostic through the frozen validator', () => {
    const codes = (Object.values(exports) as unknown[]).filter(
      (value): value is string => typeof value === 'string' && value.startsWith('ARXIC-AGENT-'),
    );
    expect(codes.sort()).toEqual([...AGENT_DIAGNOSTIC_CODES].sort());
    for (const code of codes)
      expect(
        validateDiagnostic({ code, severity: 'blocked', subject: 'gate', message: 'test' }),
      ).toMatchObject({ ok: true });
  });

  it('accepts only the exact contract and rejects each tool removal and schema mutation', () => {
    expect(validateHandshake(server, tools)).toMatchObject({ ok: true });
    for (const tool of tools) {
      expect(
        validateHandshake(
          server,
          tools.filter((item) => item.name !== tool.name),
        ),
      ).toMatchObject({ ok: false });
      const mutated = tools.map((item) =>
        item.name === tool.name ? { ...item, inputSchema: { properties: { drifted: {} } } } : item,
      );
      expect(validateHandshake(server, mutated)).toMatchObject({ ok: false });
    }
  });
});
