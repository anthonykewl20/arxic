import { parseArgs as nodeParseArgs } from 'node:util';
import type { Diagnostic } from '@arxic/contracts';

export type CliCommand =
  | Readonly<{ kind: 'version' }>
  | Readonly<{ kind: 'help'; command?: 'run' | 'intents' }>
  | Readonly<{
      kind: 'run';
      config: string;
      out?: string;
      runId?: string;
      executor?: 'local' | 'worker';
    }>
  | Readonly<{
      kind: 'intents';
      path: string;
      json?: boolean;
    }>;

type ParseResult = { ok: true; command: CliCommand } | { ok: false; diagnostics: Diagnostic[] };

export function parseArgs(argv: readonly string[]): ParseResult {
  try {
    if (argv.length === 0) return { ok: true, command: { kind: 'help' } };
    if (argv[0] === 'run') return parseRunArgs(argv.slice(1));
    if (argv[0] === 'intents') return parseIntentsArgs(argv.slice(1));
    const parsed = nodeParseArgs({
      args: [...argv],
      options: {
        version: { type: 'boolean', short: 'v' },
        help: { type: 'boolean', short: 'h' },
      },
      strict: true,
      allowPositionals: true,
    });
    if (parsed.positionals.length > 0) return usage(`Unknown command: ${parsed.positionals[0]}`);
    if (parsed.values.version) return { ok: true, command: { kind: 'version' } };
    if (parsed.values.help) return { ok: true, command: { kind: 'help' } };
    return usage('Expected --help, --version, or the run command');
  } catch {
    return usage('Invalid command-line option');
  }
}

function parseRunArgs(argv: readonly string[]): ParseResult {
  try {
    const parsed = nodeParseArgs({
      args: [...argv],
      options: {
        config: { type: 'string' },
        out: { type: 'string' },
        'run-id': { type: 'string' },
        executor: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
      strict: true,
      allowPositionals: true,
    });
    if (parsed.positionals.length > 0)
      return usage(`Unexpected argument: ${parsed.positionals[0]}`);
    if (parsed.values.help) return { ok: true, command: { kind: 'help', command: 'run' } };
    if (!parsed.values.config) return usage('run requires --config <path>');
    const runId = parsed.values['run-id'];
    if (runId !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(runId)) {
      return usage('--run-id must be a safe opaque identifier');
    }
    const executor = parsed.values.executor;
    if (executor !== undefined && executor !== 'local' && executor !== 'worker') {
      return usage('--executor must be local or worker');
    }
    return {
      ok: true,
      command: {
        kind: 'run',
        config: parsed.values.config,
        ...(parsed.values.out === undefined ? {} : { out: parsed.values.out }),
        ...(runId === undefined ? {} : { runId }),
        ...(executor === undefined ? {} : { executor }),
      },
    };
  } catch {
    return usage('Invalid run option');
  }
}

function parseIntentsArgs(argv: readonly string[]): ParseResult {
  try {
    const parsed = nodeParseArgs({
      args: [...argv],
      options: {
        json: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
      },
      strict: true,
      allowPositionals: true,
    });
    if (parsed.values.help) return { ok: true, command: { kind: 'help', command: 'intents' } };
    if (parsed.positionals.length !== 1 || parsed.positionals[0] === '') {
      return usage(
        'intents requires exactly one PATH argument (a run directory or bundle directory)',
      );
    }
    return {
      ok: true,
      command: {
        kind: 'intents',
        path: parsed.positionals[0]!,
        ...(parsed.values.json ? { json: true } : {}),
      },
    };
  } catch {
    return usage('Invalid intents option');
  }
}

function usage(message: string): ParseResult {
  return {
    ok: false,
    diagnostics: [
      {
        code: 'ARXIC-CLI-USAGE',
        severity: 'blocked',
        subject: 'cli.arguments',
        message,
      },
    ],
  };
}
