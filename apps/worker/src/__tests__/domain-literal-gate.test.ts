import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * ADR-008 Decision 3 machine gate (DG-08 remediation round, #252): the worker
 * is pipeline code. After the P1 remediation it must not replace model output
 * with canned domain candidates, fabricate domain surfaces, hardcode domain
 * routes in exploration, or wire the legacy evidence-metadata inference — the
 * same invariants the orchestrator and CLI gates enforce (word-shape patterns;
 * see the orchestrator gate for the vocabulary rationale). Scans
 * apps/worker/src non-test source and pins the canned-path symbols are gone.
 */

const workerRoot = fileURLToPath(new URL('../..', import.meta.url));

const DOMAIN_PATTERNS: ReadonlyArray<Readonly<{ word: string; pattern: RegExp }>> = [
  { word: 'authenticat', pattern: /authenticat/iu },
  { word: 'login', pattern: /login/iu },
  { word: 'logout', pattern: /logout/iu },
  { word: 'signin', pattern: /sign[-_]?in/iu },
  { word: 'signup', pattern: /sign[-_]?up/iu },
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

const FORBIDDEN_SYMBOLS = [
  'authDomainCandidates',
  'authSurfaceFromEvidence',
  'stage4Infer',
  'authCandidates',
  'runPlannedExploration',
];

async function* tsFiles(directory: string): AsyncGenerator<string> {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '__tests__' || entry.name === 'dist') {
      continue;
    }
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* tsFiles(path);
    // Colocated *.test.ts files (the worker mixes layouts) are tests, not
    // pipeline source.
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

const temporaryDirectories: string[] = [];

describe('ADR-008 Decision 3 domain-literal gate — apps/worker (DG-08)', () => {
  afterAll(async () => {
    await Promise.all(
      temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  it('RED-PROOF: the scanner flags planted domain literals in a scanned tree', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'arxic-worker-gate-red-'));
    temporaryDirectories.push(directory);
    await writeFile(
      join(directory, 'planted.ts'),
      "export const a = '/signin';\nexport const b = '/signup';\nexport const c = '/register';\nexport const d = '/reset';\nexport const fine = 'shopper';\n",
    );
    const violations: string[] = [];
    for await (const file of tsFiles(directory)) {
      violations.push(...domainLiteralViolations(file, (await readFile(file, 'utf8')).split('\n')));
    }
    expect(violations).toEqual(
      expect.arrayContaining([
        expect.stringContaining('/signin/'),
        expect.stringContaining('/signup/'),
        expect.stringContaining('/register/'),
        expect.stringContaining('/reset/'),
      ]),
    );
    expect(violations).toHaveLength(4);
  });

  it('worker pipeline source carries no authentication domain literals', async () => {
    const violations: string[] = [];
    for await (const file of tsFiles(join(workerRoot, 'src'))) {
      violations.push(...domainLiteralViolations(file, (await readFile(file, 'utf8')).split('\n')));
    }
    expect(violations).toEqual([]);
  });

  it('the worker no longer references the canned-candidate mirror or the legacy inference seam (by symbol)', async () => {
    const main = await readFile(join(workerRoot, 'src', 'main.ts'), 'utf8');
    for (const symbol of FORBIDDEN_SYMBOLS) {
      expect(main.includes(symbol), symbol).toBe(false);
    }
    // The demoted seeder participates through the same gates as model output.
    expect(main.includes('authDomainSeeder')).toBe(true);
  });
});
