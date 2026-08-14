import { createHash } from 'node:crypto';
import { basename, extname, resolve, sep } from 'node:path';
import { screenshotPrivacyRuntimeSource } from './runtime-source';
import { readBoundedRegularFile, walkStableWorkspace } from './safe-filesystem';
import { ScreenshotPrivacyError } from './standalone-runtime';

export type TrustedScreenshotCaptureBinding = Readonly<{
  spec: Readonly<{ path: string; sha256: string }>;
  runtime: Readonly<{ path: string; sha256: string }>;
  sources: readonly Readonly<{ path: string; sha256: string }>[];
  allowedSourcePaths: readonly string[];
  expectedScreenshots: readonly string[];
}>;

export async function establishTrustedScreenshotCaptureBinding(input: {
  testDirectory: string;
  specPath: string;
  runtimePath: string;
  expectedSpec: string;
  allowedSourcePaths: readonly string[];
  trustedSourceContents: Readonly<Record<string, string>>;
  expectedScreenshots: readonly string[];
}): Promise<TrustedScreenshotCaptureBinding> {
  const expectedScreenshots = exactRelativePaths(
    input.expectedScreenshots,
    'expected screenshot',
    '.png',
  );
  if (expectedScreenshots.length > 32) {
    invalid('expected screenshot inventory exceeds its bound');
  }
  const allowedSourcePaths = exactRelativePaths(input.allowedSourcePaths, 'allowed source');
  const specPath = safeRelativePath(input.specPath, 'spec', '.ts');
  const runtimePath = safeRelativePath(input.runtimePath, 'runtime', '.ts');
  if (!allowedSourcePaths.includes(specPath) || !allowedSourcePaths.includes(runtimePath)) {
    invalid('spec and runtime must be in the exact allowed source inventory');
  }
  const trustedSourcePaths = exactRelativePaths(
    Object.keys(input.trustedSourceContents),
    'trusted source',
  ).sort();
  if (!sameStrings(trustedSourcePaths, [...allowedSourcePaths].sort())) {
    invalid('trusted source bytes do not cover the exact allowed source inventory');
  }
  if (Buffer.byteLength(input.expectedSpec) > 1024 * 1024)
    invalid('expected spec exceeds its bound');
  assertExpectedSpecCaptureCalls(input.expectedSpec, expectedScreenshots);

  const inventory = await runnableSourceInventory(input.testDirectory);
  if (!sameStrings(inventory, [...allowedSourcePaths].sort())) {
    invalid(`runnable source inventory differs: ${inventory.join(', ')}`);
  }
  const sourceEntries = await Promise.all(
    trustedSourcePaths.map(async (path) => {
      const expected = input.trustedSourceContents[path];
      if (typeof expected !== 'string' || Buffer.byteLength(expected) > 1024 * 1024) {
        invalid(`trusted source bytes are unavailable or exceed their bound: ${path}`);
      }
      const actual = await boundedSource(input.testDirectory, path);
      if (actual !== expected) invalid(`runnable source bytes differ from trusted output: ${path}`);
      return Object.freeze({ path, sha256: sha256(actual) });
    }),
  );
  const actualSpec = input.trustedSourceContents[specPath]!;
  const actualRuntime = input.trustedSourceContents[runtimePath]!;
  const expectedRuntime = screenshotPrivacyRuntimeSource();
  if (actualSpec !== input.expectedSpec) invalid('compiled spec bytes differ from trusted output');
  if (actualRuntime !== expectedRuntime)
    invalid('capture runtime bytes differ from trusted output');
  for (const path of inventory) {
    if (path === runtimePath) continue;
    const source = path === specPath ? actualSpec : await boundedSource(input.testDirectory, path);
    if (/\.screenshot\s*\(/u.test(source) || /\[['"]screenshot['"]\]\s*\(/u.test(source)) {
      invalid(`raw screenshot API appears outside the trusted runtime: ${path}`);
    }
  }
  return Object.freeze({
    spec: Object.freeze({ path: specPath, sha256: sha256(actualSpec) }),
    runtime: Object.freeze({ path: runtimePath, sha256: sha256(actualRuntime) }),
    sources: Object.freeze(sourceEntries),
    allowedSourcePaths: Object.freeze([...allowedSourcePaths]),
    expectedScreenshots: Object.freeze([...expectedScreenshots]),
  });
}

export async function assertTrustedScreenshotCaptureBinding(
  testDirectory: string,
  binding: TrustedScreenshotCaptureBinding,
): Promise<void> {
  const inventory = await runnableSourceInventory(testDirectory);
  if (!sameStrings(inventory, [...binding.allowedSourcePaths].sort())) {
    invalid('runnable source inventory drifted after binding');
  }
  if (
    !sameStrings(
      binding.sources.map(({ path }) => path).sort(),
      [...binding.allowedSourcePaths].sort(),
    )
  ) {
    invalid('bound source digest inventory is incomplete');
  }
  const sourceBytes = await Promise.all(
    binding.sources.map(async ({ path, sha256: expected }) => {
      const bytes = await boundedSource(testDirectory, path);
      if (sha256(bytes) !== expected) invalid(`runnable source drifted after binding: ${path}`);
      return { path, bytes };
    }),
  );
  const spec = sourceBytes.find(({ path }) => path === binding.spec.path)?.bytes;
  const runtime = sourceBytes.find(({ path }) => path === binding.runtime.path)?.bytes;
  if (
    !spec ||
    !runtime ||
    sha256(spec) !== binding.spec.sha256 ||
    sha256(runtime) !== binding.runtime.sha256
  ) {
    invalid('compiled spec or capture runtime binding is incomplete');
  }
  if (runtime !== screenshotPrivacyRuntimeSource())
    invalid('capture runtime no longer matches trusted bytes');
}

export function expectedScreenshotPathsFromTrustedSpec(spec: string): readonly string[] {
  if (/\.screenshot\s*\(/u.test(spec) || /\[['"]screenshot['"]\]\s*\(/u.test(spec)) {
    invalid('trusted spec contains a raw screenshot API');
  }
  const captured = [
    ...spec.matchAll(/\bcapturePolicyScreenshot\s*\(\s*page\s*,\s*(['"])(.*?)\1\s*\)/gu),
  ]
    .map((match) => match[2])
    .filter((path): path is string => path !== undefined);
  return Object.freeze(exactRelativePaths(captured, 'expected screenshot', '.png'));
}

/**
 * Maps required workflow checkpoints to the trusted pre-capture source inventory.
 * Filename text is used only as the compiler's deterministic state mapping; it is
 * never interpreted as evidence that screenshot pixels are private or sensitive.
 */
export function missingScreenshotCheckpointsInBinding(
  binding: TrustedScreenshotCaptureBinding,
  checkpoints: readonly string[],
): readonly string[] {
  if (!Array.isArray(checkpoints) || checkpoints.length > 32) {
    invalid('screenshot checkpoint inventory exceeds its bound');
  }
  const sourceNames = exactRelativePaths(
    binding.expectedScreenshots,
    'expected screenshot',
    '.png',
  ).map((path) => basename(path, '.png'));
  const missing = checkpoints.filter((checkpoint) => {
    if (typeof checkpoint !== 'string' || checkpoint.length < 1 || checkpoint.length > 200) {
      invalid('screenshot checkpoint is malformed');
    }
    const normalized = checkpoint.replace(/[^A-Za-z0-9.-]+/gu, '-');
    if (!normalized) invalid('screenshot checkpoint is malformed');
    return !sourceNames.some((name) => name === normalized || name.endsWith(`-${normalized}`));
  });
  return Object.freeze(missing);
}

const sourceExtensions = new Set(['.ts', '.js', '.mts', '.cts', '.mjs', '.cjs']);
const ignoredDirectories = new Set(['node_modules', 'artifacts', 'test-results', '.git']);

async function runnableSourceInventory(directory: string): Promise<string[]> {
  const base = resolve(directory);
  const found: string[] = [];
  await walkStableWorkspace(base, {
    allowMissing: false,
    maximumDepth: 16,
    maximumEntriesPerDirectory: 512,
    maximumTotalEntries: 4096,
    shouldDescend: (_path, name) => !ignoredDirectories.has(name),
    onFailure: invalid,
    onEntry: (entry) => {
      if (entry.kind === 'symbolic-link') {
        invalid('source inventory contains a symbolic link');
      }
      if (sourceExtensions.has(extname(entry.name))) {
        found.push(
          entry.absolutePath
            .slice(base.length + 1)
            .split(sep)
            .join('/'),
        );
      }
      if (found.length > 256) invalid('runnable source inventory exceeds its bound');
    },
  });
  return found.sort();
}

async function boundedSource(directory: string, path: string): Promise<string> {
  const resolved = safeResolve(directory, path);
  const bytes = await readBoundedRegularFile(resolved, {
    minimumBytes: 0,
    maximumBytes: 1024 * 1024,
    onFailure: invalid,
  });
  return bytes.toString('utf8');
}

function assertExpectedSpecCaptureCalls(spec: string, expected: readonly string[]): void {
  const captured = [...expectedScreenshotPathsFromTrustedSpec(spec)].sort();
  if (!sameStrings(captured, [...expected].sort())) {
    invalid('trusted spec capture calls differ from the expected output inventory');
  }
}

function exactRelativePaths(
  input: readonly string[],
  subject: string,
  extension?: string,
): string[] {
  if (!Array.isArray(input)) invalid(`${subject} inventory must be an array`);
  const paths = input.map((path) => safeRelativePath(path, subject, extension));
  if (new Set(paths).size !== paths.length) invalid(`${subject} inventory contains duplicates`);
  return paths;
}

function safeRelativePath(path: string, subject: string, extension?: string): string {
  if (
    typeof path !== 'string' ||
    path.length < 1 ||
    path.length > 300 ||
    path.includes('\\') ||
    path.startsWith('/') ||
    path.split('/').some((part) => !part || part === '.' || part === '..') ||
    (extension && !path.endsWith(extension))
  ) {
    invalid(`${subject} path is unsafe: ${String(path)}`);
  }
  return path;
}

function safeResolve(directory: string, path: string): string {
  const base = resolve(directory);
  const candidate = resolve(base, path);
  if (!candidate.startsWith(`${base}${sep}`)) invalid(`path escapes test directory: ${path}`);
  return candidate;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function invalid(message: string): never {
  throw new ScreenshotPrivacyError('ARXIC-SCREENSHOT-BINDING-INVALID', message);
}
