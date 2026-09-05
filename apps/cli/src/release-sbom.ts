import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);

/** Packaged builds carry their build graph; source execution measures its workspace graph. */
export async function loadReleaseSbom(moduleUrl = import.meta.url): Promise<Buffer> {
  const directory = dirname(fileURLToPath(moduleUrl));
  if (directory.endsWith(`${process.platform === 'win32' ? '\\' : '/'}dist`)) {
    return readFile(join(directory, 'sbom.cdx.json'));
  }
  const temporary = await mkdtemp(join(tmpdir(), 'arxic-sbom-'));
  try {
    const output = join(temporary, 'sbom.cdx.json');
    await execute('pnpm', ['sbom', '--sbom-format', 'cyclonedx', '--out', output], {
      cwd: resolve(directory, '../../..'),
      timeout: 60_000,
      shell: process.platform === 'win32',
    });
    return await readFile(output);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
