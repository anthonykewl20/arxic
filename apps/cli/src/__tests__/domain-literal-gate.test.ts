import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * ADR-008 Decision 3 machine gate (DG-08 #252) — CLI half. The CLI is
 * pipeline code: after DG-08 it must not replace model output with canned
 * domain candidates, fabricate domain surfaces, or hardcode domain routes in
 * exploration. Greps apps/cli/src (non-test) for domain literals.
 */

const cliRoot = fileURLToPath(new URL('..', import.meta.url));

// 'password' is absent: as an HTML input TYPE it is form geometry, not a
// domain literal deciding candidate creation (ADR-008 Decision 3).
const DOMAINS = ['authenticat', 'login', 'logout', 'forgot', 'totp', 'mfa'];

async function* tsFiles(directory: string): AsyncGenerator<string> {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '__tests__' || entry.name === 'dist') {
      continue;
    }
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* tsFiles(path);
    else if (entry.isFile() && /\.ts$/u.test(entry.name)) yield path;
  }
}

describe('ADR-008 Decision 3 domain-literal gate — apps/cli (DG-08)', () => {
  it('CLI pipeline source carries no authentication domain literals', async () => {
    const violations: string[] = [];
    for await (const file of tsFiles(cliRoot)) {
      const lines = (await readFile(file, 'utf8')).split('\n');
      lines.forEach((line, index) => {
        const stripped = line.trim();
        const isComment =
          stripped.startsWith('//') || stripped.startsWith('*') || stripped.startsWith('/*');
        if (isComment) return;
        for (const domain of DOMAINS) {
          if (new RegExp(domain, 'iu').test(line)) {
            violations.push(`${file}:${index + 1}: /${domain}/ -> ${stripped.slice(0, 120)}`);
          }
        }
      });
    }
    expect(violations).toEqual([]);
  });

  it('the CLI no longer references the canned-candidate merge or fabricated surfaces (by symbol)', async () => {
    const executor = await readFile(resolve(cliRoot, 'local-executor.ts'), 'utf8');
    expect(executor.includes('authDomainCandidates')).toBe(false);
    expect(executor.includes('authSurfaceFromEvidence')).toBe(false);
    expect(executor.includes('stage4Infer')).toBe(false);
    expect(executor.includes('authCandidates')).toBe(false);
  });
});
