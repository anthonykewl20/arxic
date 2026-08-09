import { createHash } from 'node:crypto';
import { rm, truncate, writeFile } from 'node:fs/promises';
import {
  DEFAULT_TRACE_ARCHIVE_LIMITS,
  BoundedFileLimitError,
  readArchive,
  readBoundedFile,
  TraceArchiveError,
  type TraceArchiveLimits,
  writeDeterministicArchive,
} from './zip';

export const TRACE_SANITIZER_ID = '@arxic/playwright-trace-sanitizer' as const;
export const TRACE_SANITIZER_VERSION = 1 as const;

export type TraceSanitizationFailureCode =
  | TraceArchiveError['code']
  | 'TRACE_FORMAT_INVALID'
  | 'TRACE_RESIDUAL_SENSITIVE_DATA'
  | 'TRACE_PROVENANCE_INVALID'
  | 'TRACE_SOURCE_CLEANUP_FAILED'
  | 'TRACE_IO_FAILED';

export type TraceSanitizationFailure = Readonly<{
  ok: false;
  code: TraceSanitizationFailureCode;
  message: string;
  cleanupFailure?: Readonly<{
    sourceDisposition: 'removed' | 'truncated' | 'failed';
    eligibleOutputsRemoved: boolean;
  }>;
}>;

export type TraceSanitizationProvenance = Readonly<{
  schemaVersion: 1;
  sanitizer: Readonly<{ id: typeof TRACE_SANITIZER_ID; version: 1 }>;
  source: Readonly<{ sha256: string; size: number }>;
  output: Readonly<{ sha256: string; size: number }>;
  logicalMembers: readonly string[];
  projection: Readonly<Record<ProjectionMetric, number>>;
  residualScan: Readonly<{ passed: true; scannedEntries: number; scannedBytes: number }>;
}>;

export type TraceSanitizationResult =
  Readonly<{ ok: true; provenance: TraceSanitizationProvenance }> | TraceSanitizationFailure;

export type TraceInspectionResult =
  | Readonly<{
      ok: true;
      provenance: TraceSanitizationProvenance;
      traceSha256: string;
      provenanceSha256: string;
      traceBytes: Buffer;
      provenanceBytes: Buffer;
    }>
  | TraceSanitizationFailure;

export type TraceSanitizationOptions = Readonly<{
  sourcePath: string;
  outputPath: string;
  provenancePath: string;
  forbiddenSubstrings?: readonly string[];
  limits?: Partial<TraceArchiveLimits>;
}>;

export type TraceInspectionOptions = Readonly<{
  tracePath: string;
  provenancePath: string;
  forbiddenSubstrings?: readonly string[];
  limits?: Partial<TraceArchiveLimits>;
}>;

export type CapturedArtifactDiscardResult =
  | Readonly<{ ok: true; sourceDisposition: 'removed' }>
  | Readonly<{ ok: false; sourceDisposition: 'truncated' | 'failed' }>;

export function isSensitiveArtifactFilename(
  fileName: string,
  forbiddenSubstrings: readonly string[] = [],
): boolean {
  const stem = fileName.replace(/\.[^.]*$/u, '');
  return (
    isSensitiveKey(stem) ||
    normalizedForbidden(forbiddenSubstrings).some((value) => fileName.includes(value)) ||
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu.test(fileName)
  );
}

type ProjectionMetric = 'remappedActions' | 'retainedActions';

type JsonContainer = Record<string, unknown> | unknown[];
type StructuralBudget = { values: number; nodes: number; stringBytes: number };

const logicalExtension = /\.(?:trace|network|stacks)$/u;
const provenanceMaxBytes = 1024 * 1024;
const maxJsonLineBytes = 1024 * 1024;
const maxJsonDepth = 64;
const maxJsonValues = 50_000;
const maxJsonNodes = 200_000;
const maxJsonStringBytes = 8 * 1024 * 1024;
const maxActions = 10_000;
const allowedActionPairs = new Map<string, ReadonlySet<string>>([
  ['BrowserContext', new Set(['clearCookies', 'newPage'])],
  ['Frame', new Set(['click', 'expect', 'fill', 'goto'])],
  ['Page', new Set(['screenshot'])],
  ['Test', new Set(['expect', 'fixture', 'hook', 'pw:api', 'test.step'])],
]);

