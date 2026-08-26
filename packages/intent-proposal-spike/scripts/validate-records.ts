/**
 * DG-11 record validator (#255, gate G-1): validates every validation-run /
 * refusal record under an evidence directory against the CLOSED record
 * schema, re-checks spend-ledger arithmetic coherence, and scans every file
 * for secret patterns through the production `scanTextForSecrets` gate
 * (packages/bundle-promoter/src/redaction-gate.ts). Exit 0 only when every
 * record is schema-valid, every ledger is coherent, and zero secret
 * findings exist. An empty directory is an honest vacuous pass — the tool
 * reports `0 records validated`.
 *
 * Usage (from the repository root):
 *   pnpm exec tsx packages/intent-proposal-spike/scripts/validate-records.ts \
 *     docs/evidence/DG-11 [--live-key-env ARXIC_MODEL_API_KEY] \
 *     [--allow-missing-live-key]
 *
 * Optional flags:
 *   --live-key-env VAR         additionally assert that the CURRENT value of
 *                              env variable VAR appears in NO file under the
 *                              directory. The value is never printed; only
 *                              file paths are. A missing/empty/unnamed
 *                              variable FAILS the run (exit 1) — a silent
 *                              skip must never read as a clean scan.
 *   --allow-missing-live-key   explicitly permit the skip when the named
 *                              variable is unset (exit 0, skip logged).
 */
import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { scanTextForSecrets } from '../../bundle-promoter/src/redaction-gate';

export const DG11_RECORD_KIND_RUN = 'dg11-validation-run-v1' as const;
export const DG11_RECORD_KIND_REFUSAL = 'dg11-validation-refusal-v1' as const;
export const DG11_SPEND_LEDGER_SCHEMA = 'dg11-spend-ledger-v1' as const;

/** Numeric comparison tolerance for USD/token arithmetic (float coherence). */
const TOLERANCE = 1e-9;

export type DirectoryValidationResult = Readonly<{
  ok: boolean;
  records: number;
  complete: number;
  incomplete: number;
  refusals: number;
  ledgers: number;
  problems: readonly string[];
  findings: ReadonlyArray<{ file: string; pattern: string }>;
}>;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function near(left: number, right: number): boolean {
  return Math.abs(left - right) <= TOLERANCE;
}

function closedKeys(value: Record<string, unknown>, allowed: readonly string[]): string[] {
  const allowedSet = new Set(allowed);
  return Object.keys(value).filter((key) => !allowedSet.has(key));
}

function missingKeys(value: Record<string, unknown>, required: readonly string[]): string[] {
  return required.filter((key) => value[key] === undefined);
}

/**
 * Closed-schema shape validation for both record kinds. Returns the kind on
 * success; an explicit problem list on failure (never throws).
 */
export function validateRecordShape(
  value: unknown,
): { ok: true; kind: string } | { ok: false; problems: string[] } {
  if (!isPlainRecord(value)) return { ok: false, problems: ['record must be a JSON object'] };
  if (value.kind === DG11_RECORD_KIND_RUN) return validateRunRecordShape(value);
  if (value.kind === DG11_RECORD_KIND_REFUSAL) return validateRefusalRecordShape(value);
  return {
    ok: false,
    problems: [`kind must be ${DG11_RECORD_KIND_RUN} or ${DG11_RECORD_KIND_REFUSAL}`],
  };
}

const RUN_REQUIRED = [
  'kind',
  'schemaVersion',
  'target',
  'run',
  'model',
  'pricing',
  'telemetry',
  'measured',
  'ledger',
  'coverage',
  'outcome',
  'events',
  'groundednessSpotCheck',
] as const;

const REFUSAL_REQUIRED = [
  'kind',
  'schemaVersion',
  'target',
  'runId',
  'at',
  'reason',
  'detail',
  'upstreamCallsPlaced',
] as const;

const REFUSAL_REASONS = [
  'budget-ceiling',
  'credentials-missing',
  'proxy-ceiling',
  'redaction-finding',
  'zero-price',
  'ledger-unreadable',
  'ceiling-mismatch',
  'commit-mismatch',
] as const;

/** Strict ISO-8601 UTC timestamps (finding 13): YYYY-MM-DDTHH:mm:ss[.fff]Z. */
const ISO_8601_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u;

