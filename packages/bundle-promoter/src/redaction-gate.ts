import { readFile, readdir } from 'node:fs/promises';
import { basename, extname, join, relative } from 'node:path';
import type { Diagnostic } from '@arxic/contracts';
import { inspectPlaywrightTrace } from '@arxic/playwright-trace-sanitizer';
import { ARXIC_PROMOTION_REDACTION_FAILED, promotionDiagnostic } from './diagnostics';

export type RedactionFinding = Readonly<{
  file: string;
  pattern: string;
}>;

export type RedactionResult = Readonly<{
  passed: boolean;
  diagnostics: readonly Diagnostic[];
  scannedFiles: number;
  findings: readonly RedactionFinding[];
}>;

/** Stable token used when a known runtime-only value reaches a persisted payload. */
export const PERSIST_REDACTION_PLACEHOLDER = '__ARXIC_REDACTED_PERSONA__';

/**
 * Stable token replacing a recorded control `label` value that matched a
 * pattern class (issue #474): the DG-297 label-first chain persists UI copy —
 * aria-label → label text → INPUT PLACEHOLDER → text content — as the label,
 * and real-world apps ubiquitously put `you@example.com`-style placeholders on
 * email inputs. Labels are display text, not user data, so a pattern hit there
 * is masked whole (never a partial-secret substring), while every pattern-class
 * match outside a label value keeps the fail-closed refusal.
 */
export const PERSIST_REDACTED_LABEL = '__ARXIC_REDACTED_LABEL__';

export type PersistenceRedactionResult = Readonly<{
  text: string;
  diagnostics: readonly Diagnostic[];
  /** Pattern classes whose only occurrences were masked inside label values. */
  maskedLabelClasses?: readonly string[];
}>;

/** Controls whether class-pattern checks are meaningful for a persisted payload. */
export type PersistedPayloadScanOptions = Readonly<{
  knownValues: readonly string[];
  includePatternClasses: boolean;
}>;

/** Persisted-payload category that determines whether class patterns apply. */
export type PersistedPayloadKind = 'source-bearing' | 'credential-bearing';

const sourceBearingArtifactNames = new Set(['01.json', '02.json', '03.json', '13.json']);

/**
 * Classifies persisted payload paths for the shared write-time and audit-time
 * secret-scan policy. Source-derived artifacts can carry target source text;
 * every other persisted payload is credential-bearing and retains full class
 * pattern scanning.
 */
export function classifyPersistedPayload(relPath: string): PersistedPayloadKind {
  const segments = relPath.replaceAll('\\', '/').split('/');
  return segments.at(-2) === 'artifacts' && sourceBearingArtifactNames.has(segments.at(-1) ?? '')
    ? 'source-bearing'
    : 'credential-bearing';
}

const textExtensions = new Set(['.json', '.ts', '.md', '.txt', '.sha256']);
const patterns = [
  {
    name: 'email-address',
    expression: /[A-Za-z0-9._%+-]+@(?!example\.test)[A-Za-z0-9.-]+\.[A-Z]{2,}/iu,
  },
  { name: 'authorization-header', expression: /authorization\s*[:=]\s*bearer\s+/iu },
  { name: 'bearer-token', expression: /bearer\s+[A-Za-z0-9._-]{20,}/iu },
  {
    name: 'api-key-assignment',
    expression: /(?:api[_-]?key|apikey)\s*[=:]\s*['"]?[A-Za-z0-9]{16,}/iu,
  },
  {
    name: 'password-literal',
    expression: /password\s*[=:]\s*['"]?[A-Za-z0-9!@#$%^&*]{4,}/iu,
  },
  { name: 'connect-session-cookie', expression: /connect\.sid\s*=/iu },
  { name: 'session-token', expression: /session\s*token\s*[=:]/iu },
] as const;

export function scanTextForSecrets(text: string): readonly Diagnostic[] {
  const content = allowlisted(text);
  return patterns
    .filter((pattern) => matches(pattern, content))
    .map((pattern) =>
      promotionDiagnostic(
        ARXIC_PROMOTION_REDACTION_FAILED,
        pattern.name,
        `Sensitive data matched ${pattern.name}`,
      ),
    );
}

/**
 * Replaces exact runtime-only values before serialization. Longest values are
 * replaced first so overlapping values cannot leave a suffix behind; the
 * placeholder is intentionally constant to preserve deterministic artifacts.
 */
export function redactTextForPersistence(text: string, values: readonly string[]): string {
  const ordered = [...new Set(values.filter((value) => value.length > 0))].sort(
    (left, right) => right.length - left.length || left.localeCompare(right),
  );
  return ordered.reduce(
    (redacted, value) => redacted.split(value).join(PERSIST_REDACTION_PLACEHOLDER),
    text,
  );
}

/**
 * Scans a post-redaction payload. Exact known values are always prohibited;
 * class patterns are deliberately restricted to payloads that cannot embed
 * target source code. `scanTextForSecrets` remains the evidence-tree API.
 */
export function scanPersistedPayloadForSecrets(
  text: string,
  options: PersistedPayloadScanOptions,
): readonly Diagnostic[] {
  const exactValueDiagnostics = [
    ...new Set(options.knownValues.filter((value) => value.length > 0)),
  ]
    .filter((value) => text.includes(value))
    .map(() =>
      promotionDiagnostic(
        ARXIC_PROMOTION_REDACTION_FAILED,
        'persona-value',
        'Sensitive data matched a known replay-persona value',
      ),
    );
  return [
    ...exactValueDiagnostics,
    ...(options.includePatternClasses ? scanTextForSecrets(text) : []),
  ];
}

/** A `"label":"…"` JSON property in serialized stage/evidence payloads. */
const labelProperty = /"label":"(?:[^"\\]|\\.)*"/gu;

