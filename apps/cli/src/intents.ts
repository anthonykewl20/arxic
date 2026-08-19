import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Diagnostic } from '@arxic/contracts';
import type { OutputSink } from './cli';
import { ARXIC_CLI_USAGE, cliDiagnostic } from './diagnostics';
import {
  ARXIC_INTENT_LEDGER_INVENTORY_MISSING,
  ARXIC_INTENT_LEDGER_INPUT_INVALID,
  ARXIC_INTENT_LEDGER_MISSING,
  ARXIC_INTENT_LEDGER_SCHEMA_INVALID,
  INTENT_LEDGER_FILENAME,
  ledgerDiagnostic,
  resolveLedgerInputs,
  serializeIntentLedger,
  validateIntentLedger,
  type IntentLedger,
} from '../../../packages/intent/src/ledger';

/**
 * DG-07 (#251): the read-only `arxic intents PATH [--json]` action (C-3).
 * PATH may be a run directory (either lane layout) or an assembled bundle
 * directory. Rendering performs ZERO file writes; every refusal exits
 * non-zero with a stable `ARXIC-INTENT-LEDGER-*` diagnostic and never a
 * partial table (SP-2/SP-3/SP-5).
 */

export type IntentsCommand = Readonly<{ kind: 'intents'; path: string; json?: boolean }>;

export type IntentsActionOptions = Readonly<{
  stdout?: OutputSink;
  stderr?: OutputSink;
}>;