function isIso8601Utc(value: unknown): value is string {
  return typeof value === 'string' && ISO_8601_UTC.test(value) && !Number.isNaN(Date.parse(value));
}

function validateRunRecordShape(
  value: Record<string, unknown>,
): { ok: true; kind: string } | { ok: false; problems: string[] } {
  const problems: string[] = [];
  const unexpected = closedKeys(value, RUN_REQUIRED);
  if (unexpected.length > 0) problems.push(`unexpected top-level keys: ${unexpected.join(', ')}`);
  const missing = missingKeys(value, RUN_REQUIRED);
  if (missing.length > 0) problems.push(`missing top-level keys: ${missing.join(', ')}`);
  if (problems.length > 0) return { ok: false, problems };

  if (value.schemaVersion !== 1) problems.push('schemaVersion must be 1');
  const target = value.target;
  if (
    !isPlainRecord(target) ||
    typeof target.name !== 'string' ||
    target.name.length === 0 ||
    typeof target.repository !== 'string' ||
    !/^[0-9a-f]{40}$/iu.test(String(target.commit))
  ) {
    problems.push('target must carry name, repository, and a 40-hex commit');
  }
  const run = value.run;
  if (
    !isPlainRecord(run) ||
    typeof run.runId !== 'string' ||
    run.runId.length === 0 ||
    typeof run.startedAt !== 'string' ||
    typeof run.completedAt !== 'string' ||
    run.executor !== 'local'
  ) {
    problems.push('run must carry runId, startedAt, completedAt, executor "local"');
  }
  if (isPlainRecord(run) && !isIso8601Utc(run.startedAt)) {
    problems.push('run.startedAt must be an ISO-8601 UTC timestamp');
  }
  if (isPlainRecord(run) && !isIso8601Utc(run.completedAt)) {
    problems.push('run.completedAt must be an ISO-8601 UTC timestamp');
  }
  if (typeof value.model !== 'string' || value.model.length === 0) {
    problems.push('model must be a non-empty string');
  } else if (
    // Finding 12: the "unobserved" sentinel is valid ONLY with zero calls.
    value.model === 'unobserved' &&
    Array.isArray(value.telemetry) &&
    value.telemetry.length > 0
  ) {
    problems.push('model "unobserved" is only valid with zero telemetry calls');
  }
  const pricing = value.pricing;
  if (
    !isPlainRecord(pricing) ||
    !isFiniteNonNegativeNumber(pricing.pricePerMillionPrompt) ||
    !isFiniteNonNegativeNumber(pricing.pricePerMillionCompletion) ||
    typeof pricing.reverifyNote !== 'string' ||
    pricing.reverifyNote.length === 0
  ) {
    problems.push(
      'pricing must carry pricePerMillionPrompt, pricePerMillionCompletion, reverifyNote',
    );
  }
  if (!Array.isArray(value.telemetry)) {
    problems.push('telemetry must be an array');
  } else {
    value.telemetry.forEach((call, index) => {
      if (
        !isPlainRecord(call) ||
        closedKeys(call, [
          'requestId',
          'model',
          'promptTokens',
          'completionTokens',
          'latencyMs',
          'costUsd',
        ]).length > 0 ||
        typeof call.requestId !== 'string' ||
        typeof call.model !== 'string' ||
        !Number.isInteger(call.promptTokens) ||
        !Number.isInteger(call.completionTokens) ||
        !Number.isInteger(call.latencyMs) ||
        !isFiniteNonNegativeNumber(call.costUsd)
      ) {
        problems.push(
          `telemetry[${index}] must carry requestId, model, token counts, latencyMs, costUsd`,
        );
      }
    });
  }
  const measured = value.measured;
  if (
    !isPlainRecord(measured) ||
    !Number.isInteger(measured.calls) ||
    !Number.isInteger(measured.promptTokens) ||
    !Number.isInteger(measured.completionTokens) ||
    !Number.isInteger(measured.latencyMsTotal) ||
    !isFiniteNonNegativeNumber(measured.estimatedCostUsd) ||
    !isFiniteNonNegativeNumber(measured.measuredCostUsd)
  ) {
    problems.push(
      'measured must carry integer calls/promptTokens/completionTokens/latencyMsTotal and USD costs',
    );
  }
  const ledger = value.ledger;
  for (const state of ['before', 'after']) {
    const block = isPlainRecord(ledger) ? ledger[state] : undefined;
    if (
      !isPlainRecord(block) ||
      !isFiniteNonNegativeNumber(block.cumulativeUsd) ||
      !isFiniteNonNegativeNumber(block.ceilingUsd) ||
      !isFiniteNonNegativeNumber(block.remainingUsd)
    ) {
      problems.push(`ledger.${state} must carry cumulativeUsd, ceilingUsd, remainingUsd`);
    }
  }
  const coverage = value.coverage;
  if (
    !isPlainRecord(coverage) ||
    !Number.isInteger(coverage.rows) ||
    !Number.isInteger(coverage.coveredRows) ||
    !Number.isInteger(coverage.proposals)
  ) {
    problems.push('coverage must carry integer rows, coveredRows, proposals');
  }
  const outcome = value.outcome;
  if (
    !isPlainRecord(outcome) ||
    !Number.isInteger(outcome.exitCode) ||
    typeof outcome.status !== 'string' ||
    typeof outcome.outcome !== 'string' ||
    typeof outcome.finalStage !== 'string'
  ) {
    problems.push('outcome must carry exitCode, status, outcome, finalStage');
  }
  if (!Array.isArray(value.events)) {
    problems.push('events must be an array');
  } else {
    value.events.forEach((event, index) => {
      if (
        !isPlainRecord(event) ||
        typeof event.type !== 'string' ||
        typeof event.at !== 'string' ||
        typeof event.detail !== 'string'
      ) {
        problems.push(`events[${index}] must carry type, at, detail`);
      } else if (!isIso8601Utc(event.at)) {
        problems.push(`events[${index}].at must be an ISO-8601 UTC timestamp`);
      }
    });
  }
  const spotCheck = value.groundednessSpotCheck;
  if (!isPlainRecord(spotCheck) || spotCheck.status === undefined) {
    problems.push('groundednessSpotCheck is required (pending until the owner completes it)');
  } else if (spotCheck.status === 'pending') {
    if (
      closedKeys(spotCheck, ['status', 'note']).length > 0 ||
      typeof spotCheck.note !== 'string'
    ) {
      problems.push('groundednessSpotCheck(pending) must carry only status and note');
    }
  } else if (spotCheck.status === 'completed') {
    const numerator = spotCheck.numerator;
    const denominator = spotCheck.denominator;
    const verdicts = spotCheck.verdicts;
    if (
      closedKeys(spotCheck, ['status', 'sampledAt', 'numerator', 'denominator', 'verdicts'])
        .length > 0 ||
      !isIso8601Utc(spotCheck.sampledAt) ||
      !isFiniteNumber(numerator) ||
      !isFiniteNumber(denominator) ||
      !Number.isInteger(numerator) ||
      !Number.isInteger(denominator) ||
      !Array.isArray(verdicts) ||
      verdicts.length !== denominator ||
      numerator > denominator ||
      !verdicts.every(
        (verdict) =>
          isPlainRecord(verdict) &&
          closedKeys(verdict, ['proposalId', 'verdict', 'note']).length === 0 &&
          typeof verdict.proposalId === 'string' &&
          (verdict.verdict === 'grounded' || verdict.verdict === 'ungrounded') &&
          typeof verdict.note === 'string',
      )
    ) {
      problems.push('groundednessSpotCheck(completed) shape is invalid');
    }
  } else {
    problems.push('groundednessSpotCheck.status must be pending or completed');
  }
  return problems.length > 0 ? { ok: false, problems } : { ok: true, kind: DG11_RECORD_KIND_RUN };
}

