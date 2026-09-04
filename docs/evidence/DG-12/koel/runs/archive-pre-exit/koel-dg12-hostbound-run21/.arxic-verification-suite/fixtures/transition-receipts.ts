import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const RECEIPT_PATH_ENV = 'ARXIC_TRANSITION_RECEIPTS_PATH';
const RECEIPT_NONCE_ENV = 'ARXIC_TRANSITION_RECEIPTS_NONCE';
const states = new WeakMap();

export function installTransitionReceiptListeners(context, page, testInfo) {
  const state = {
    testTitle: testInfo.title,
    transitions: [],
    events: [],
    armed: false,
    windowsOpened: 0,
    windowKind: undefined,
    attributed: new Set(),
  };
  states.set(context, state);
  context.on('request', (request) => {
    if (!state.armed || state.windowKind === undefined) return;
    if (state.windowKind === 'navigate' && request.resourceType() !== 'document') return;
    state.attributed.add(request);
  });
  context.on('requestfailed', (request) => {
    if (!state.attributed.has(request)) return;
    const error = request.failure()?.errorText ?? 'unknown request failure';
    if (error !== 'net::ERR_ABORTED') state.events.push({ kind: 'requestfailed', url: request.url(), error });
  });
  context.on('response', (response) => {
    if (!state.attributed.has(response.request())) return;
    if (response.status() >= 400) state.events.push({ kind: 'http-response', url: response.url(), status: response.status() });
  });
  page.on('console', (message) => {
    if (!state.armed || state.windowKind !== 'action') return;
    if (message.type() === 'error') state.events.push({ kind: 'console-error', message: message.text() });
  });
  page.on('pageerror', (error) => {
    if (!state.armed || state.windowKind !== 'action') return;
    state.events.push({ kind: 'pageerror', message: error instanceof Error ? error.message : String(error) });
  });
}

export function armReceiptCapture(page) {
  const state = states.get(page.context());
  if (!state) throw new Error('ARXIC-TRANSITION-RECEIPT-UNAVAILABLE: listener state was not installed');
  state.armed = true;
}

export async function withReceiptAttribution(page, kind, operation) {
  const state = states.get(page.context());
  if (!state) throw new Error('ARXIC-TRANSITION-RECEIPT-UNAVAILABLE: listener state was not installed');
  if (!state.armed) return operation();
  if (kind !== 'navigate' && kind !== 'action') {
    throw new Error(`ARXIC-TRANSITION-RECEIPT-UNAVAILABLE: unknown attribution window kind ${kind}`);
  }
  const previous = state.windowKind;
  state.windowsOpened += 1;
  state.windowKind = kind;
  try {
    return await operation();
  } finally {
    state.windowKind = previous;
  }
}

export function recordTransitionReceipt(page, id, stepName) {
  const state = states.get(page.context());
  if (!state) throw new Error('ARXIC-TRANSITION-RECEIPT-UNAVAILABLE: listener state was not installed');
  state.transitions.push({ id, stepName, url: page.url() });
}

export async function writeTransitionReceipts(context) {
  const path = process.env[RECEIPT_PATH_ENV];
  const nonce = process.env[RECEIPT_NONCE_ENV];
  if (!path && !nonce) return;
  if (!path || !nonce) throw new Error('ARXIC-TRANSITION-RECEIPT-UNAVAILABLE: receipt configuration is incomplete');
  const state = states.get(context);
  if (!state) throw new Error('ARXIC-TRANSITION-RECEIPT-UNAVAILABLE: listener state was not installed');
  if (state.armed && state.windowsOpened === 0) {
    throw new Error('ARXIC-TRANSITION-RECEIPT-UNAVAILABLE: capture was armed but no attribution window was ever opened');
  }
  const receipt = {
    schemaVersion: 1,
    kind: 'arxic-transition-receipts',
    correlationSha256: createHash('sha256').update(nonce).digest('hex'),
    testTitle: state.testTitle,
    transitions: state.transitions,
    events: state.events,
  };
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(receipt)}\n`, 'utf8');
}