export async function sanitizePlaywrightTrace(
  options: TraceSanitizationOptions,
): Promise<TraceSanitizationResult> {
  try {
    const maxArchiveBytes =
      options.limits?.maxArchiveBytes ?? DEFAULT_TRACE_ARCHIVE_LIMITS.maxArchiveBytes;
    const sourceBytes = await readArchiveBytes(options.sourcePath, maxArchiveBytes);
    const archive = await readArchive(sourceBytes, options.limits);
    const counters = projectionCounters();
    const forbidden = normalizedForbidden(options.forbiddenSubstrings);
    const sanitized = sanitizeArchive(archive, forbidden, counters);
    const outputBytes = await writeDeterministicArchive(sanitized);
    const scan = inspectArchive(sanitized, forbidden);
    if (!scan.ok) return scan;
    const provenance: TraceSanitizationProvenance = {
      schemaVersion: 1,
      sanitizer: { id: TRACE_SANITIZER_ID, version: TRACE_SANITIZER_VERSION },
      source: { sha256: sha256(sourceBytes), size: sourceBytes.byteLength },
      output: { sha256: sha256(outputBytes), size: outputBytes.byteLength },
      logicalMembers: logicalMembers(sanitized),
      projection: counters,
      residualScan: {
        passed: true,
        scannedEntries: scan.scannedEntries,
        scannedBytes: scan.scannedBytes,
      },
    };
    await writeFile(options.outputPath, outputBytes);
    await writeFile(options.provenancePath, canonicalJson(provenance), 'utf8');
    return { ok: true, provenance };
  } catch (error) {
    return failureFor(error);
  }
}

export async function sanitizeCapturedPlaywrightTrace(
  options: TraceSanitizationOptions,
): Promise<TraceSanitizationResult> {
  const result = await sanitizePlaywrightTrace(options);
  const sourceDisposition = await eraseRawSource(options.sourcePath);
  const removeOutputs = sourceDisposition !== 'removed' || !result.ok;
  const eligibleOutputsRemoved = removeOutputs
    ? await removeEligibleOutputs(options.outputPath, options.provenancePath)
    : true;
  if (sourceDisposition === 'removed' && eligibleOutputsRemoved) return result;
  const cleanupFailure = {
    sourceDisposition,
    eligibleOutputsRemoved,
  } as const;
  if (!result.ok) return { ...result, cleanupFailure };
  return {
    ok: false,
    code: 'TRACE_SOURCE_CLEANUP_FAILED',
    message: 'Raw trace cleanup failed; retained output is ineligible',
    cleanupFailure,
  };
}

export async function discardCapturedArtifact(
  sourcePath: string,
): Promise<CapturedArtifactDiscardResult> {
  const sourceDisposition = await eraseRawSource(sourcePath);
  return sourceDisposition === 'removed'
    ? { ok: true, sourceDisposition }
    : { ok: false, sourceDisposition };
}

export async function inspectPlaywrightTrace(
  options: TraceInspectionOptions,
): Promise<TraceInspectionResult> {
  try {
    const maxArchiveBytes =
      options.limits?.maxArchiveBytes ?? DEFAULT_TRACE_ARCHIVE_LIMITS.maxArchiveBytes;
    const [traceBytes, reportBytes] = await Promise.all([
      readArchiveBytes(options.tracePath, maxArchiveBytes),
      readProvenanceBytes(options.provenancePath),
    ]);
    const reportText = decodeText(reportBytes);
    if (reportText === undefined) throw provenanceError();
    const provenance = parseProvenance(reportText);
    if (!reportBytes.equals(Buffer.from(canonicalJson(provenance), 'utf8'))) {
      return provenanceFailure();
    }
    if (
      provenance.output.sha256 !== sha256(traceBytes) ||
      provenance.output.size !== traceBytes.byteLength
    ) {
      return provenanceFailure();
    }
    const archive = await readArchive(traceBytes, options.limits);
    if (!sameStrings(provenance.logicalMembers, logicalMembers(archive))) {
      return provenanceFailure();
    }
    const canonicalTraceBytes = await writeDeterministicArchive(archive);
    if (!traceBytes.equals(canonicalTraceBytes)) {
      return residualFailure('non-canonical ZIP container');
    }
    const scan = inspectArchive(archive, normalizedForbidden(options.forbiddenSubstrings));
    if (!scan.ok) return scan;
    if (
      provenance.projection.remappedActions !== scan.actionCount ||
      provenance.projection.retainedActions !== scan.actionCount ||
      provenance.residualScan.scannedEntries !== scan.scannedEntries ||
      provenance.residualScan.scannedBytes !== scan.scannedBytes
    ) {
      return provenanceFailure();
    }
    return {
      ok: true,
      provenance,
      traceSha256: sha256(traceBytes),
      provenanceSha256: sha256(reportBytes),
      traceBytes,
      provenanceBytes: reportBytes,
    };
  } catch (error) {
    return failureFor(error, true);
  }
}