function validateRefusalRecordShape(
  value: Record<string, unknown>,
): { ok: true; kind: string } | { ok: false; problems: string[] } {
  const problems: string[] = [];
  const allowed = [
    ...REFUSAL_REQUIRED,
    'estimateUsd',
    'cumulativeUsd',
    'ceilingUsd',
    'remainingUsd',
  ];
  const unexpected = closedKeys(value, allowed);
  if (unexpected.length > 0) problems.push(`unexpected keys: ${unexpected.join(', ')}`);
  const missing = missingKeys(value, REFUSAL_REQUIRED);
  if (missing.length > 0) problems.push(`missing keys: ${missing.join(', ')}`);
  if (problems.length > 0) return { ok: false, problems };

  if (value.schemaVersion !== 1) problems.push('schemaVersion must be 1');
  const target = value.target;
  if (!isPlainRecord(target) || typeof target.name !== 'string' || target.name.length === 0) {
    problems.push('target.name must be a non-empty string');
  }
  if (typeof value.runId !== 'string' || value.runId.length === 0) {
    problems.push('runId must be a non-empty string');
  }
  if (!isIso8601Utc(value.at)) problems.push('at must be an ISO-8601 UTC timestamp string');
  if (!REFUSAL_REASONS.includes(value.reason as (typeof REFUSAL_REASONS)[number])) {
    problems.push(`reason must be one of ${REFUSAL_REASONS.join(', ')}`);
  }
  if (typeof value.detail !== 'string' || value.detail.length === 0) {
    problems.push('detail must be a non-empty string');
  }
  const upstreamCallsPlaced = value.upstreamCallsPlaced;
  if (!Number.isInteger(upstreamCallsPlaced) || (upstreamCallsPlaced as number) < 0) {
    problems.push('upstreamCallsPlaced must be a non-negative integer');
  }
  for (const key of ['estimateUsd', 'cumulativeUsd', 'ceilingUsd', 'remainingUsd']) {
    if (value[key] !== undefined && !isFiniteNonNegativeNumber(value[key])) {
      problems.push(`${key} must be a finite non-negative number when present`);
    }
  }
  return problems.length > 0
    ? { ok: false, problems }
    : { ok: true, kind: DG11_RECORD_KIND_REFUSAL };
}