/**
 * Masks pattern-class matches inside recorded label values (UI copy). Runs
 * AFTER exact known-value redaction, so replay-persona literals keep the
 * persona placeholder; returns the classes it masked for attribution.
 */
function maskLabelUiCopy(text: string): { text: string; maskedClasses: string[] } {
  const masked = new Set<string>();
  const maskedText = text.replace(labelProperty, (property) => {
    const { label } = JSON.parse(`{${property}}`) as { label: string };
    const hits = patterns.filter((pattern) => matches(pattern, label));
    for (const { name } of hits) masked.add(name);
    return hits.length ? `"label":"${PERSIST_REDACTED_LABEL}"` : property;
  });
  return { text: maskedText, maskedClasses: [...masked].sort() };
}

/** Redact known runtime values, then apply the scoped write-time secret sweep. */
export function redactAndScanPersistedPayload(
  text: string,
  options: PersistedPayloadScanOptions,
): PersistenceRedactionResult {
  const clean = redactTextForPersistence(text, options.knownValues);
  const masked = maskLabelUiCopy(clean);
  return {
    text: masked.text,
    diagnostics: scanPersistedPayloadForSecrets(masked.text, options),
    ...(masked.maskedClasses.length ? { maskedLabelClasses: masked.maskedClasses } : {}),
  };
}

function matches(pattern: (typeof patterns)[number], content: string): boolean {
  if (pattern.name === 'email-address') return containsEmail(pattern.expression, content);
  return pattern.expression.test(content);
}

function containsEmail(expression: RegExp, content: string): boolean {
  for (let at = content.indexOf('@'); at >= 0; at = content.indexOf('@', at + 1)) {
    let start = at;
    let end = at + 1;
    while (start > 0 && /[A-Za-z0-9._%+-]/u.test(content[start - 1]!)) start -= 1;
    while (end < content.length && /[A-Za-z0-9.-]/u.test(content[end]!)) end += 1;
    if (expression.test(content.slice(start, end))) return true;
  }
  return false;
}

export async function scanBundleForSensitiveData(directory: string): Promise<RedactionResult> {
  const allFiles = await filesUnder(directory);
  const files = allFiles.filter((path) => textExtensions.has(extname(path)));
  const findings: RedactionFinding[] = [];
  for (const file of files) {
    const diagnostics = scanTextForSecrets(await readFile(file, 'utf8'));
    for (const diagnostic of diagnostics) {
      findings.push({
        file: relative(directory, file),
        pattern: diagnostic.subject,
      });
    }
  }
  const traces = allFiles.filter((path) => extname(path) === '.zip');
  for (const trace of traces) {
    const report = join(directory, 'artifacts', 'reports', `${basename(trace)}.sanitization.json`);
    const inspected = await inspectPlaywrightTrace({
      tracePath: trace,
      provenancePath: report,
    });
    if (!inspected.ok) {
      findings.push({
        file: relative(directory, trace),
        pattern: `playwright-trace-${inspected.code.toLowerCase()}`,
      });
    }
  }
  return {
    passed: findings.length === 0,
    diagnostics: findings.map((finding) =>
      promotionDiagnostic(
        ARXIC_PROMOTION_REDACTION_FAILED,
        finding.file,
        `Sensitive data matched ${finding.pattern}`,
      ),
    ),
    scannedFiles: files.length + traces.length,
    findings,
  };
}

function allowlisted(content: string): string {
  return content
    .replace(/process\.env(?:\[[^\]\r\n]+\]|\.[A-Za-z_$][\w$]*)/gu, "''")
    .replace(/ARXIC_INPUT_[A-Z0-9_]+/gu, "''");
}

async function filesUnder(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? filesUnder(path) : Promise.resolve([path]);
    }),
  );
  return nested.flat().sort();
}