export async function isBoundedPlaywrightTraceArchive(
  bytes: Buffer,
  limits: Partial<TraceArchiveLimits> = {},
): Promise<boolean> {
  try {
    const archive = await readArchive(bytes, limits);
    return [...archive.keys()].some((name) => name.endsWith('.trace'));
  } catch {
    return false;
  }
}

function sanitizeArchive(
  archive: ReadonlyMap<string, Buffer>,
  _forbidden: readonly string[],
  counters: Record<ProjectionMetric, number>,
): Map<string, Buffer> {
  const traceMembers = [...archive]
    .filter(([name]) => name.endsWith('.trace'))
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  if (traceMembers.length === 0) throw formatError('missing trace member');
  const output = new Map<string, Buffer>();
  const budget = structuralBudget();
  let actionCount = 0;
  let chromiumContexts = 0;
  for (const [index, [, bytes]] of traceMembers.entries()) {
    const parsed = parseJsonLines(bytes, budget);
    const projection = projectTraceEvents(parsed);
    if (projection.actionCount === 0) throw formatError('trace member contains no known action');
    if (projection.chromiumContext) chromiumContexts += 1;
    actionCount += projection.actionCount;
    if (actionCount > maxActions) throw formatError('trace action limit exceeded');
    counters.remappedActions += projection.actionCount;
    counters.retainedActions += projection.actionCount;
    output.set(
      `trace-${String(index + 1).padStart(3, '0')}.trace`,
      Buffer.from(`${projection.events.map(canonicalJsonValue).join('\n')}\n`),
    );
  }
  if (actionCount === 0) throw formatError('trace contains no complete action');
  if (chromiumContexts === 0) throw formatError('trace has no Chromium context');
  return output;
}

function projectTraceEvents(values: readonly JsonContainer[]): {
  events: JsonContainer[];
  actionCount: number;
  chromiumContext: boolean;
} {
  const seenCalls = new Set<string>();
  const openCalls = new Map<
    string,
    { order: number; startTime: number; actionClass: string; method: string }
  >();
  const droppedCalls = new Set<string>();
  const completed: Array<{
    order: number;
    kind: 'action' | 'pair';
    actionClass: string;
    method: string;
  }> = [];
  let contexts = 0;
  let chromiumContext = false;
  let testRunnerContext = false;
  let nextOrder = 0;
  for (const value of values) {
    if (!isRecord(value) || typeof value.type !== 'string') continue;
    if (value.type === 'context-options') {
      contexts += 1;
      if (contexts !== 1 || completed.length !== 0 || openCalls.size !== 0) {
        throw formatError('invalid context event');
      }
      if (value.version !== 8) throw formatError('unsupported trace version');
      chromiumContext = value.browserName === 'chromium';
      testRunnerContext = value.browserName === '' && value.origin === 'testRunner';
      if (!chromiumContext && !testRunnerContext) throw formatError('unsupported trace browser');
      continue;
    }
    if (value.type !== 'before' && value.type !== 'after' && value.type !== 'action') continue;
    if (contexts !== 1) throw formatError('action precedes context');
    if (typeof value.callId !== 'string') throw formatError('action lacks call id');
    if (value.type === 'after') {
      if (droppedCalls.delete(value.callId)) continue;
      const existing = openCalls.get(value.callId);
      if (!existing || !finiteNonNegative(value.endTime)) {
        throw formatError('orphan action event');
      }
      if (value.endTime < existing.startTime) throw formatError('invalid action timing');
      openCalls.delete(value.callId);
      completed.push({
        order: existing.order,
        kind: 'pair',
        actionClass: existing.actionClass,
        method: existing.method,
      });
      continue;
    }
    if (seenCalls.has(value.callId)) throw formatError('duplicate action event');
    seenCalls.add(value.callId);
    if (!finiteNonNegative(value.startTime)) throw formatError('action lacks start time');
    if (
      value.type === 'action' &&
      (!finiteNonNegative(value.endTime) || value.endTime < value.startTime)
    ) {
      throw formatError('invalid action timing');
    }
    const knownAction =
      typeof value.class === 'string' &&
      typeof value.method === 'string' &&
      allowedActionPairs.get(value.class)?.has(value.method) === true;
    if (!knownAction) {
      if (value.type === 'before') droppedCalls.add(value.callId);
      continue;
    }
    const actionClass = value.class as string;
    const method = value.method as string;
    const order = nextOrder;
    nextOrder += 1;
    if (value.type === 'before') {
      openCalls.set(value.callId, {
        order,
        startTime: value.startTime,
        actionClass,
        method,
      });
    } else {
      completed.push({ order, kind: 'action', actionClass, method });
    }
  }
  if (contexts !== 1) throw formatError('incomplete action timeline');
  completed.sort((left, right) => left.order - right.order);
  if (testRunnerContext && completed.some(({ actionClass }) => actionClass !== 'Test')) {
    throw formatError('non-test action in test-runner trace');
  }
  const events: JsonContainer[] = [fixedContextEvent(chromiumContext)];
  for (const [index, action] of completed.entries()) {
    const callId = `call@${index + 1}`;
    const startTime = index * 2 + 1;
    const metadata = {
      callId,
      class: action.actionClass,
      method: action.method,
      apiName: `${action.actionClass}.${action.method}`,
      params: {},
    };
    if (action.kind === 'action') {
      events.push({ type: 'action', ...metadata, startTime, endTime: startTime + 1 });
    } else {
      events.push(
        { type: 'before', ...metadata, startTime },
        { type: 'after', callId, endTime: startTime + 1 },
      );
    }
  }
  return { events, actionCount: completed.length, chromiumContext };
}