/** Machine-derived-number coherence: telemetry sums, per-call cost, ledger math. */
export function validateRecordArithmetic(
  value: unknown,
): { ok: true } | { ok: false; problems: string[] } {
  if (!isPlainRecord(value) || value.kind !== DG11_RECORD_KIND_RUN) {
    return { ok: false, problems: ['arithmetic validation applies to run records only'] };
  }
  const problems: string[] = [];
  const telemetry = Array.isArray(value.telemetry) ? value.telemetry : [];
  const measured = isPlainRecord(value.measured) ? value.measured : {};
  const promptTokens = telemetry.reduce(
    (sum, call) =>
      sum + (isPlainRecord(call) && isFiniteNumber(call.promptTokens) ? call.promptTokens : 0),
    0,
  );
  const completionTokens = telemetry.reduce(
    (sum, call) =>
      sum +
      (isPlainRecord(call) && isFiniteNumber(call.completionTokens) ? call.completionTokens : 0),
    0,
  );
  const latencyTotal = telemetry.reduce(
    (sum, call) =>
      sum + (isPlainRecord(call) && isFiniteNumber(call.latencyMs) ? call.latencyMs : 0),
    0,
  );
  const measuredCost = telemetry.reduce(
    (sum, call) => sum + (isPlainRecord(call) && isFiniteNumber(call.costUsd) ? call.costUsd : 0),
    0,
  );
  if (telemetry.length !== measured.calls) {
    problems.push(`measured.calls (${measured.calls}) != telemetry length (${telemetry.length})`);
  }
  if (promptTokens !== measured.promptTokens) {
    problems.push(
      `measured.promptTokens (${measured.promptTokens}) != telemetry sum (${promptTokens})`,
    );
  }
  if (completionTokens !== measured.completionTokens) {
    problems.push(
      `measured.completionTokens (${measured.completionTokens}) != telemetry sum (${completionTokens})`,
    );
  }
  if (latencyTotal !== measured.latencyMsTotal) {
    problems.push(
      `measured.latencyMsTotal (${measured.latencyMsTotal}) != telemetry sum (${latencyTotal})`,
    );
  }
  if (
    !near(measuredCost, isFiniteNumber(measured.measuredCostUsd) ? measured.measuredCostUsd : -1)
  ) {
    problems.push(
      `measured.measuredCostUsd (${measured.measuredCostUsd}) != telemetry cost sum (${measuredCost})`,
    );
  }
  const pricing = isPlainRecord(value.pricing) ? value.pricing : {};
  const promptPrice = isFiniteNumber(pricing.pricePerMillionPrompt)
    ? pricing.pricePerMillionPrompt
    : 0;
  const completionPrice = isFiniteNumber(pricing.pricePerMillionCompletion)
    ? pricing.pricePerMillionCompletion
    : 0;
  // Finding 1: zero prices with recorded calls are the ceiling bypass — the
  // arithmetic is perfectly coherent at $0, so only this rule catches it.
  if (telemetry.length > 0 && promptPrice <= 0 && completionPrice <= 0) {
    problems.push(
      'pricing must carry at least one strictly-positive price when calls were recorded — zero prices with calls bypass the ceiling',
    );
  }
  telemetry.forEach((call, index) => {
    if (!isPlainRecord(call)) return;
    const promptTokens = call.promptTokens;
    const completionTokens = call.completionTokens;
    if (!isFiniteNumber(promptTokens) || !isFiniteNumber(completionTokens)) return;
    const expected =
      (promptTokens / 1_000_000) * promptPrice + (completionTokens / 1_000_000) * completionPrice;
    if (!near(expected, isFiniteNumber(call.costUsd) ? call.costUsd : -1)) {
      problems.push(`telemetry[${index}].costUsd does not match tokens x declared prices`);
    }
  });
  const ledger = isPlainRecord(value.ledger) ? value.ledger : {};
  const before = isPlainRecord(ledger.before) ? ledger.before : {};
  const after = isPlainRecord(ledger.after) ? ledger.after : {};
  if (
    isFiniteNumber(before.cumulativeUsd) &&
    isFiniteNumber(measured.measuredCostUsd) &&
    isFiniteNumber(after.cumulativeUsd) &&
    !near(before.cumulativeUsd + measured.measuredCostUsd, after.cumulativeUsd)
  ) {
    problems.push('ledger arithmetic incoherent: after.cumulativeUsd != before + measuredCostUsd');
  }
  // Findings 3 + 4: the ledger blocks are validated against the events the
  // record declares. Cumulative above the ceiling REQUIRES a ceiling-overshoot
  // event and remaining 0 (clamped, never negative); an accounting-gap event
  // freezes after.remainingUsd to 0 (recorded cumulative understates spend).
  const events = Array.isArray(value.events) ? value.events : [];
  const hasOvershootEvent = events.some(
    (event) => isPlainRecord(event) && event.type === 'ceiling-overshoot',
  );
  const hasAccountingGap = events.some(
    (event) => isPlainRecord(event) && event.type === 'accounting-gap',
  );
  for (const [state, block] of [
    ['before', before],
    ['after', after],
  ] as const) {
    if (
      !isFiniteNumber(block.ceilingUsd) ||
      !isFiniteNumber(block.cumulativeUsd) ||
      !isFiniteNumber(block.remainingUsd)
    ) {
      continue;
    }
    if (block.remainingUsd < -TOLERANCE) {
      problems.push(`ledger.${state}.remainingUsd is negative — spend passed the ceiling`);
      continue;
    }
    if (block.cumulativeUsd > block.ceilingUsd + TOLERANCE) {
      if (!hasOvershootEvent) {
        problems.push(
          `ledger.${state}.cumulativeUsd exceeds ceilingUsd without a ceiling-overshoot event`,
        );
      }
      if (!near(block.remainingUsd, 0)) {
        problems.push(
          `ledger.${state}.remainingUsd must be 0 when cumulativeUsd exceeds the ceiling`,
        );
      }
    } else if (state === 'after' && hasAccountingGap) {
      if (!near(block.remainingUsd, 0)) {
        problems.push(
          'ledger.after.remainingUsd must be frozen to 0 while an accounting-gap event is present',
        );
      }
    } else if (!near(block.ceilingUsd - block.cumulativeUsd, block.remainingUsd)) {
      problems.push(`ledger.${state}.remainingUsd != ceilingUsd - cumulativeUsd`);
    }
  }
  return problems.length > 0 ? { ok: false, problems } : { ok: true };
}

