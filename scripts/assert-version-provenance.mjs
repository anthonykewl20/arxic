import { execFile } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep as pathSeparator } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const defaultRoot = dirname(scriptDirectory);

export const FIXTURE_MANIFESTS = [
  'test-fixtures/reference-auth-app/package.json',
  'test-fixtures/vulnerable-auth-app/package.json',
];

// Every apps/* and packages/* manifest must match VERSION. Only the explicit
// test-fixtures/* manifests are exempt: they remain private at 0.0.0. The
// fixture-mailpit and fixture-otplib packages are internal libraries, not test fixtures.

export async function assertVersionProvenance({
  root = defaultRoot,
  buildCli = () => execFileAsync('pnpm', ['--filter', './apps/cli', 'build'], { cwd: root }),
  cliVersion = async () => {
    const { stdout } = await execFileAsync('node', ['apps/cli/dist/cli.js', '--version'], {
      cwd: root,
    });
    return stdout.trim();
  },
} = {}) {
  const version = (await readFile(join(root, 'VERSION'), 'utf8')).trim();
  const manifests = await workspaceManifests(root);

  for (const path of manifests) {
    const manifest = JSON.parse(await readFile(path, 'utf8'));
    if (manifest.version !== version) {
      throw new Error(
        `${relative(root, path)} version ${String(manifest.version)} does not match VERSION ${version}`,
      );
    }
  }
  for (const fixturePath of FIXTURE_MANIFESTS) {
    const manifest = JSON.parse(await readFile(join(root, fixturePath), 'utf8'));
    if (manifest.version !== '0.0.0' || manifest.private !== true) {
      throw new Error(`${fixturePath} must remain private at version 0.0.0`);
    }
  }

  for (const path of await productionSourceFiles(root)) {
    const source = await readFile(path, 'utf8');
    if (emitsPlaceholderVersion(source)) {
      throw new Error(`${relative(root, path)} emits literal version 0.0.0`);
    }
  }

  await buildCli();
  const actual = (await cliVersion()).trim();
  if (actual !== version) {
    throw new Error(`built arxic --version output ${actual} does not match VERSION ${version}`);
  }
}

async function workspaceManifests(root) {
  const packageDirectories = await readdir(join(root, 'packages'), { withFileTypes: true });
  return [
    'package.json',
    'apps/cli/package.json',
    'apps/worker/package.json',
    ...packageDirectories
      .filter((entry) => entry.isDirectory())
      .map((entry) => `packages/${entry.name}/package.json`)
      .sort(),
  ].map((path) => join(root, path));
}

async function productionSourceFiles(root) {
  const sourceRoots = ['apps/cli/src', 'apps/worker/src'];
  const packageDirectories = await readdir(join(root, 'packages'), { withFileTypes: true });
  sourceRoots.push(
    ...packageDirectories
      .filter((entry) => entry.isDirectory())
      .map((entry) => `packages/${entry.name}/src`),
  );
  const files = await Promise.all(
    sourceRoots.map((sourceRoot) => filesUnder(join(root, sourceRoot))),
  );
  return files.flat().filter(isProductionSourceFile);
}

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? filesUnder(path) : Promise.resolve([path]);
    }),
  );
  return nested.flat().filter((path) => path.endsWith('.ts'));
}

function emitsPlaceholderVersion(source) {
  return /\b(?:generator|clientInfo|adapter|orchestratorVersion|verifierVersion|toolVersion|version)\s*[:=]\s*['"]0\.0\.0['"]/u.test(
    source,
  );
}

export function normalizePathForMatching(filePath, separator = pathSeparator) {
  return filePath.split(separator).join('/');
}

export function isProductionSourceFile(filePath, separator = pathSeparator) {
  const normalizedPath = normalizePathForMatching(filePath, separator);
  return !/(?:^|\/)__tests__(?:\/|$)|\.(?:test|spec)\.ts$/u.test(normalizedPath);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  assertVersionProvenance().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
