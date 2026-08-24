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
    // #307 (F-E6) / F-E8: events are attributed PER REQUEST, not by time
    // window. Round-6 field evidence (directus-dg12-run6) contradicted the
    // first-cut time rule: the SPA's boot probe (/auth/refresh -> 400 +
    // console error) fires AFTER the first goto, inside any armed window,
    // because the app boots as part of the very page the workflow navigates
    // to. The corrected rule (AC-1): a workflow step attributes ONLY
    //   - navigate windows: the DOCUMENT request of the step's goto, and
    //   - action windows: every request SENT while the awaited click/submit
    //     runs (marked at send time, so late responses/failures still gate),
    //     plus console-error/pageerror raised during that window.
    // The app's own boot probes are never marked -> never gate. Fail-closed:
    // an armed suite that opens ZERO attribution windows refuses at receipt
    // write time (it can never silently pass).
    '  const state = {',
    '    testTitle: testInfo.title,',
    '    transitions: [],',
    '    events: [],',
    '    armed: false,',
    '    windowsOpened: 0,',
    '    windowKind: undefined,',
    '    attributed: new Set(),',
    '  };',
    '  states.set(context, state);',
    "  context.on('request', (request) => {",
    '    if (!state.armed || state.windowKind === undefined) return;',
    "    if (state.windowKind === 'navigate' && request.resourceType() !== 'document') return;",
    '    state.attributed.add(request);',
    '  });',
    "  context.on('requestfailed', (request) => {",
    '    if (!state.attributed.has(request)) return;',
    "    const error = request.failure()?.errorText ?? 'unknown request failure';",
    "    if (error !== 'net::ERR_ABORTED') state.events.push({ kind: 'requestfailed', url: request.url(), error });",
    '  });',
    "  context.on('response', (response) => {",
    '    if (!state.attributed.has(response.request())) return;',
    "    if (response.status() >= 400) state.events.push({ kind: 'http-response', url: response.url(), status: response.status() });",
    '  });',
    "  page.on('console', (message) => {",
    "    if (!state.armed || state.windowKind !== 'action') return;",
    "    if (message.type() === 'error') state.events.push({ kind: 'console-error', message: message.text() });",
    '  });',
    "  page.on('pageerror', (error) => {",
    "    if (!state.armed || state.windowKind !== 'action') return;",
    "    state.events.push({ kind: 'pageerror', message: error instanceof Error ? error.message : String(error) });",
    '  });',
    '}',
    '',
    'export function armReceiptCapture(page) {',
    '  const state = states.get(page.context());',
    "  if (!state) throw new Error('ARXIC-TRANSITION-RECEIPT-UNAVAILABLE: listener state was not installed');",
    '  state.armed = true;',
    '}',
    '',
    'export async function withReceiptAttribution(page, kind, operation) {',
    '  const state = states.get(page.context());',
    "  if (!state) throw new Error('ARXIC-TRANSITION-RECEIPT-UNAVAILABLE: listener state was not installed');",
    // Unarmed suites (control-state specs) run transparently — they never
    // arm, so there is nothing to attribute; the fail-closed contract is
    // 'armed but ZERO windows', enforced at write time.
    '  if (!state.armed) return operation();',
    "  if (kind !== 'navigate' && kind !== 'action') {",
    '    throw new Error(`ARXIC-TRANSITION-RECEIPT-UNAVAILABLE: unknown attribution window kind ${kind}`);',
    '  }',
    '  const previous = state.windowKind;',
    '  state.windowsOpened += 1;',
    '  state.windowKind = kind;',
    '  try {',
    '    return await operation();',
    '  } finally {',
    '    state.windowKind = previous;',
    '  }',
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
    '  if (state.armed && state.windowsOpened === 0) {',
    "    throw new Error('ARXIC-TRANSITION-RECEIPT-UNAVAILABLE: capture was armed but no attribution window was ever opened');",
    '  }',
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
