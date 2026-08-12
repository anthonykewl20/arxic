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
