import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const workspaceDirectories = ['packages', 'apps'].flatMap((workspaceRoot) =>
  readdirSync(join(repoRoot, workspaceRoot), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(repoRoot, workspaceRoot, entry.name)),
);

describe('workspace tooling contracts', () => {
  it('provides a per-workspace TypeScript typecheck contract', () => {
    expect(workspaceDirectories).toHaveLength(20);

    for (const workspaceDirectory of workspaceDirectories) {
      const packageJsonPath = join(workspaceDirectory, 'package.json');
      expect(existsSync(packageJsonPath)).toBe(true);
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
        scripts?: { typecheck?: unknown };
      };
      expect(typeof packageJson.scripts?.typecheck).toBe('string');
      expect(packageJson.scripts?.typecheck).toContain('tsc');

      const tsconfigPath = join(workspaceDirectory, 'tsconfig.json');
      expect(existsSync(tsconfigPath)).toBe(true);
      const tsconfig = JSON.parse(readFileSync(tsconfigPath, 'utf8')) as {
        extends?: unknown;
        include?: unknown;
      };
      expect(typeof tsconfig.extends).toBe('string');
      expect(resolve(workspaceDirectory, tsconfig.extends as string)).toBe(
        join(repoRoot, 'tsconfig.base.json'),
      );
      expect(Array.isArray(tsconfig.include)).toBe(true);
      expect(tsconfig.include).toContain('src');
    }
  });

  it('provides the aggregate package typecheck contract', () => {
    const packageJson = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {
      scripts?: { 'typecheck:packages'?: unknown };
    };
    expect(packageJson.scripts?.['typecheck:packages']).toBe('pnpm -r typecheck');
  });
});
