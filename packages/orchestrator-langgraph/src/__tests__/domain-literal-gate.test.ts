import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * ADR-008 Decision 3 machine gate (DG-08 #252): pipeline code MUST NOT
 * contain domain literals that decide candidate creation, state names,
 * personas, or promotion behavior. This test greps the pipeline source
 * (orchestrator + CLI + worker, non-test) for authentication-domain literals
 * so the ADR rule is enforced in CI, not by memory. The domain pack is exempt:
 * it IS the domain knowledge, demoted to an optional seeder.
 *
 * DG-08 remediation round: the vocabulary is EXTENDED (signin/signup/register/
 * registration/reset per review) as word-SHAPE patterns — a bare substring
 * match would false-positive on the frozen fixture API (`provider.reset(`,
 * `ARXIC_FIXTURE_RESET_FAILED`, "registered fixture provider"), which is
 * fixture machinery that decides nothing about candidates. The control is a
 * genuine RED-PROOF: the scanner is proven to flag planted literals in a
 * scanned tree.
 */

const packageRoot = fileURLToPath(new URL('../..', import.meta.url));
const repoRoot = resolve(packageRoot, '../..');

const DOMAIN_PATTERNS: ReadonlyArray<Readonly<{ word: string; pattern: RegExp }>> = [
  { word: 'authenticat', pattern: /authenticat/iu },
  { word: 'login', pattern: /login/iu },
  { word: 'logout', pattern: /logout/iu },
  { word: 'signin', pattern: /sign[-_]?in/iu },
  { word: 'signup', pattern: /sign[-_]?up/iu },
  // Domain NOUN usages (routes, flows, personas). The bare participle
  // "registered fixture provider" is not a domain literal and must not match.
  {
    word: 'register',
    pattern: /registration|registered-user|\bregister\b|\bregistering\b/iu,
  },
  { word: 'forgot', pattern: /forgot/iu },
  { word: 'totp', pattern: /totp/iu },
  { word: 'mfa', pattern: /\bmfa\b/iu },
  { word: 'reset', pattern: /\breset\b|password-reset|reset-requested/iu },
];

// The frozen fixture API and its diagnostics (fixture machinery, never a
// candidate-deciding literal): stripped from a line before matching.
const ALLOWED_FIXTURE_TOKENS = [
  'resetAndSeedFixtures',
  '.reset(',
  'ARXIC_FIXTURE_RESET_FAILED',
  'ARXIC-FIXTURE-RESET-FAILED',
  'Fixture reset failed',
];

async function* tsFiles(directory: string): AsyncGenerator<string> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '__tests__' || entry.name === 'dist') {
      continue;
    }
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* tsFiles(path);
    // Colocated *.test.ts files are tests, not pipeline source.
    else if (entry.isFile() && /\.ts$/u.test(entry.name) && !/\.test\.ts$/u.test(entry.name))
      yield path;
  }
}

function isCommentLine(line: string): boolean {
  const stripped = line.trim();
  return stripped.startsWith('//') || stripped.startsWith('*') || stripped.startsWith('/*');
}

function domainLiteralViolations(path: string, lines: readonly string[]): string[] {
  const violations: string[] = [];
  lines.forEach((line, index) => {
    if (isCommentLine(line)) return;
    const withoutFixtureTokens = ALLOWED_FIXTURE_TOKENS.reduce(
      (candidate, token) => candidate.split(token).join(''),
      line,
    );
    for (const { word, pattern } of DOMAIN_PATTERNS) {
      if (pattern.test(withoutFixtureTokens)) {
        violations.push(`${path}:${index + 1}: /${word}/ -> ${line.trim().slice(0, 120)}`);
      }
    }
  });
  return violations;
}

async function assertNoDomainLiterals(sourceRoot: string): Promise<string[]> {
  const violations: string[] = [];
  for await (const file of tsFiles(sourceRoot)) {
    violations.push(...domainLiteralViolations(file, (await readFile(file, 'utf8')).split('\n')));
  }
  return violations;
}

const temporaryDirectories: string[] = [];

describe('ADR-008 Decision 3 domain-literal gate (DG-08)', () => {
  afterAll(async () => {
    await Promise.all(
      temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  it('RED-PROOF: the scanner flags planted domain literals in a scanned tree', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'arxic-orch-gate-red-'));
    temporaryDirectories.push(directory);
    await writeFile(
      join(directory, 'planted.ts'),
      [
        "export const a = '/signin';",
        "export const b = '/signup';",
        "export const c = '/register';",
        "export const d = '/reset';",
        "export const persona = 'registered-user';",
        'export const fine = resolve(base, resetAndSeedFixtures.name);',
        'export const ok = provider.reset() !== undefined;',
      ].join('\n'),
    );
    const violations: string[] = [];
    for await (const file of tsFiles(directory)) {
      violations.push(...domainLiteralViolations(file, (await readFile(file, 'utf8')).split('\n')));
    }
    // Every planted domain literal reds (one violation per matched word);
    // the fixture-API tokens on the last two lines do NOT.
    expect(violations).toEqual(
      expect.arrayContaining([
        expect.stringContaining('/signin/'),
        expect.stringContaining('/signup/'),
        expect.stringContaining('/register/'),
        expect.stringContaining('/reset/'),
      ]),
    );
    expect(violations).toHaveLength(5); // + registered-user persona match
    expect(violations.every((line) => !line.includes('resetAndSeedFixtures.name'))).toBe(true);
    expect(violations.every((line) => !line.includes('provider.reset()'))).toBe(true);
  });

  it('orchestrator pipeline source carries no authentication domain literals', async () => {
    await expect(stat(join(packageRoot, 'src'))).resolves.toBeTruthy();
    const violations = await assertNoDomainLiterals(join(packageRoot, 'src'));
    expect(violations).toEqual([]);
  });

  it('the demoted auth pack seeder itself is NOT pipeline code (control: the gate would catch the old CLI)', async () => {
    // Control that the scanner works on REAL source: the auth-domain-pack
    // (the one place domain knowledge is allowed to live) WOULD trip it. We
    // scan one known file rather than asserting the whole pack, to keep the
    // control robust against harmless refactors.
    const candidates = await readFile(
      join(repoRoot, 'packages/auth-domain-pack/src/candidates.ts'),
      'utf8',
    );
    expect(/authenticat/iu.test(candidates)).toBe(true);
  });
});
