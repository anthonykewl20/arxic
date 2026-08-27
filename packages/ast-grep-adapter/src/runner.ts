import { execFile } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { Diagnostic } from '@arxic/contracts';
import { ARXIC_RULES_SG_ERROR, rulesDiagnostic } from './diagnostics';
import type { RuleMetadata } from './packs';

const exec = promisify(execFile);

export type RuleRange = {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
};
export type RuleMatch = RuleRange & {
  file: string;
  ruleId: string;
  packId: string;
  ruleVersion: string;
  category: RuleMetadata['category'];
  fields: Record<string, string | string[]>;
};
export type RunnerResult = { matches: RuleMatch[]; diagnostics: Diagnostic[] };

export function codepointCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export async function resolveSgBinary(override?: string): Promise<string> {
  if (override) return override;
  let current = resolve(import.meta.dirname);
  while (true) {
    const candidate = join(
      current,
      'node_modules',
      '@ast-grep',
      'cli',
      process.platform === 'win32' ? 'ast-grep.exe' : 'ast-grep',
    );
    let exists = true;
    try {
      await access(candidate);
    } catch {
      exists = false;
    }
    if (exists) return candidate;
    const parent = dirname(current);
    if (parent === current)
      return join(resolve(import.meta.dirname, '../../../..'), 'node_modules', '.bin', 'ast-grep');
    current = parent;
  }
}

type RawMatch = {
  file: string;
  ruleId: string;
  range: { start: { line: number; column: number }; end: { line: number; column: number } };
  metaVariables?: {
    single?: Record<string, { text: string }>;
    multi?: Record<string, Array<{ text: string }>>;
  };
};

export async function runRules(input: {
  binary?: string;
  cwd: string;
  rules: RuleMetadata[];
  paths: string[];
}): Promise<RunnerResult> {
  const matches: RuleMatch[] = [];
  const diagnostics: Diagnostic[] = [];
  const binary = await resolveSgBinary(input.binary ?? process.env.ARXIC_SG_BIN);
  for (const rule of input.rules) {
    if (input.paths.length === 0) continue;
    try {
      const { stdout } = await exec(
        binary,
        ['scan', '--rule', rule.file, '--json=stream', '--', ...input.paths],
        { cwd: input.cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
      );
      for (const line of stdout.split('\n').filter(Boolean)) {
        let raw: RawMatch;
        try {
          raw = JSON.parse(line) as RawMatch;
        } catch (error) {
          throw new Error(
            `invalid JSON stream line: ${error instanceof Error ? error.message : String(error)}`,
            { cause: error },
          );
        }
        if (rule.id === 'nextjs-server-action') {
          const source = await readFile(resolve(input.cwd, raw.file), 'utf8');
          if (!/^\s*['"]use server['"];?/u.test(source)) continue;
        }
        const fields: Record<string, string | string[]> = {};
        for (const [name, value] of Object.entries(raw.metaVariables?.single ?? {}))
          fields[name] = value.text;
        for (const [name, values] of Object.entries(raw.metaVariables?.multi ?? {}))
          fields[name] = values.map((value) => value.text);
        matches.push({
          file: raw.file.replaceAll('\\', '/'),
          ruleId: raw.ruleId,
          packId: rule.packId,
          ruleVersion: rule.semver,
          category: rule.category,
          fields,
          startLine: raw.range.start.line + 1,
          startColumn: raw.range.start.column,
          endLine: raw.range.end.line + 1,
          endColumn: raw.range.end.column,
        });
      }
    } catch (error) {
      diagnostics.push(
        rulesDiagnostic(
          ARXIC_RULES_SG_ERROR,
          rule.id,
          error instanceof Error ? error.message : String(error),
        ),
      );
    }
  }
  matches.sort(
    (a, b) =>
      codepointCompare(a.file, b.file) ||
      a.startLine - b.startLine ||
      a.startColumn - b.startColumn ||
      codepointCompare(a.ruleId, b.ruleId),
  );
  return { matches, diagnostics };
}
