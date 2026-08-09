import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import type { ArtifactRef } from '@arxic/contracts';
import {
  classifyTraceCarrierPng,
  discardCapturedArtifact,
  isSensitiveArtifactFilename,
  readTraceCarrierFreePng,
  sanitizeCapturedPlaywrightTrace,
  type TraceSanitizationFailure,
} from '@arxic/playwright-trace-sanitizer';

export type ArtifactHashFailure = {
  artifact: ArtifactRef;
  reason: 'missing' | 'mismatch';
};

export class TraceSanitizationError extends Error {
  readonly failure: TraceSanitizationFailure;

  constructor(failure: TraceSanitizationFailure) {
    super(`Trace sanitization failed (${failure.code})`);
    this.name = 'TraceSanitizationError';
    this.failure = failure;
  }
}

export async function captureRunArtifacts(
  testDirectory: string,
  artifactsDirectory: string,
  run: number,
  options: {
    forbiddenSubstrings?: readonly string[];
    screenshotCheckpoints?: readonly string[];
  } = {},
): Promise<ArtifactRef[]> {
  const destination = join(artifactsDirectory, 'verification', `run-${run}`);
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  const roots = [join(testDirectory, 'artifacts'), join(testDirectory, 'test-results')];
  const files = (await Promise.all(roots.map((root) => filesUnder(root)))).flat();
  const refs: ArtifactRef[] = [];
  const sequences = { screenshot: 0, trace: 0 };
  for (const source of files.filter((path) => /\.(?:png|zip)$/u.test(path)).sort()) {
    const kind = source.endsWith('.png') ? 'screenshot' : 'trace';
    if (isSensitiveArtifactFilename(basename(source), options.forbiddenSubstrings)) {
      await rejectCapturedSource(source, 'Artifact source filename rejected by retention policy');
    }
    const screenshot = kind === 'screenshot' ? await readTraceCarrierFreePng(source) : undefined;
    if (screenshot && !screenshot.ok) {
      await rejectCapturedSource(
        source,
        'Screenshot source is not a strict trace-carrier-free PNG',
      );
    }
    sequences[kind] += 1;
    const checkpoint =
      kind === 'screenshot' ? options.screenshotCheckpoints?.[sequences.screenshot - 1] : undefined;
    if (
      checkpoint !== undefined &&
      (!/^[a-z][a-z0-9-]{0,63}$/u.test(checkpoint) ||
        isSensitiveArtifactFilename(checkpoint, options.forbiddenSubstrings))
    ) {
      await rm(source, { force: true });
      throw new Error('Screenshot checkpoint name rejected by retention policy');
    }
    const target = join(
      destination,
      kind === 'screenshot'
        ? `screenshot-${checkpoint ?? String(sequences.screenshot).padStart(3, '0')}.png`
        : `trace-${String(sequences.trace).padStart(3, '0')}.zip`,
    );
    if (kind === 'screenshot') {
      await writeFile(target, screenshot!.ok ? screenshot!.bytes : Buffer.alloc(0));
      refs.push(await artifactRef(kind, target));
      continue;
    }
    const provenancePath = `${target}.sanitization.json`;
    const sanitized = await sanitizeCapturedPlaywrightTrace({
      sourcePath: source,
      outputPath: target,
      provenancePath,
      forbiddenSubstrings: options.forbiddenSubstrings,
    });
    if (!sanitized.ok) throw new TraceSanitizationError(sanitized);
    refs.push(
      await artifactRef('trace', target),
      await artifactRef('trace-sanitization-report', provenancePath),
    );
  }
  return refs;
}

async function rejectCapturedSource(source: string, message: string): Promise<never> {
  const discarded = await discardCapturedArtifact(source);
  if (!discarded.ok) {
    throw new Error(`${message}; source cleanup ${discarded.sourceDisposition}`);
  }
  throw new Error(message);
}

export async function verifyArtifactHashes(
  artifacts: ArtifactRef[],
  baseDirectory?: string,
): Promise<ArtifactHashFailure[]> {
  const failures: ArtifactHashFailure[] = [];
  for (const artifact of artifacts) {
    const path = baseDirectory ? resolveArtifactPath(baseDirectory, artifact.path) : artifact.path;
    try {
      const digest = createHash('sha256')
        .update(await readFile(path))
        .digest('hex');
      if (digest !== artifact.sha256) failures.push({ artifact, reason: 'mismatch' });
    } catch {
      failures.push({ artifact, reason: 'missing' });
    }
  }
  return failures;
}

export async function artifactRef(kind: string, path: string): Promise<ArtifactRef> {
  const bytes = await readFile(path);
  return { kind, path, sha256: createHash('sha256').update(bytes).digest('hex') };
}

export function resolveArtifactPath(baseDirectory: string, path: string): string {
  const base = resolve(baseDirectory);
  const candidate = resolve(base, path);
  if (candidate !== base && !candidate.startsWith(`${base}/`)) {
    throw new Error(`Artifact path escapes the staged directory: ${path}`);
  }
  return candidate;
}

async function filesUnder(root: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    const nested = await Promise.all(
      entries.map((entry) => {
        const path = join(root, entry.name);
        return entry.isDirectory() ? filesUnder(path) : Promise.resolve([path]);
      }),
    );
    return nested.flat();
  } catch {
    return [];
  }
}
