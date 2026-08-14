import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const defaultRoot = dirname(scriptDirectory);

export async function assertTarballSmoke({
  root = defaultRoot,
  version = undefined,
  buildCli = () => execFileAsync('pnpm', ['--filter', './apps/cli', 'build'], { cwd: root }),
  pack,
  listTarball,
  install,
  runCli,
} = {}) {
  const expectedVersion = version ?? (await readFile(join(root, 'VERSION'), 'utf8')).trim();
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'arxic-tarball-smoke-'));
  const tarballDirectory = join(temporaryDirectory, 'tarball');
  const installDirectory = join(temporaryDirectory, 'install');
  try {
    await Promise.all([
      mkdir(tarballDirectory, { recursive: true }),
      mkdir(installDirectory, { recursive: true }),
    ]);
    await buildCli();
    const tarball =
      (await pack?.({ root, tarballDirectory })) ?? (await packCli({ root, tarballDirectory }));
    const entries = (await listTarball?.(tarball)) ?? (await listTarballContents(tarball));
    assertTarballContents(entries);
    await (install?.({ tarball, installDirectory }) ??
      installTarball({ tarball, installDirectory }));
    const execute = runCli ?? ((argument) => runPackedCli({ installDirectory, argument }));
    const actualVersion = (await execute(['--version'])).trim();
    if (actualVersion !== expectedVersion) {
      throw new Error(
        `packed arxic --version output ${actualVersion} does not match VERSION ${expectedVersion}`,
      );
    }
    await execute(['--help']);
    await execute(['run', '--help']);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function listTarballContents(tarball) {
  const { stdout } = await execFileAsync('tar', ['-tzf', tarball]);
  return stdout.split('\n').filter(Boolean);
}

function assertTarballContents(entries) {
  for (const required of ['package/dist/cli.js', 'package/LICENSE', 'package/NOTICE']) {
    if (!entries.includes(required)) {
      throw new Error(`tarball is missing required entry ${required}`);
    }
  }
  if (entries.some((entry) => entry.startsWith('package/src/'))) {
    throw new Error('tarball must not contain source files');
  }
  if (entries.some((entry) => entry.startsWith('package/node_modules/'))) {
    throw new Error('tarball must not contain node_modules');
  }
}

async function packCli({ root, tarballDirectory }) {
  await execFileAsync('npm', ['pack', '--pack-destination', tarballDirectory], {
    cwd: join(root, 'apps/cli'),
  });
  const tarballs = (await readdir(tarballDirectory))
    .filter((entry) => entry.endsWith('.tgz'))
    .sort();
  if (tarballs.length !== 1) throw new Error('npm pack did not produce exactly one tarball');
  return join(tarballDirectory, tarballs[0]);
}

async function installTarball({ tarball, installDirectory }) {
  await execFileAsync('npm', ['install', '--ignore-scripts', '--no-package-lock', tarball], {
    cwd: installDirectory,
  });
}

async function runPackedCli({ installDirectory, argument }) {
  const { stdout } = await execFileAsync('node', ['node_modules/.bin/arxic', ...argument], {
    cwd: installDirectory,
  });
  return stdout;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  assertTarballSmoke().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
