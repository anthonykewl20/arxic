import type { Dirent } from 'node:fs';
import { lstat, opendir } from 'node:fs/promises';
import { join } from 'node:path';

export type ArtifactDiscoveryLimits = Readonly<{
  maxRoots: number;
  maxDepth: number;
  maxEntries: number;
  maxCandidates: number;
  maxNameBytes: number;
  maxPathBytes: number;
  maxTotalPathBytes: number;
}>;

export const DEFAULT_ARTIFACT_DISCOVERY_LIMITS: ArtifactDiscoveryLimits = Object.freeze({
  maxRoots: 8,
  maxDepth: 16,
  maxEntries: 1_024,
  maxCandidates: 256,
  maxNameBytes: 240,
  maxPathBytes: 4_096,
  maxTotalPathBytes: 256 * 1_024,
});

export class ArtifactDiscoveryError extends Error {
  readonly code:
    | 'ARTIFACT_DISCOVERY_INVALID_ROOT'
    | 'ARTIFACT_DISCOVERY_UNSAFE_ENTRY'
    | 'ARTIFACT_DISCOVERY_LIMIT_EXCEEDED'
    | 'ARTIFACT_DISCOVERY_IO_FAILED';

  constructor(code: ArtifactDiscoveryError['code'], message: string) {
    super(message);
    this.name = 'ArtifactDiscoveryError';
    this.code = code;
  }
}

export async function discoverCaptureArtifactCandidates(
  roots: readonly string[],
  overrides: Partial<ArtifactDiscoveryLimits> = {},
): Promise<string[]> {
  const limits = { ...DEFAULT_ARTIFACT_DISCOVERY_LIMITS, ...overrides };
  assertLimits(limits);
  if (roots.length > limits.maxRoots) throw limitError();
  const candidates: string[] = [];
  let entryCount = 0;
  let totalPathBytes = 0;
  for (const root of [...roots].sort(compare)) {
    assertPathBytes(root, limits);
    let metadata;
    try {
      metadata = await lstat(root);
    } catch (error) {
      if (isNodeError(error, 'ENOENT')) continue;
      throw ioError();
    }
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new ArtifactDiscoveryError(
        'ARTIFACT_DISCOVERY_INVALID_ROOT',
        'Artifact discovery root must be a real directory',
      );
    }
    const pending = [{ path: root, depth: 0 }];
    while (pending.length > 0) {
      const current = pending.pop()!;
      if (current.depth > limits.maxDepth) throw limitError();
      const entries: Dirent[] = [];
      try {
        const directory = await opendir(current.path);
        for await (const entry of directory) {
          entryCount += 1;
          if (entryCount > limits.maxEntries) throw limitError();
          entries.push(entry);
        }
      } catch (error) {
        if (error instanceof ArtifactDiscoveryError) throw error;
        throw ioError();
      }
      entries.sort((left, right) => compare(left.name, right.name));
      const childDirectories: Array<{ path: string; depth: number }> = [];
      for (const entry of entries) {
        if (
          entry.name !== entry.name.normalize('NFC') ||
          Buffer.byteLength(entry.name, 'utf8') > limits.maxNameBytes
        ) {
          throw limitError();
        }
        const path = join(current.path, entry.name);
        const pathBytes = Buffer.byteLength(path, 'utf8');
        if (pathBytes > limits.maxPathBytes) throw limitError();
        totalPathBytes += pathBytes;
        if (totalPathBytes > limits.maxTotalPathBytes) throw limitError();
        let child;
        try {
          child = await lstat(path);
        } catch {
          throw ioError();
        }
        if (entry.isSymbolicLink() || child.isSymbolicLink()) {
          throw new ArtifactDiscoveryError(
            'ARTIFACT_DISCOVERY_UNSAFE_ENTRY',
            'Artifact discovery rejects symbolic links',
          );
        }
        if (child.isDirectory()) {
          childDirectories.push({ path, depth: current.depth + 1 });
          continue;
        }
        if (!child.isFile()) {
          throw new ArtifactDiscoveryError(
            'ARTIFACT_DISCOVERY_UNSAFE_ENTRY',
            'Artifact discovery rejects non-regular entries',
          );
        }
        if (!/\.(?:png|zip)$/u.test(entry.name)) continue;
        candidates.push(path);
        if (candidates.length > limits.maxCandidates) throw limitError();
      }
      for (const child of childDirectories.reverse()) pending.push(child);
    }
  }
  return candidates.sort(compare);
}

function assertLimits(limits: ArtifactDiscoveryLimits): void {
  if (
    Object.values(limits).some((value) => !Number.isSafeInteger(value) || value < 0) ||
    limits.maxRoots === 0 ||
    limits.maxPathBytes === 0 ||
    limits.maxNameBytes === 0
  ) {
    throw limitError();
  }
}

function assertPathBytes(path: string, limits: ArtifactDiscoveryLimits): void {
  if (Buffer.byteLength(path, 'utf8') > limits.maxPathBytes) throw limitError();
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isNodeError(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === code
  );
}

function limitError(): ArtifactDiscoveryError {
  return new ArtifactDiscoveryError(
    'ARTIFACT_DISCOVERY_LIMIT_EXCEEDED',
    'Artifact discovery exceeded a configured safety limit',
  );
}

function ioError(): ArtifactDiscoveryError {
  return new ArtifactDiscoveryError(
    'ARTIFACT_DISCOVERY_IO_FAILED',
    'Artifact discovery could not inspect the owned workspace safely',
  );
}
