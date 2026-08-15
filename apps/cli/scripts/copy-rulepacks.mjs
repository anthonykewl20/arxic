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