function fixedContextEvent(chromiumContext: boolean): JsonContainer {
  return {
    type: 'context-options',
    version: 8,
    contextId: 'context@1',
    browserName: chromiumContext ? 'chromium' : '',
    sdkLanguage: 'javascript',
    monotonicTime: 0,
    wallTime: 0,
    origin: chromiumContext ? 'library' : 'testRunner',
    platform: 'redacted',
    options: {},
  };
}

function finiteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function inspectArchive(
  archive: ReadonlyMap<string, Buffer>,
  forbidden: readonly string[],
):
  | { ok: true; scannedEntries: number; scannedBytes: number; actionCount: number }
  | TraceSanitizationFailure {
  try {
    const traceMembers = [...archive.keys()].sort();
    if (traceMembers.length === 0) throw formatError('missing trace member');
    if (
      traceMembers.some(
        (name, index) => name !== `trace-${String(index + 1).padStart(3, '0')}.trace`,
      )
    ) {
      return residualFailure('non-canonical member');
    }
    let scannedBytes = 0;
    let actionCount = 0;
    let chromiumContexts = 0;
    const budget = structuralBudget();
    for (const [, bytes] of archive) {
      scannedBytes += bytes.byteLength;
      const values = parseJsonLines(bytes, budget);
      const projection = projectTraceEvents(values);
      if (projection.actionCount === 0) throw formatError('trace member contains no known action');
      if (projection.chromiumContext) chromiumContexts += 1;
      actionCount += projection.actionCount;
      if (actionCount > maxActions) throw formatError('trace action limit exceeded');
      if (
        projection.events.length !== values.length ||
        projection.events.some(
          (item, index) => canonicalJsonValue(item) !== canonicalJsonValue(values[index]),
        )
      ) {
        return residualFailure('non-projected trace data');
      }
      const canonical = `${projection.events.map(canonicalJsonValue).join('\n')}\n`;
      if (!bytes.equals(Buffer.from(canonical, 'utf8'))) {
        return residualFailure('non-canonical trace bytes');
      }
      if (forbidden.some((substring) => canonical.includes(substring))) {
        return residualFailure('forbidden trace value');
      }
    }
    if (actionCount === 0) throw formatError('trace contains no complete action');
    if (chromiumContexts === 0) throw formatError('trace has no Chromium context');
    return { ok: true, scannedEntries: archive.size, scannedBytes, actionCount };
  } catch (error) {
    if (error instanceof TraceArchiveError) throw error;
    if (error instanceof TraceFormatError) throw error;
    throw formatError('invalid logical member');
  }
}

