import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import {
  TRANSITION_RECEIPT_NONCE_ENV,
  TRANSITION_RECEIPT_PATH_ENV,
} from '@arxic/playwright-compiler';

const execute = promisify(execFile);
const require = createRequire(import.meta.url);

export type RunPass = {
  passed: boolean;
  output: string;
  exitCode: number;
  networkErrors: string[];
  observedTransitions?: string[];
  receiptError?: string;
};

export type TransitionReceiptExpectation = Readonly<{
  path: string;
  nonce: string;
  testTitle: string;
  transitions: readonly Readonly<{ id: string; stepName: string }>[];
}>;

export type RunPlaywrightSuiteOptions = {
  testDirectory: string;
  env?: NodeJS.ProcessEnv;
  trace?: 'retain' | 'discard';
  transitionReceipts?: TransitionReceiptExpectation;
};

export async function runPlaywrightSuite(options: RunPlaywrightSuiteOptions): Promise<RunPass> {
  const cliPath = resolvePlaywrightCli();
  const args = [cliPath, 'test'];
  if (options.trace === 'retain') args.push('--trace=on');
  try {
    const result = await execute(process.execPath, args, {
      cwd: options.testDirectory,
      env: {
        ...process.env,
        ...options.env,
        ...(options.transitionReceipts
          ? {
              [TRANSITION_RECEIPT_PATH_ENV]: options.transitionReceipts.path,
              [TRANSITION_RECEIPT_NONCE_ENV]: options.transitionReceipts.nonce,
            }
          : {}),
      },
      timeout: 120_000,
    });
    const output = `${result.stdout}${result.stderr}`;
    return withReceipts(
      {
        passed: true,
        output,
        exitCode: 0,
        networkErrors: [],
      },
      options.transitionReceipts,
    );
  } catch (error) {
    if (!isTestFailure(error)) throw error;
    const output = extractOutput(error);
    return withReceipts(
      {
        passed: false,
        output,
        exitCode: extractExitCode(error),
        networkErrors: [],
      },
      options.transitionReceipts,
    );
  }
}

export function resolvePlaywrightCli(): string {
  try {
    return require.resolve('@playwright/test/cli.js');
  } catch {
    return require.resolve('@playwright/test/cli');
  }
}

async function withReceipts(
  result: Omit<RunPass, 'observedTransitions' | 'receiptError'>,
  expected: TransitionReceiptExpectation | undefined,
): Promise<RunPass> {
  if (!expected) return result;
  const parsed = await readTransitionReceipts(expected);
  if (!parsed.ok) return { ...result, receiptError: parsed.error };
  return {
    ...result,
    observedTransitions: parsed.transitions,
    networkErrors: parsed.networkErrors,
  };
}

export async function readTransitionReceipts(
  expected: TransitionReceiptExpectation,
): Promise<
  { ok: true; transitions: string[]; networkErrors: string[] } | { ok: false; error: string }
> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(expected.path, 'utf8'));
  } catch (error) {
    return {
      ok: false,
      error: `Transition receipt is unavailable or malformed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (!isRecord(value)) return { ok: false, error: 'Transition receipt must be a JSON object' };
  if (value.schemaVersion !== 1 || value.kind !== 'arxic-transition-receipts') {
    return { ok: false, error: 'Transition receipt has an unsupported schema or kind' };
  }
  if (value.correlationSha256 !== sha256(expected.nonce)) {
    return { ok: false, error: 'Transition receipt correlation does not match this verifier run' };
  }
  if (value.testTitle !== expected.testTitle) {
    return {
      ok: false,
      error: 'Transition receipt test title does not match the trusted generated spec',
    };
  }
  if (!Array.isArray(value.transitions) || !Array.isArray(value.events)) {
    return { ok: false, error: 'Transition receipt has invalid transition or event collections' };
  }
  const expectedById = new Map(
    expected.transitions.map((transition) => [transition.id, transition]),
  );
  const observed = new Set<string>();
  for (const transition of value.transitions) {
    if (
      !isRecord(transition) ||
      typeof transition.id !== 'string' ||
      typeof transition.stepName !== 'string'
    ) {
      return { ok: false, error: 'Transition receipt contains a malformed transition witness' };
    }
    if (typeof transition.url !== 'string' || !isHttpUrl(transition.url)) {
      return {
        ok: false,
        error: 'Transition receipt contains a transition without an HTTP(S) URL witness',
      };
    }
    const trusted = expectedById.get(transition.id);
    if (!trusted || trusted.stepName !== transition.stepName || observed.has(transition.id)) {
      return {
        ok: false,
        error: 'Transition receipt contains an untrusted, duplicate, or forged step witness',
      };
    }
    observed.add(transition.id);
  }
  const networkErrors: string[] = [];
  for (const event of value.events) {
    const rendered = renderStructuredEvent(event);
    if (!rendered)
      return { ok: false, error: 'Transition receipt contains a malformed page or context event' };
    networkErrors.push(rendered);
  }
  return { ok: true, transitions: [...observed], networkErrors };
}

function renderStructuredEvent(value: unknown): string | undefined {
  if (!isRecord(value) || typeof value.kind !== 'string') return undefined;
  if (value.kind === 'http-response') {
    return typeof value.url === 'string' && typeof value.status === 'number' && value.status >= 400
      ? `http-response ${value.status} ${safeUrlWitness(value.url)}`
      : undefined;
  }
  if (value.kind === 'requestfailed') {
    return typeof value.url === 'string' && typeof value.error === 'string'
      ? `requestfailed ${value.error} ${safeUrlWitness(value.url)}`
      : undefined;
  }
  if (value.kind === 'console-error' || value.kind === 'pageerror') {
    return typeof value.message === 'string' ? value.kind : undefined;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function safeUrlWitness(value: string): string {
  const url = new URL(value);
  return `${url.origin}${url.pathname}`;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function extractOutput(error: unknown): string {
  if (!error || typeof error !== 'object') return String(error);
  const value = error as { stdout?: string; stderr?: string; message?: string };
  return `${value.stdout ?? ''}${value.stderr ?? ''}${value.message ?? ''}`;
}

function extractExitCode(error: unknown): number {
  if (!error || typeof error !== 'object' || !('code' in error)) return 1;
  return typeof error.code === 'number' ? error.code : 1;
}

function isTestFailure(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error)) return false;
  const value = error as {
    code?: string | number | null;
    killed?: boolean;
    signal?: string | null;
  };
  return value.code === 1 && value.killed !== true && !value.signal;
}