export async function intentsAction(
  command: IntentsCommand,
  options: IntentsActionOptions = {},
): Promise<{ exitCode: number }> {
  const stdout = options.stdout ?? console;
  const stderr = options.stderr ?? console;
  const target = resolve(command.path);

  let targetIsDirectory: boolean;
  try {
    targetIsDirectory = (await stat(target)).isDirectory();
  } catch {
    targetIsDirectory = false;
  }
  if (!targetIsDirectory) {
    return refuse(
      stderr,
      2,
      cliDiagnostic(
        ARXIC_CLI_USAGE,
        'blocked',
        'cli.arguments',
        `intents PATH must be an existing run directory or bundle directory (got ${JSON.stringify(command.path)})`,
      ),
    );
  }

  const ledgerPath = join(target, INTENT_LEDGER_FILENAME);
  let ledgerBytes: string | undefined;
  try {
    if ((await stat(ledgerPath)).isFile()) ledgerBytes = await readFile(ledgerPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      return refuse(
        stderr,
        1,
        ledgerDiagnostic(
          ARXIC_INTENT_LEDGER_INPUT_INVALID,
          'intent-ledger',
          `intents.json under ${target} exists but could not be read (${(error as NodeJS.ErrnoException).code ?? 'unknown error'})`,
        ),
      );
    }
  }

  if (ledgerBytes === undefined) {
    // No ledger file: the run dir must still be recognizable so the refusal
    // is honest about WHAT is missing (SP-2 vs a plain missing ledger).
    const runMarkers = await Promise.all([
      isFile(join(target, 'run.json')),
      isDirectory(join(target, 'artifacts')),
    ]);
    const bundleMarker = await isFile(join(target, 'manifest.json'));
    if (runMarkers.some(Boolean)) {
      const resolved = await resolveLedgerInputs(target);
      if (!resolved.ok) return refuse(stderr, 1, ...resolved.diagnostics);
      return refuse(stderr, 1, missingLedger(target));
    }
    if (bundleMarker) return refuse(stderr, 1, missingLedger(target));
    return refuse(
      stderr,
      1,
      ledgerDiagnostic(
        ARXIC_INTENT_LEDGER_INVENTORY_MISSING,
        'intent-ledger.inventory',
        `${target} is not a run directory (either lane layout) or an assembled bundle directory`,
      ),
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(ledgerBytes);
  } catch {
    return refuse(
      stderr,
      1,
      ledgerDiagnostic(
        ARXIC_INTENT_LEDGER_SCHEMA_INVALID,
        'intent-ledger',
        `intents.json at ${target} is not valid JSON`,
      ),
    );
  }
  const validated = validateIntentLedger(parsed);
  if (!validated.ok) return refuse(stderr, 1, ...validated.diagnostics);

  print(
    stdout,
    command.json ? serializeIntentLedger(validated.value) : renderTable(validated.value),
  );
  return { exitCode: 0 };
}

function missingLedger(target: string): Diagnostic {
  return ledgerDiagnostic(
    ARXIC_INTENT_LEDGER_MISSING,
    'intent-ledger',
    `No ${INTENT_LEDGER_FILENAME} under ${target}; the ledger is built when the run stages its promotion candidate`,
  );
}

/** Deterministic human table; repeated renders are identical (C-3). */
function renderTable(ledger: IntentLedger): string {
  const lines: string[] = [
    `Intent ledger ${ledger.schemaVersion} generated ${ledger.generatedAt}`,
    `Source: ${ledger.source.repository} @ ${ledger.source.commit}`,
    `Inventory: ${ledger.inventory.totalRows} rows (${Object.entries(ledger.inventory.byDisposition)
      .filter(([, count]) => count > 0)
      .map(([disposition, count]) => `${count} ${disposition}`)
      .join(', ')})`,
  ];
  if (ledger.candidate) {
    const verification = ledger.verification
      ? `, ${ledger.verification.outcome} (${ledger.verification.passedRuns}/${ledger.verification.runs} runs passed)`
      : '';
    lines.push(`Candidate: ${ledger.candidate.workflowId}${verification}`);
  }
  lines.push('');
  lines.push(
    `${pad('SURFACE', 26)}${pad('DOMAIN', 18)}${pad('TRUTH', 14)}${pad('REPLAY', 18)}INTENT`,
  );
  for (const row of ledger.rows) {
    const surface = sanitizeCell(`${row.surface.method} ${row.surface.path}`);
    const linkage = row.inventoryRowId === undefined ? '' : ` @${row.inventoryRowId}`;
    if (row.intents.length === 0) {
      const prefix = `${pad(truncate(surface, 25), 26)}${pad(truncate(sanitizeCell(row.domain), 17), 18)}${pad(row.truthState, 14)}${pad(row.replayStatus, 18)}`;
      lines.push(`${prefix}${truncate(`(no proposal; ${row.disposition})${linkage}`, 96)}`);
      continue;
    }
    for (const intent of row.intents) {
      const prefix = `${pad(truncate(surface, 25), 26)}${pad(truncate(sanitizeCell(intent.domain), 17), 18)}${pad(intent.truthState, 14)}${pad(intent.replayStatus, 18)}`;
      const candidate = intent.isCandidate ? ' *' : '';
      lines.push(
        `${prefix}${truncate(`${sanitizeCell(intent.intent)} [${intent.proposalId}${candidate}]${linkage}`, 96)}`,
      );
    }
  }
  return lines.join('\n');
}

/**
 * C0/C1 control characters (newlines, tabs, ESC/ANSI, NUL, DEL — Unicode
 * category Cc) in model-derived fields are replaced with a space BEFORE
 * padding/truncation, so a field can never break the one-line-per-row table
 * layout or emit raw escape bytes (#251 review P3). `proposalId` needs no
 * sanitization: the ledger schema pins it to `^prop:[0-9a-f]{16}$`.
 */
function sanitizeCell(value: string): string {
  return value.replace(/[\p{Cc}]/gu, ' ');
}

function truncate(value: string, width: number): string {
  return value.length > width ? `${value.slice(0, Math.max(0, width - 1))}…` : value;
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value.padEnd(width, ' ');
}

function refuse(
  sink: OutputSink,
  exitCode: number,
  ...diagnostics: readonly Diagnostic[]
): { exitCode: number } {
  for (const diagnostic of diagnostics) {
    print(sink, `${diagnostic.code} [${diagnostic.subject}] ${diagnostic.message}`);
  }
  return { exitCode };
}

function print(sink: OutputSink, message: string): void {
  if ('write' in sink) sink.write(`${message}\n`);
  else sink.log(message);
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}