/** Closed-schema validation for spend-ledger.json documents. */
export function validateLedgerDocument(
  value: unknown,
): { ok: true } | { ok: false; problems: string[] } {
  const problems: string[] = [];
  if (
    !isPlainRecord(value) ||
    value.schemaVersion !== DG11_SPEND_LEDGER_SCHEMA ||
    typeof value.target !== 'string' ||
    !isFiniteNonNegativeNumber(value.ceilingUsd) ||
    !isFiniteNonNegativeNumber(value.cumulativeUsd) ||
    !Array.isArray(value.entries)
  ) {
    return {
      ok: false,
      problems: [
        'spend-ledger must carry schemaVersion, target, ceilingUsd, cumulativeUsd, entries',
      ],
    };
  }
  const entrySum = value.entries.reduce(
    (sum, entry) =>
      sum +
      (isPlainRecord(entry) && isFiniteNumber(entry.measuredCostUsd) ? entry.measuredCostUsd : 0),
    0,
  );
  if (!near(entrySum, value.cumulativeUsd)) {
    problems.push(
      `spend-ledger cumulativeUsd (${value.cumulativeUsd}) != sum of entries (${entrySum})`,
    );
  }
  value.entries.forEach((entry, index) => {
    if (
      !isPlainRecord(entry) ||
      typeof entry.runId !== 'string' ||
      !isIso8601Utc(entry.recordedAt) ||
      !isFiniteNonNegativeNumber(entry.measuredCostUsd) ||
      !Number.isInteger(entry.calls) ||
      typeof entry.valid !== 'boolean' ||
      (entry.accountingGap !== undefined && typeof entry.accountingGap !== 'boolean')
    ) {
      problems.push(`spend-ledger.entries[${index}] shape is invalid`);
    }
  });
  return problems.length > 0 ? { ok: false, problems } : { ok: true };
}