function parseJsonLines(
  bytes: Buffer,
  budget: StructuralBudget = structuralBudget(),
): JsonContainer[] {
  const values: JsonContainer[] = [];
  let start = 0;
  for (let index = 0; index <= bytes.length; index += 1) {
    if (index !== bytes.length && bytes[index] !== 10) continue;
    if (index === bytes.length && start === index) break;
    if (budget.values >= maxJsonValues) throw formatError('trace value limit exceeded');
    budget.values += 1;
    const end = index > start && bytes[index - 1] === 13 ? index - 1 : index;
    if (end === start) {
      start = index + 1;
      continue;
    }
    const lineBytes = bytes.subarray(start, end);
    start = index + 1;
    if (lineBytes.byteLength > maxJsonLineBytes) throw formatError('trace line limit exceeded');
    const line = decodeRequiredText(lineBytes);
    if (/^\s*$/u.test(line)) continue;
    validateLexicalDepth(line);
    const value = parseJson(line);
    validateStructure(value, budget);
    values.push(value);
  }
  return values;
}

function structuralBudget(): StructuralBudget {
  return { values: 0, nodes: 0, stringBytes: 0 };
}

function validateLexicalDepth(text: string): void {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (const character of text) {
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === '{' || character === '[') {
      depth += 1;
      if (depth > maxJsonDepth) throw formatError('trace nesting limit exceeded');
    } else if (character === '}' || character === ']') {
      depth -= 1;
      if (depth < 0) throw formatError('invalid trace nesting');
    }
  }
  if (depth !== 0 || inString || escaped) throw formatError('invalid trace JSON');
}

function validateStructure(value: unknown, budget: StructuralBudget): void {
  const pending: Array<{ value: unknown; depth: number }> = [{ value, depth: 1 }];
  while (pending.length > 0) {
    const current = pending.pop()!;
    budget.nodes += 1;
    if (budget.nodes > maxJsonNodes || current.depth > maxJsonDepth) {
      throw formatError('trace structure limit exceeded');
    }
    if (typeof current.value === 'string') {
      budget.stringBytes += Buffer.byteLength(current.value);
    } else if (Array.isArray(current.value)) {
      for (const item of current.value) pending.push({ value: item, depth: current.depth + 1 });
    } else if (isRecord(current.value)) {
      for (const [key, item] of Object.entries(current.value)) {
        budget.stringBytes += Buffer.byteLength(key);
        pending.push({ value: item, depth: current.depth + 1 });
      }
    }
    if (budget.stringBytes > maxJsonStringBytes) {
      throw formatError('trace string limit exceeded');
    }
  }
}

function parseJson(text: string): JsonContainer {
  try {
    const value: unknown = JSON.parse(text);
    if (value === null || typeof value !== 'object') throw formatError('invalid JSON value');
    return value as JsonContainer;
  } catch (error) {
    if (error instanceof TraceFormatError) throw error;
    throw formatError('invalid JSON');
  }
}

function parseProvenance(text: string): TraceSanitizationProvenance {
  try {
    validateLexicalDepth(text.trim());
    const value: unknown = JSON.parse(text);
    validateStructure(value, structuralBudget());
    if (
      !isRecord(value) ||
      !hasExactKeys(value, [
        'logicalMembers',
        'output',
        'projection',
        'residualScan',
        'sanitizer',
        'schemaVersion',
        'source',
      ]) ||
      value.schemaVersion !== 1 ||
      !isRecord(value.sanitizer) ||
      !hasExactKeys(value.sanitizer, ['id', 'version']) ||
      value.sanitizer.id !== TRACE_SANITIZER_ID ||
      value.sanitizer.version !== TRACE_SANITIZER_VERSION ||
      !validDigestRecord(value.source) ||
      !validDigestRecord(value.output) ||
      !Array.isArray(value.logicalMembers) ||
      value.logicalMembers.some((item) => typeof item !== 'string') ||
      !isRecord(value.projection) ||
      !validProjection(value.projection) ||
      !isRecord(value.residualScan) ||
      !hasExactKeys(value.residualScan, ['passed', 'scannedBytes', 'scannedEntries']) ||
      value.residualScan.passed !== true ||
      !nonNegativeInteger(value.residualScan.scannedEntries) ||
      !nonNegativeInteger(value.residualScan.scannedBytes)
    ) {
      throw provenanceError();
    }
    return value as TraceSanitizationProvenance;
  } catch (error) {
    if (error instanceof TraceProvenanceError) throw error;
    throw provenanceError();
  }
}

function validDigestRecord(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['sha256', 'size']) &&
    typeof value.sha256 === 'string' &&
    /^[0-9a-f]{64}$/u.test(value.sha256) &&
    nonNegativeInteger(value.size)
  );
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return sameStrings(Object.keys(value).sort(), [...expected].sort());
}

function validProjection(value: Record<string, unknown>): boolean {
  const expected = Object.keys(projectionCounters()).sort();
  const actual = Object.keys(value).sort();
  return sameStrings(expected, actual) && actual.every((key) => nonNegativeInteger(value[key]));
}

