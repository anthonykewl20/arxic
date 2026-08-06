import type { Workflow } from '@arxic/contracts';

export function generateFixture(workflow: Workflow): string {
  void workflow;
  return [
    "import { test as base, expect } from '@playwright/test';",
    '',
    'export const test = base.extend({',
    '});',
    '',
    'test.beforeEach(async ({ context }) => {',
    '  await context.clearCookies();',
    '});',
    '',
    'test.afterEach(async ({ context }) => {',
    '  await context.clearCookies();',
    '});',
    '',
    "test.describe.configure({ mode: 'serial' });",
    'export { expect };',
    '',
  ].join('\n');
}

export function generateConfig(workflow: Workflow): string {
  return [
    "import { defineConfig } from '@playwright/test';",
    '',
    'export default defineConfig({',
    "  testDir: './tests',",
    '  workers: 1,',
    "  outputDir: './artifacts/test-results',",
    `  use: { browserName: ${JSON.stringify(workflow.scope.browser)}, headless: true, trace: ${JSON.stringify(workflow.verification.trace === 'retain' ? 'retain-on-failure' : 'off')} },`,
    '});',
    '',
  ].join('\n');
}
