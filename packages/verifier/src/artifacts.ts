import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import type { ArtifactRef } from '@arxic/contracts';

export type ArtifactHashFailure = {
  artifact: ArtifactRef;
  reason: 'missing' | 'mismatch';
};

export async function captureRunArtifacts(
  testDirectory: string,
  artifactsDirectory: string,
  run: number,
): Promise<ArtifactRef[]> {
  const destination = join(artifactsDirectory, 'verification', `run-${run}`);
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  const roots = [join(testDirectory, 'artifacts'), join(testDirectory, 'test-results')];
  const files = (await Promise.all(roots.map((root) => filesUnder(root)))).flat();
  const refs: ArtifactRef[] = [];
  let sequence = 0;
  for (const source of files.filter((path) => /\.(?:png|zip)$/u.test(path)).sort()) {
    sequence += 1;
    const kind = source.endsWith('.png') ? 'screenshot' : 'trace';
    const target = join(
      destination,
      `${String(sequence).padStart(3, '0')}-${kind}-${basename(source)}`,
    );
    await cp(source, target);
    refs.push(await artifactRef(kind, target));
  }
  return refs;
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