async function filesUnder(
  directory: string,
  visited = new Set<string>(),
  ancestors = new Set<string>(),
): Promise<string[]> {
  let canonicalDirectory: string;
  try {
    canonicalDirectory = await realpath(directory);
  } catch (error) {
    if (isNodeError(error) && error.code === 'ELOOP') {
      throw new Error(`validator symlink loop detected at ${directory}`);
    }
    throw error;
  }
  if (ancestors.has(canonicalDirectory))
    throw new Error(`validator symlink loop detected at ${directory}`);
  if (visited.has(canonicalDirectory)) return [];
  visited.add(canonicalDirectory);
  const nextAncestors = new Set(ancestors).add(canonicalDirectory);
  const entries = await readdir(directory, { withFileTypes: true });
  const nested: string[][] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      nested.push(await filesUnder(path, visited, nextAncestors));
    } else if (entry.isSymbolicLink() && (await stat(path)).isDirectory()) {
      // Run artifacts contain package-manager symlinks (for example
      // .arxic-verification-suite/node_modules/@playwright/test). Dirent marks
      // these as non-directories, but they resolve to directories and must not
      // be passed to readFile as files.
      nested.push(await filesUnder(path, visited, nextAncestors));
    } else {
      nested.push([path]);
    }
  }
  return nested.flat().sort();
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

/** Scans every file under the directory with the production secret scanner. */
export async function scanDirectoryForSecrets(
  directory: string,
): Promise<Array<{ file: string; pattern: string }>> {
  const findings: Array<{ file: string; pattern: string }> = [];
  for (const path of await filesUnder(directory)) {
    const text = await readFile(path, 'utf8');
    for (const diagnostic of scanTextForSecrets(text)) {
      findings.push({ file: relative(directory, path), pattern: diagnostic.subject });
    }
  }
  return findings;
}

/** Live-key scan: files containing the exact value (value never printed). */
export async function scanDirectoryForValue(directory: string, value: string): Promise<string[]> {
  if (value.length === 0) return [];
  const hits: string[] = [];
  for (const path of await filesUnder(directory)) {
    if ((await readFile(path, 'utf8')).includes(value)) hits.push(relative(directory, path));
  }
  return hits;
}

/**
 * Full G-1 validation pass over an evidence directory: shape + arithmetic for
 * every record, coherence for every spend ledger, secret scan over every
 * file. Pending groundedness spot-checks are counted as incomplete-by-design
 * (never complete) — honest at tooling-PR time, blocking at evidence time.
 */
