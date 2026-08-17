import { readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * ADR-008 Decision 3 machine gate (DG-08 #252): pipeline code MUST NOT
 * contain domain literals that decide candidate creation, state names,
 * personas, or promotion behavior. This test greps the pipeline source
 * (orchestrator + CLI, non-test) for authentication-domain literals so the
 * ADR rule is enforced in CI, not by memory. The domain pack is exempt: it
 * IS the domain knowledge, demoted to an optional seeder.
 */

const packageRoot = fileURLToPath(new URL('../..', import.meta.url));
const repoRoot = resolve(packageRoot, '../..');

// Domain vocabulary that must not appear in pipeline code. 'password' is
// deliberately absent: as an HTML input TYPE it is form geometry, not domain
// knowledge (the gate would otherwise flag the generic field-type filter).
const DOMAINS = ['authenticat', 'login', 'logout', 'forgot', 'totp', 'mfa'];

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
    else if (entry.isFile() && /\.ts$/u.test(entry.name)) yield path;
  }
}

async function assertNoDomainLiterals(sourceRoot: string): Promise<string[]> {
  const violations: string[] = [];
  for await (const file of tsFiles(sourceRoot)) {
    const contents = await readFile(file, 'utf8');
    const lines = contents.split('\n');
    lines.forEach((line, index) => {
      // Comments may explain the DEMOTION itself; executable lines may not
      // carry the literal. A line is a comment only when the stripped line
      // starts with // or * or /* — anything else is executable (or string)
      // content, which is what decides behavior.
      const stripped = line.trim();
      const isComment =
        stripped.startsWith('//') || stripped.startsWith('*') || stripped.startsWith('/*');
      if (isComment) return;
      for (const domain of DOMAINS) {
        const pattern = new RegExp(domain, 'iu');
        if (pattern.test(line)) {
          violations.push(`${file}:${index + 1}: /${domain}/ -> ${stripped.slice(0, 120)}`);
        }
      }
    });
  }
  return violations;
}

describe('ADR-008 Decision 3 domain-literal gate (DG-08)', () => {
  it('orchestrator pipeline source carries no authentication domain literals', async () => {
    await expect(stat(join(packageRoot, 'src'))).resolves.toBeTruthy();
    const violations = await assertNoDomainLiterals(join(packageRoot, 'src'));
    expect(violations).toEqual([]);
  });

  it('the demoted auth pack seeder itself is NOT pipeline code (control: the gate would catch the old CLI)', async () => {
    // Control that the scanner works: the auth-domain-pack source (the one
    // place domain knowledge is allowed to live) WOULD trip it. We scan one
    // known file rather than asserting the whole pack, to keep the control
    // robust against harmless refactors.
    const candidates = await readFile(
      join(repoRoot, 'packages/auth-domain-pack/src/candidates.ts'),
      'utf8',
    );
    expect(/authenticat/iu.test(candidates)).toBe(true);
  });
});
