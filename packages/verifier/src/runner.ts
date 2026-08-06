import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const require = createRequire(import.meta.url);

export type RunPass = {
  passed: boolean;
  output: string;
  exitCode: number;
  networkErrors: string[];
  observedTransitions?: string[];
};

export type RunPlaywrightSuiteOptions = {
  testDirectory: string;
  env?: NodeJS.ProcessEnv;
  trace?: 'retain' | 'discard';
};

export async function runPlaywrightSuite(options: RunPlaywrightSuiteOptions): Promise<RunPass> {
  const cliPath = resolvePlaywrightCli();
  const args = [cliPath, 'test'];
  if (options.trace === 'retain') args.push('--trace=on');
  try {
    const result = await execute(process.execPath, args, {
      cwd: options.testDirectory,
      env: { ...process.env, ...options.env },
      timeout: 120_000,
    });
    const output = `${result.stdout}${result.stderr}`;
    return {
      passed: true,
      output,
      exitCode: 0,
      networkErrors: extractNetworkErrors(output),
    };
  } catch (error) {
    if (!isTestFailure(error)) throw error;
    const output = extractOutput(error);
    return {
      passed: false,
      output,
      exitCode: extractExitCode(error),
      networkErrors: extractNetworkErrors(output),
    };
  }
}

export function resolvePlaywrightCli(): string {
  try {
    return require.resolve('@playwright/test/cli.js');
  } catch {
    return require.resolve('@playwright/test/cli');
  }
}

export function extractNetworkErrors(output: string): string[] {
  return (
    output.match(
      /(?:net::ERR_[A-Z_]+|requestfailed|network error|console(?:\.|\s+)error|pageerror)/giu,
    ) ?? []
  );
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
  return typeof value.code === 'number' && value.killed !== true && !value.signal;
}
