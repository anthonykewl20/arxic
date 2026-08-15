import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
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
  buildCli = () =>
    execFileAsync('pnpm', ['--filter', './apps/cli', 'build'], {
      cwd: root,
      ...packageManagerSpawnOptions(),
    }),
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
    const malformedConfig = join(temporaryDirectory, 'malformed-arxic.yaml');
    await writeFile(malformedConfig, 'version: [not valid YAML\n');
    await assertPackedConfigFailure(execute, malformedConfig);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function listTarballContents(tarball) {
  const { stdout } = await execFileAsync('tar', ['-tzf', tarball]);
  return stdout.split('\n').filter(Boolean);
}

function assertTarballContents(entries) {
  const normalizedEntries = entries.map((entry) => entry.split('\\').join('/'));
  for (const required of ['package/dist/cli.js', 'package/LICENSE', 'package/NOTICE']) {
    if (!normalizedEntries.includes(required)) {
      throw new Error(`tarball is missing required entry ${required}`);
    }
  }
  if (normalizedEntries.some((entry) => entry.startsWith('package/src/'))) {
    throw new Error('tarball must not contain source files');
  }
  if (normalizedEntries.some((entry) => entry.startsWith('package/node_modules/'))) {
    throw new Error('tarball must not contain node_modules');
  }
}

async function packCli({ root, tarballDirectory }) {
  await execFileAsync('npm', ['pack', '--pack-destination', tarballDirectory], {
    cwd: join(root, 'apps/cli'),
    ...packageManagerSpawnOptions(),
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
    ...packageManagerSpawnOptions(),
  });
}

// These package-manager commands and arguments are fixed literals owned by this
// script. Windows needs a shell to invoke its pnpm.cmd/npm.cmd shims.
export function packageManagerSpawnOptions(platform = process.platform) {
  return platform === 'win32' ? { shell: true } : {};
}

async function runPackedCli({ installDirectory, argument }) {
  const packageDirectory = join(installDirectory, 'node_modules', 'arxic');
  const packageJson = JSON.parse(await readFile(join(packageDirectory, 'package.json'), 'utf8'));
  const bin = packageJson.bin?.arxic;
  if (typeof bin !== 'string' || bin.length === 0) {
    throw new Error('installed arxic package must declare a string bin.arxic entry');
  }
  const { stdout } = await execFileAsync('node', [join(packageDirectory, bin), ...argument], {
    cwd: installDirectory,
  });
  return stdout;
}

async function assertPackedConfigFailure(execute, configPath) {
  try {
    await execute(['run', '--config', configPath]);
  } catch (error) {
    const result = asProcessFailure(error);
    if (!result || result.exitCode === 0) {
      throw new Error('packed arxic malformed-config run did not report a non-zero process exit');
    }
    const output = `${result.stdout}\n${result.stderr}`;
    if (
      /(?:^|\n)\s*(?:Error:|at\s)|\bERR_MODULE_NOT_FOUND\b|\bCannot find module\b|\bFailed to load .*schema\b/u.test(
        output,
      )
    ) {
      throw new Error(`packed arxic malformed-config run crashed: ${output.trim()}`);
    }
    if (!/(?:ARXIC-CONFIG-[A-Z-]+|status=blocked)/u.test(output)) {
      throw new Error(
        `packed arxic malformed-config run lacked a structured diagnostic: ${output.trim()}`,
      );
    }
    return;
  }
  throw new Error('packed arxic malformed-config run unexpectedly succeeded');
}

function asProcessFailure(error) {
  if (typeof error !== 'object' || error === null) return undefined;
  const candidate = error;
  return typeof candidate.code === 'number'
    ? {
        exitCode: candidate.code,
        stdout: typeof candidate.stdout === 'string' ? candidate.stdout : '',
        stderr: typeof candidate.stderr === 'string' ? candidate.stderr : '',
      }
    : undefined;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  assertTarballSmoke().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
