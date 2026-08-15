import { rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDirectory = dirname(dirname(fileURLToPath(import.meta.url)));

await Promise.all([
  rm(join(packageDirectory, 'rulepacks'), { recursive: true, force: true }),
  rm(join(packageDirectory, 'dist', 'standalone-runtime.ts'), { force: true }),
]);
