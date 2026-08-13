import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readFile, readlink } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { canonicalPipelineJson } from './pipeline-result';

const execute = promisify(execFile);

export type SourceManifestEntry = Readonly<{
  path: string;
  blobSha256: string;
  sizeBytes: number;
  type: 'file' | 'symlink';
}>;

export type SourceTreeHash = Readonly<{
  sourceSha256: string;
  manifest: readonly SourceManifestEntry[];
}>;

/**
 * Hash the same tracked + non-ignored untracked source set used by the source
 * collector. Each real file's bytes (or a symlink's link-text bytes, matching
 * Git blob semantics) are bound into a canonical, bytewise-sorted manifest.
 */
export async function hashSourceTree(root: string): Promise<SourceTreeHash> {
  const { stdout } = await execute(
    'git',
    ['-C', root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 },
  );
  const paths = decodePaths(stdout).sort(bytewiseCompare);
  const manifest: SourceManifestEntry[] = [];
  for (const path of [...new Set(paths)]) {
    const absolute = join(root, ...path.split('/'));
    let stats;
    try {
      stats = await lstat(absolute);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    let bytes: Uint8Array;
    let type: SourceManifestEntry['type'];
    if (stats.isSymbolicLink()) {
      bytes = Buffer.from(await readlink(absolute), 'utf8');
      type = 'symlink';
    } else if (stats.isFile()) {
      bytes = await readFile(absolute);
      type = 'file';
    } else {
      throw new Error(`Unsupported source entry type: ${path}`);
    }
    manifest.push({
      path,
      blobSha256: sha256(bytes),
      sizeBytes: bytes.byteLength,
      type,
    });
  }
  const manifestBytes = Buffer.from(`${canonicalPipelineJson(manifest)}\n`, 'utf8');
  return { sourceSha256: sha256(manifestBytes), manifest };
}

function decodePaths(output: Buffer): string[] {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  return output
    .subarray(0, output.length > 0 && output[output.length - 1] === 0 ? -1 : undefined)
    .toString('binary')
    .split('\0')
    .filter(Boolean)
    .map((path) => decoder.decode(Buffer.from(path, 'binary')));
}

function bytewiseCompare(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
