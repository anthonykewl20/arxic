import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ARXIC_VERSION, type GateResult } from '@arxic/contracts';
import type { ArxicConfig } from '@arxic/worker';
import type { RunResult } from './executor';

export type RunDirectoryRecord = Readonly<{
  runId: string;
  config: ArxicConfig;
  result: RunResult;
  startedAt: string;
  finishedAt: string;
  now: () => string;
}>;

export async function writeRunDirectory(
  runDirectory: string,
  record: RunDirectoryRecord,
): Promise<void> {
  assertRunId(record.runId);
  const directory = join(runDirectory, record.runId);
  await mkdir(directory, { recursive: true });

  const checkpoints = record.result.state.checkpoints;
  const artifactHashes = Object.values(record.result.state.artifacts).filter(
    (artifact): artifact is { id: string; sha256: string } => artifact !== undefined,
  );
  const toolVersions: Record<string, string> = {};
  const decisions: string[] = [];
  const gateResults: GateResult[] = [];
  const redactedFields = new Set<string>();
  let redactionPassed = true;
  for (const checkpoint of checkpoints) {
    Object.assign(toolVersions, checkpoint.toolVersions);
    decisions.push(...checkpoint.decisions, ...checkpoint.approvals);
    gateResults.push(...checkpoint.gateResults);
    redactionPassed &&= checkpoint.redaction.passed;
    checkpoint.redaction.redactedFields.forEach((field) => redactedFields.add(field));
  }

  const runRecord = {
    schemaVersion: 1,
    runId: record.runId,
    generator: { id: '@arxic/cli', version: ARXIC_VERSION },
    config: redactConfig(record.config),
    target: {
      origin: record.config.target.origin,
      environmentClass: record.config.target.environmentClass,
    },
    status: record.result.status,
    outcome: record.result.outcome,
    startedAt: record.startedAt || record.now(),
    finishedAt: record.finishedAt || record.now(),
    stages: checkpoints,
    artifactHashes,
    toolVersions,
    decisions,
    gateResults,
    redaction: { passed: redactionPassed, redactedFields: [...redactedFields].sort() },
    ...(record.result.receipt === undefined ? {} : { receipt: record.result.receipt }),
    diagnostics: record.result.diagnostics,
  };

  const diagnosticsBytes = record.result.diagnostics
    .map((diagnostic) => canonicalJson(diagnostic))
    .join('\n');
  await Promise.all([
    writeFile(join(directory, 'run.json'), `${canonicalJson(runRecord)}\n`, { mode: 0o600 }),
    writeFile(
      join(directory, 'diagnostics.jsonl'),
      diagnosticsBytes.length === 0 ? '' : `${diagnosticsBytes}\n`,
      { mode: 0o600 },
    ),
    writeFile(join(directory, 'config.json'), `${canonicalJson(redactConfig(record.config))}\n`, {
      mode: 0o600,
    }),
  ]);
}

function redactConfig(config: ArxicConfig): ArxicConfig {
  return redactValue(config) as ArxicConfig;
}

const SECRET_KEYS = new Set(['credentialbytes', 'prompt', 'modelprompt']);

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => redactValue(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !SECRET_KEYS.has(key.toLowerCase()))
        .map(([key, item]) => [key, redactValue(item)]),
    );
  }
  return value;
}

function assertRunId(runId: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(runId)) {
    throw new Error('Run id must be a safe opaque identifier');
  }
}

export function canonicalJson(value: unknown): string {
  const serialized = JSON.stringify(sortValue(value));
  if (serialized === undefined) throw new Error('Run record is not JSON serializable');
  return serialized;
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, item]) => [key, sortValue(item)]),
    );
  }
  return value;
}