export async function validateRecordsDirectory(
  directory: string,
): Promise<DirectoryValidationResult> {
  const problems: string[] = [];
  const findings = await scanDirectoryForSecrets(directory);
  let records = 0;
  let complete = 0;
  let incomplete = 0;
  let refusals = 0;
  let ledgers = 0;
  const runsByRunId = new Map<string, { measuredCostUsd: number; target: string }>();
  const ledgerEntries: Array<{ ledgerTarget: string; runId: string; measuredCostUsd: number }> = [];
  // Finding 2: every run record MUST be accounted by an entry in its target's
  // spend ledger — a record with no ledger entry is invalid (unaccounted spend).
  const runAccounts: Array<{ target: string; runId: string }> = [];
  const ledgerEntryKeys = new Set<string>();
  const ledgerTargets = new Set<string>();

  const files = await filesUnder(directory);
  for (const path of files) {
    const rel = relative(directory, path);
    if (path.endsWith('.json')) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(await readFile(path, 'utf8'));
      } catch {
        problems.push(`${rel}: not valid JSON`);
        continue;
      }
      if (isPlainRecord(parsed) && parsed.schemaVersion === DG11_SPEND_LEDGER_SCHEMA) {
        ledgers += 1;
        const ledgerCheck = validateLedgerDocument(parsed);
        if (!ledgerCheck.ok) {
          problems.push(
            ...ledgerCheck.problems.map((problem) => `${rel}: spend-ledger ${problem}`),
          );
        }
        if (typeof parsed.target === 'string') ledgerTargets.add(parsed.target);
        if (Array.isArray(parsed.entries)) {
          for (const entry of parsed.entries) {
            if (isPlainRecord(entry) && typeof entry.runId === 'string') {
              ledgerEntries.push({
                ledgerTarget:
                  isPlainRecord(parsed) && typeof parsed.target === 'string' ? parsed.target : '',
                runId: entry.runId,
                measuredCostUsd: isFiniteNumber(entry.measuredCostUsd) ? entry.measuredCostUsd : 0,
              });
              if (typeof parsed.target === 'string') {
                ledgerEntryKeys.add(`${parsed.target}\u0000${entry.runId}`);
              }
            }
          }
        }
        continue;
      }
      if (
        isPlainRecord(parsed) &&
        typeof parsed.kind === 'string' &&
        parsed.kind.startsWith('dg11-')
      ) {
        const shape = validateRecordShape(parsed);
        if (!shape.ok) {
          problems.push(...shape.problems.map((problem) => `${rel}: ${problem}`));
          continue;
        }
        if (shape.kind === DG11_RECORD_KIND_REFUSAL) {
          refusals += 1;
          continue;
        }
        records += 1;
        const arithmetic = validateRecordArithmetic(parsed);
        if (!arithmetic.ok) {
          problems.push(...arithmetic.problems.map((problem) => `${rel}: ${problem}`));
        }
        const spotCheck = parsed.groundednessSpotCheck;
        if (isPlainRecord(spotCheck) && spotCheck.status === 'completed') complete += 1;
        else incomplete += 1;
        if (isPlainRecord(parsed.run) && typeof parsed.run.runId === 'string') {
          const measuredBlock = isPlainRecord(parsed.measured) ? parsed.measured : {};
          runsByRunId.set(parsed.run.runId, {
            measuredCostUsd: isFiniteNumber(measuredBlock.measuredCostUsd)
              ? measuredBlock.measuredCostUsd
              : 0,
            target:
              isPlainRecord(parsed.target) && typeof parsed.target.name === 'string'
                ? parsed.target.name
                : '',
          });
          if (
            isPlainRecord(parsed.target) &&
            typeof parsed.target.name === 'string' &&
            parsed.target.name.length > 0
          ) {
            runAccounts.push({ target: parsed.target.name, runId: parsed.run.runId });
          }
        }
      }
      // Other JSON files (configs, unrelated artifacts) stay scan-only.
    }
  }
  for (const entry of ledgerEntries) {
    const run = runsByRunId.get(entry.runId);
    if (
      run &&
      run.target === entry.ledgerTarget &&
      !near(run.measuredCostUsd, entry.measuredCostUsd)
    ) {
      problems.push(
        `spend-ledger for ${entry.ledgerTarget}: entry ${entry.runId} (${entry.measuredCostUsd}) != record measuredCostUsd (${run.measuredCostUsd})`,
      );
    }
  }
  // Finding 2: every run record must be accounted by a ledger entry for its
  // own target — no entry, no valid record.
  for (const account of runAccounts) {
    if (!ledgerTargets.has(account.target)) {
      problems.push(
        `no spend-ledger.json for target ${account.target}: run record ${account.runId} is unaccounted`,
      );
    } else if (!ledgerEntryKeys.has(`${account.target}\u0000${account.runId}`)) {
      problems.push(
        `spend-ledger for ${account.target} has no entry for run ${account.runId}: run record ${account.runId} is unaccounted`,
      );
    }
  }
  return {
    ok: problems.length === 0 && findings.length === 0,
    records,
    complete,
    incomplete,
    refusals,
    ledgers,
    problems,
    findings,
  };
}

