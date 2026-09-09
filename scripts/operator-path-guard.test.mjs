import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * An absolute `/home/<user>/…` literal in tracked source publishes the
 * operator's OS username and directory layout in a public repository, and it
 * breaks for every other machine — the #402 screenshot census (finding F2)
 * found four such literals, including one pointing at the live workbench
 * SQLite file. Runtime roots must come from an environment override,
 * `homedir()`, or a path resolved from the module's own location.
 *
 * `/home/private/` is the one allowed literal: the trace sanitizer uses it as a
 * synthetic secret to PROVE it redacts such paths, so it has to stay literal
 * for those assertions to mean anything.
 *
 * Scope is source only. Retained evidence and docs also carry the path; that is
 * already-published history and its disposition is an owner decision, recorded
 * in `docs/evidence/WEB-402-CENSUS-PRESCREEN/summary.md`, not silently rewritten
 * here.
 */
const ALLOWED_LITERALS = ['/home/private/'];
const SCANNED = /^(apps|packages|scripts)\/.*\.(ts|tsx|mts|mjs|js|cjs)$/u;
const HOME_LITERAL = /\/home\/[A-Za-z0-9._-]+\//gu;

const tracked = execFileSync('git', ['ls-files', '-z'], {
  cwd: root,
  encoding: 'utf8',
  maxBuffer: 32 * 1024 * 1024,
})
  .split('\0')
  .filter((file) => SCANNED.test(file));

describe('no operator home path in tracked source (refs #402)', () => {
  it('scans a non-empty source set, so a broken glob cannot pass vacuously', () => {
    expect(tracked.length).toBeGreaterThan(100);
  });

  it('still scans the file that proves redaction of such paths', () => {
    expect(tracked).toContain('packages/playwright-trace-sanitizer/src/trace-sanitizer.test.ts');
  });

  it('finds no absolute /home/<user>/ literal outside the redaction fixture', () => {
    // Report file:line only — never the matched text, which is the leak itself.
    const offenders = [];
    for (const file of tracked) {
      const text = readFileSync(join(root, file), 'utf8');
      for (const match of text.matchAll(HOME_LITERAL)) {
        if (ALLOWED_LITERALS.includes(match[0])) continue;
        offenders.push(`${file}:${text.slice(0, match.index).split('\n').length}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
