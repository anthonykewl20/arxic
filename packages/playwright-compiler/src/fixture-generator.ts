import type { Workflow } from '@arxic/contracts';

/**
 * Ephemeral verifier-to-fixture channel for a per-pass replay-persona state.
 * The value is never emitted into generated source or persisted artifacts.
 */
export const REPLAY_PERSONA_STORAGE_STATE_ENV = 'ARXIC_REPLAY_PERSONA_STORAGE_STATE';

/**
 * A workflow owns its login interaction when a transition supplies the login
 * identity ref (email) without a new-password ref — with or without a
 * password ref, so passwordless (email-only) login surfaces count (#367).
 * Refs compare case-insensitively: `persona.newPassword` (in-repo spelling)
 * must hit the same change-password exclusion as `persona.newpassword`.
 * Password-plus-new-password flows and single-transition change-password
 * forms still do not match: both start authenticated.
 */
export function workflowPerformsLogin(workflow: Workflow): boolean {
  return workflow.transitions.some((transition) => {
    const inputRefs = Object.values(transition.action.inputRefs ?? {}).map((ref) =>
      ref.toLowerCase(),
    );
    return inputRefs.includes('persona.email') && !inputRefs.includes('persona.newpassword');
  });
}

export function generateFixture(workflow: Workflow, approvedOrigins: string[] = []): string {
  void approvedOrigins;
  const contextFixture = workflowPerformsLogin(workflow)
    ? [
        'export const test = base.extend({',
        '  context: async ({ browser }, use) => {',
        '    const context = await browser.newContext();',
        '    await context.clearCookies();',
        '    try {',
        '      await use(context);',
        '    } finally {',
        '      await context.close();',
        '    }',
        '  },',
        '});',
      ]
    : [
        // #362: post-login workflows start from the ephemeral authenticated
        // replay-persona state when the verifier injects it into the child env.
        `const REPLAY_PERSONA_STORAGE_STATE_ENV = ${JSON.stringify(REPLAY_PERSONA_STORAGE_STATE_ENV)};`,
        '',
        '// #362: post-login replay contexts may use ephemeral persona storage state.',
        'export const test = base.extend({',
        '  context: async ({ browser }, use) => {',
        '    const raw = process.env[REPLAY_PERSONA_STORAGE_STATE_ENV];',
        '    let storageState;',
        '    if (raw) {',
        '      try {',
        '        storageState = JSON.parse(raw);',
        "        if (!storageState || !Array.isArray(storageState.cookies) || !Array.isArray(storageState.origins)) throw new Error('invalid storage state');",
        '      } catch {',
        "        throw new Error('ARXIC-COMPILE-REPLAY-PERSONA-STATE-INVALID: verifier storage state was unavailable');",
        '      }',
        '    }',
        // Anonymous replays retain clear-cookie hygiene. Persona replays build
        // from the captured state instead, so cookies remain available to the workflow.
        '    const context = await browser.newContext(storageState ? { storageState } : undefined);',
        '    if (!storageState) await context.clearCookies();',
        '    try {',
        '      await use(context);',
        '    } finally {',
        '      await context.close();',
        '    }',
        '  },',
        '});',
      ];
  return [
    "import { test as base, expect } from '@playwright/test';",
    'import {',
    '  installTransitionReceiptListeners,',
    '  withReceiptAttribution,',
    '  writeTransitionReceipts,',
    "} from './transition-receipts';",
    '',
    'const approvedOrigins = new Set();',
    "const ORIGIN_DENIED = 'ARXIC-COMPILE-ORIGIN-DENIED';",
    'const violations = new WeakMap();',
    'const cdpSessions = new WeakMap();',
    ...contextFixture,
    '',
    'export function configureApprovedOrigins(origins) {',
    '  approvedOrigins.clear();',
    '  for (const origin of origins) {',
    '    approvedOrigins.add(origin);',
    '    const alias = new URL(origin);',
    "    if (alias.hostname === '127.0.0.1') alias.hostname = 'localhost';",
    "    else if (alias.hostname === 'localhost') alias.hostname = '127.0.0.1';",
    '    else continue;',
    '    approvedOrigins.add(alias.origin);',
    '  }',
    '}',
    '',
    'export function assertNetworkContained(context) {',
    '  const denied = violations.get(context)?.denied ?? [];',
    '  if (denied.length > 0) {',
    '    throw new Error(`${ORIGIN_DENIED}: blocked request to unapproved origin ${denied[0]}`);',
    '  }',
    '}',
    '',
    'export async function enforceNetworkContainment(page, operation) {',
    '  const context = page.context();',
    '  const state = violations.get(context);',
    '  if (!state) throw new Error(`${ORIGIN_DENIED}: network policy was not installed`);',
    // #307/F-E8: every contained action is also an attribution window —
    // requests SENT while the awaited operation races are workflow-attributed.
    "  return withReceiptAttribution(page, 'action', () =>",
    '    Promise.race([operation(), state.violation]),',
    '  );',
    '}',
    '',
    'export function assertPageOrigin(page) {',
    '  const pageOrigin = new URL(page.url()).origin;',
    '  if (!approvedOrigins.has(pageOrigin)) {',
    '    throw new Error(`${ORIGIN_DENIED}: blocked navigation to unapproved origin ${pageOrigin}`);',
    '  }',
    '}',
    '',
    'test.beforeEach(async ({ browserName, context, page }, testInfo) => {',
    "  if (browserName !== 'chromium') {",
    '    throw new Error(`${ORIGIN_DENIED}: redirect containment requires Chromium CDP`);',
    '  }',
    '  const denied = [];',
    '  let rejectViolation;',
    '  const violation = new Promise((_, reject) => { rejectViolation = reject; });',
    '  violations.set(context, { denied, violation, rejectViolation });',
    "  await context.route('**/*', async (route) => {",
    '    const requestUrl = new URL(route.request().url());',
    "    if ((requestUrl.protocol === 'http:' || requestUrl.protocol === 'https:') && !approvedOrigins.has(requestUrl.origin)) {",
    '      denied.push(requestUrl.origin);',
    '      rejectViolation(new Error(`${ORIGIN_DENIED}: blocked request to unapproved origin ${requestUrl.origin}`));',
    "      await route.abort('blockedbyclient');",
    '      return;',
    '    }',
    '    await route.continue();',
    '  });',
    "  await context.routeWebSocket('**/*', async (webSocket) => {",
    '    const webSocketUrl = new URL(webSocket.url());',
    "    webSocketUrl.protocol = webSocketUrl.protocol === 'ws:' ? 'http:' : 'https:';",
    '    const webSocketOrigin = webSocketUrl.origin;',
    '    if (!approvedOrigins.has(webSocketOrigin)) {',
    '      denied.push(webSocketOrigin);',
    '      rejectViolation(new Error(`${ORIGIN_DENIED}: blocked WebSocket to unapproved origin ${webSocketOrigin}`));',
    "      await webSocket.close({ code: 1008, reason: 'origin denied' });",
    '      return;',
    '    }',
    '    webSocket.connectToServer();',
    '  });',
    '  const session = await context.newCDPSession(page);',
    '  cdpSessions.set(context, session);',
    "  session.on('Fetch.requestPaused', async (event) => {",
    '    try {',
    '      const status = event.responseStatusCode;',
    "      const location = event.responseHeaders?.find((header) => header.name.toLowerCase() === 'location')?.value;",
    '      if (status !== undefined && status >= 300 && status < 400 && location) {',
    '        const redirectOrigin = new URL(location, event.request.url).origin;',
    '        if (!approvedOrigins.has(redirectOrigin)) {',
    '          denied.push(redirectOrigin);',
    '          rejectViolation(new Error(`${ORIGIN_DENIED}: blocked redirect to unapproved origin ${redirectOrigin}`));',
    "          await session.send('Fetch.failRequest', { requestId: event.requestId, errorReason: 'BlockedByClient' });",
    '          return;',
    '        }',
    '      }',
    "      await session.send('Fetch.continueResponse', { requestId: event.requestId });",
    '    } catch (error) {',
    '      rejectViolation(error);',
    '      try {',
    "        await session.send('Fetch.failRequest', { requestId: event.requestId, errorReason: 'BlockedByClient' });",
    '      } catch {}',
    '    }',
    '  });',
    "  await session.send('Fetch.enable', { patterns: [{ requestStage: 'Response' }] });",
    '  installTransitionReceiptListeners(context, page, testInfo);',
    '});',
    '',
    'test.afterEach(async ({ context }) => {',
    '  await writeTransitionReceipts(context);',
    '  const session = cdpSessions.get(context);',
    '  if (session) {',
    "    await session.send('Fetch.disable').catch(() => undefined);",
    '    await session.detach().catch(() => undefined);',
    '    cdpSessions.delete(context);',
    '  }',
    "  await context.unrouteAll({ behavior: 'ignoreErrors' });",
    '  await context.clearCookies();',
    '  assertNetworkContained(context);',
    '});',
    '',
    "test.describe.configure({ mode: 'serial' });",
    'export { expect };',
    '',
  ].join('\n');
}

export function generateConfig(
  workflow: Workflow,
  options: { trace?: 'workflow-policy' | 'off' } = {},
): string {
  // Raw traces require the managed verifier sanitization lifecycle. A copied
  // bundle replayed directly must not retain them on failure.
  const trace =
    options.trace !== 'workflow-policy'
      ? 'off'
      : workflow.verification.trace === 'retain'
        ? 'retain-on-failure'
        : 'off';
  return [
    "import { defineConfig } from '@playwright/test';",
    '',
    'export default defineConfig({',
    "  testDir: './tests',",
    '  workers: 1,',
    "  outputDir: './artifacts/test-results',",
    `  use: { browserName: ${JSON.stringify(workflow.scope.browser)}, headless: true, trace: ${JSON.stringify(trace)}, serviceWorkers: 'block' },`,
    '});',
    '',
  ].join('\n');
}