/**
 * Live-key scan outcome (finding 9): `missing` (unset/empty/unnamed variable
 * or flag-without-value) is a FAILURE for the CLI unless the operator passed
 * --allow-missing-live-key explicitly — a silent skip must never read as a
 * clean scan.
 */
export type LiveKeyScanOutcome = Readonly<
  | { status: 'scanned'; variable: string; hits: readonly string[] }
  | { status: 'missing'; variable: string }
>;

export async function runLiveKeyScan(
  directory: string,
  input: Readonly<{ variable: string; value: string | undefined; allowMissing: boolean }>,
): Promise<LiveKeyScanOutcome> {
  const value = input.variable === '' ? '' : (input.value ?? '');
  if (value === '') {
    return { status: 'missing', variable: input.variable };
  }
  return {
    status: 'scanned',
    variable: input.variable,
    hits: await scanDirectoryForValue(directory, value),
  };
}

/** Exit code contribution of a missing live-key variable (finding 9). */
export function liveKeyMissingExitCode(allowMissing: boolean): 0 | 1 {
  return allowMissing ? 0 : 1;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const liveKeyEnvIndex = args.indexOf('--live-key-env');
  const allowMissingLiveKey = args.includes('--allow-missing-live-key');
  const liveKeyEnvFlagValue = liveKeyEnvIndex >= 0 ? (args[liveKeyEnvIndex + 1] ?? '') : undefined;
  const liveKeyEnv =
    liveKeyEnvFlagValue !== undefined && !liveKeyEnvFlagValue.startsWith('--')
      ? liveKeyEnvFlagValue
      : '';
  // A positional is any non-flag argument that is not the value slot after
  // --live-key-env (a value starting with '--' means the flag had no value).
  const positional = args.filter(
    (argument, index) => !argument.startsWith('--') && index !== liveKeyEnvIndex + 1,
  );
  const directory = positional[0];
  if (!directory) {
    console.error(
      'usage: validate-records.ts <evidence-directory> [--live-key-env VAR] [--allow-missing-live-key]',
    );
    process.exitCode = 2;
    return;
  }
  const result = await validateRecordsDirectory(directory);
  console.log(
    JSON.stringify(
      {
        directory,
        records: result.records,
        complete: result.complete,
        incompleteByDesign: result.incomplete,
        refusals: result.refusals,
        ledgers: result.ledgers,
        secretFindings: result.findings.length,
        problems: result.problems.length,
      },
      null,
      1,
    ),
  );
  if (result.findings.length > 0) {
    for (const finding of result.findings) {
      console.error(`SECRET FINDING ${finding.file}: matched ${finding.pattern}`);
    }
  }
  for (const problem of result.problems) console.error(`PROBLEM ${problem}`);
  if (liveKeyEnvIndex >= 0) {
    const scan = await runLiveKeyScan(directory, {
      variable: liveKeyEnv,
      value: liveKeyEnv === '' ? undefined : process.env[liveKeyEnv],
      allowMissing: allowMissingLiveKey,
    });
    if (scan.status === 'missing') {
      const label = scan.variable === '' ? '(flag present, no variable named)' : scan.variable;
      if (allowMissingLiveKey) {
        console.log(`live-key scan ${label}: variable not set — skip explicitly allowed`);
      } else {
        console.error(
          `live-key scan ${label}: variable not set — FAILING (a missing live key must never read as a clean scan; pass --allow-missing-live-key to permit the skip)`,
        );
        process.exitCode = liveKeyMissingExitCode(false);
      }
    } else {
      console.log(
        `live-key scan (${scan.variable}): ${scan.hits.length === 0 ? 'clean' : `${scan.hits.length} file(s) contain the value`}`,
      );
      for (const hit of scan.hits)
        console.error(`SECRET FINDING ${hit}: contains ${scan.variable} value`);
      if (scan.hits.length > 0) process.exitCode = 1;
    }
  }
  if (!result.ok) process.exitCode = 1;
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  await main();
}
