import { execFileSync } from 'node:child_process';
import { cp, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const destination = join(packageDirectory, 'rulepacks');

await rm(destination, { recursive: true, force: true });
await cp(join(packageDirectory, '..', '..', 'rulepacks'), destination, { recursive: true });
await cp(
  join(
    packageDirectory,
    '..',
    '..',
    'packages',
    'playwright-screenshot-privacy',
    'src',
    'standalone-runtime.ts',
  ),
  join(packageDirectory, 'dist', 'standalone-runtime.ts'),
);

// Include the actual build workspace graph, including bundled adapters. The
// assembler canonicalizes and redacts this CycloneDX payload before retention.
execFileSync(
  'pnpm',
  ['sbom', '--sbom-format', 'cyclonedx', '--out', join(packageDirectory, 'dist', 'sbom.cdx.json')],
  {
    cwd: join(packageDirectory, '..', '..'),
    shell: process.platform === 'win32',
    stdio: 'pipe',
  },
);
