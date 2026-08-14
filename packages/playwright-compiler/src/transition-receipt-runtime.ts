/**
 * Source for the generated fixture-side receipt service. The verifier supplies
 * a fresh nonce and independently validates the resulting JSON after the
 * Playwright child process exits.
 */
export function transitionReceiptRuntimeSource(): string {
  return [
    "import { createHash } from 'node:crypto';",
    "import { mkdir, writeFile } from 'node:fs/promises';",
    "import { dirname } from 'node:path';",
    '',
    "const RECEIPT_PATH_ENV = 'ARXIC_TRANSITION_RECEIPTS_PATH';",
    "const RECEIPT_NONCE_ENV = 'ARXIC_TRANSITION_RECEIPTS_NONCE';",
    'const states = new WeakMap();',
    '',
    'export function installTransitionReceiptListeners(context, page, testInfo) {',
    '  const state = { testTitle: testInfo.title, transitions: [], events: [] };',
    '  states.set(context, state);',
    "  context.on('requestfailed', (request) => {",
    "    const error = request.failure()?.errorText ?? 'unknown request failure';",
    "    if (error !== 'net::ERR_ABORTED') state.events.push({ kind: 'requestfailed', url: request.url(), error });",
    '  });',
    "  context.on('response', (response) => {",
    "    if (response.status() >= 400) state.events.push({ kind: 'http-response', url: response.url(), status: response.status() });",
    '  });',
    "  page.on('console', (message) => {",
    "    if (message.type() === 'error') state.events.push({ kind: 'console-error', message: message.text() });",
    '  });',
    "  page.on('pageerror', (error) => {",
    "    state.events.push({ kind: 'pageerror', message: error instanceof Error ? error.message : String(error) });",
    '  });',
    '}',
    '',
    'export function recordTransitionReceipt(page, id, stepName) {',
    '  const state = states.get(page.context());',
    "  if (!state) throw new Error('ARXIC-TRANSITION-RECEIPT-UNAVAILABLE: listener state was not installed');",
    '  state.transitions.push({ id, stepName, url: page.url() });',
    '}',
    '',
    'export async function writeTransitionReceipts(context) {',
    '  const path = process.env[RECEIPT_PATH_ENV];',
    '  const nonce = process.env[RECEIPT_NONCE_ENV];',
    '  if (!path && !nonce) return;',
    "  if (!path || !nonce) throw new Error('ARXIC-TRANSITION-RECEIPT-UNAVAILABLE: receipt configuration is incomplete');",
    '  const state = states.get(context);',
    "  if (!state) throw new Error('ARXIC-TRANSITION-RECEIPT-UNAVAILABLE: listener state was not installed');",
    '  const receipt = {',
    '    schemaVersion: 1,',
    "    kind: 'arxic-transition-receipts',",
    "    correlationSha256: createHash('sha256').update(nonce).digest('hex'),",
    '    testTitle: state.testTitle,',
    '    transitions: state.transitions,',
    '    events: state.events,',
    '  };',
    '  await mkdir(dirname(path), { recursive: true });',
    "  await writeFile(path, `${JSON.stringify(receipt)}\\n`, 'utf8');",
    '}',
    '',
  ].join('\n');
}

export const TRANSITION_RECEIPT_PATH_ENV = 'ARXIC_TRANSITION_RECEIPTS_PATH';
export const TRANSITION_RECEIPT_NONCE_ENV = 'ARXIC_TRANSITION_RECEIPTS_NONCE';