function logicalMembers(archive: ReadonlyMap<string, Buffer>): string[] {
  return [...archive.keys()].filter((name) => logicalExtension.test(name)).sort();
}

function normalizedForbidden(values: readonly string[] | undefined): string[] {
  return [...new Set((values ?? []).filter((value) => value.length > 0))].sort();
}

function projectionCounters(): Record<ProjectionMetric, number> {
  return {
    remappedActions: 0,
    retainedActions: 0,
  };
}

function decodeText(bytes: Buffer): string | undefined {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

function decodeRequiredText(bytes: Buffer): string {
  const value = decodeText(bytes);
  if (value === undefined) throw formatError('invalid UTF-8');
  return value;
}

function canonicalJson(value: unknown): string {
  return `${canonicalJsonValue(value)}\n`;
}

function canonicalJsonValue(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw formatError('non-finite number');
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  throw formatError('unsupported JSON value');
}

function isSensitiveKey(key: string): boolean {
  const words = key
    .replace(/([a-z0-9])([A-Z])/gu, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/gu, '$1-$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter(Boolean);
  const sensitiveWords = new Set([
    'auth',
    'authorization',
    'cookie',
    'credential',
    'email',
    'key',
    'otp',
    'passwd',
    'password',
    'pwd',
    'secret',
    'session',
    'token',
  ]);
  if (words.some((word) => sensitiveWords.has(word))) return true;
  const compact = words.join('');
  return /(?:apikey|authorization|cookie|credential|email|otp|passwd|password(?:hash)?|secret|session(?:id|token)?|token)$/u.test(
    compact,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function readArchiveBytes(path: string, maxBytes: number): Promise<Buffer> {
  try {
    return await readBoundedFile(path, maxBytes);
  } catch (error) {
    if (error instanceof BoundedFileLimitError) {
      throw new TraceArchiveError(
        'TRACE_ZIP_LIMIT_EXCEEDED',
        'Trace archive exceeds configured safety limits',
      );
    }
    throw error;
  }
}

async function readProvenanceBytes(path: string): Promise<Buffer> {
  try {
    return await readBoundedFile(path, provenanceMaxBytes);
  } catch (error) {
    if (error instanceof BoundedFileLimitError) throw provenanceError();
    throw error;
  }
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function failureFor(error: unknown, provenanceContext = false): TraceSanitizationFailure {
  if (error instanceof TraceArchiveError) {
    return { ok: false, code: error.code, message: error.message };
  }
  if (error instanceof TraceFormatError) {
    return { ok: false, code: 'TRACE_FORMAT_INVALID', message: error.message };
  }
  if (error instanceof TraceProvenanceError || provenanceContext) return provenanceFailure();
  return { ok: false, code: 'TRACE_IO_FAILED', message: 'Trace artifact I/O failed' };
}

function residualFailure(area = 'content'): TraceSanitizationFailure {
  return {
    ok: false,
    code: 'TRACE_RESIDUAL_SENSITIVE_DATA',
    message: `Trace residual scan found unsafe ${area}`,
  };
}

function provenanceFailure(): TraceSanitizationFailure {
  return {
    ok: false,
    code: 'TRACE_PROVENANCE_INVALID',
    message: 'Trace sanitization provenance is invalid',
  };
}

class TraceFormatError extends Error {}
class TraceProvenanceError extends Error {}

function formatError(area = 'data'): TraceFormatError {
  return new TraceFormatError(`Playwright trace has malformed or incomplete ${area}`);
}

function provenanceError(): TraceProvenanceError {
  return new TraceProvenanceError('Trace sanitization provenance is invalid');
}

async function eraseRawSource(path: string): Promise<'removed' | 'truncated' | 'failed'> {
  try {
    await rm(path, { force: true });
    return 'removed';
  } catch {
    try {
      await truncate(path, 0);
    } catch {
      return 'failed';
    }
    try {
      await rm(path, { force: true });
      return 'removed';
    } catch {
      return 'truncated';
    }
  }
}

async function removeEligibleOutputs(outputPath: string, provenancePath: string): Promise<boolean> {
  const settled = await Promise.allSettled([
    rm(outputPath, { force: true }),
    rm(provenancePath, { force: true }),
  ]);
  return settled.every(({ status }) => status === 'fulfilled');
}

export { DEFAULT_TRACE_ARCHIVE_LIMITS };
export type { TraceArchiveLimits };
