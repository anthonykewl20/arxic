import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

export const ARXIC_SOURCE_UNSAFE_FILE = 'ARXIC-SOURCE-UNSAFE-FILE' as const;

export type SafeSourceRead =
  | { ok: true; bytes: Buffer; sizeBytes: number }
  | {
      ok: false;
      kind: 'oversize' | 'unsafe';
      sizeBytes: number;
      detail: string;
      errorCode?: string;
    };

function contained(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
}

/** Reads an untrusted source path through a bounded, no-follow file descriptor. */
export async function readSafeSource(
  resolvedRoot: string,
  relativePath: string,
  maxBytes: number,
): Promise<SafeSourceRead> {
  let candidate: string;
  try {
    candidate = resolve(resolvedRoot, relativePath);
  } catch (error) {
    return { ok: false, kind: 'unsafe', sizeBytes: 0, detail: String(error) };
  }
  if (!contained(resolvedRoot, candidate))
    return { ok: false, kind: 'unsafe', sizeBytes: 0, detail: 'Path escapes source root.' };

  let linkStat: Awaited<ReturnType<typeof lstat>>;
  try {
    linkStat = await lstat(candidate);
  } catch (error) {
    return {
      ok: false,
      kind: 'unsafe',
      sizeBytes: 0,
      detail: String(error),
      errorCode: errorCode(error),
    };
  }
  if (linkStat.isSymbolicLink()) {
    let detail = 'Symbolic links are not source files.';
    try {
      const target = await realpath(candidate);
      detail = contained(resolvedRoot, target)
        ? detail
        : `Symbolic-link target escapes resolved source root: ${target}`;
    } catch (error) {
      detail = `Symbolic link cannot be resolved safely: ${String(error)}`;
    }
    return { ok: false, kind: 'unsafe', sizeBytes: linkStat.size, detail };
  }
  if (!linkStat.isFile())
    return {
      ok: false,
      kind: 'unsafe',
      sizeBytes: linkStat.size,
      detail: 'Only regular files may be collected.',
    };

  let resolvedFile: string;
  try {
    resolvedFile = await realpath(candidate);
  } catch (error) {
    return {
      ok: false,
      kind: 'unsafe',
      sizeBytes: linkStat.size,
      detail: String(error),
      errorCode: errorCode(error),
    };
  }
  if (!contained(resolvedRoot, resolvedFile))
    return {
      ok: false,
      kind: 'unsafe',
      sizeBytes: linkStat.size,
      detail: `Real path escapes resolved source root: ${resolvedFile}`,
    };
  if (linkStat.size > maxBytes)
    return {
      ok: false,
      kind: 'oversize',
      sizeBytes: linkStat.size,
      detail: `${linkStat.size} bytes exceeds quota ${maxBytes}.`,
    };

  let handle: FileHandle | undefined;
  try {
    handle = await open(candidate, constants.O_RDONLY | constants.O_NOFOLLOW);
    const descriptorStat = await handle.stat();
    const reopenedPath = await realpath(candidate);
    let descriptorPath = reopenedPath;
    if (process.platform === 'linux') descriptorPath = await realpath(`/proc/self/fd/${handle.fd}`);
    else if (process.platform === 'darwin') descriptorPath = await realpath(`/dev/fd/${handle.fd}`);
    if (
      !descriptorStat.isFile() ||
      !contained(resolvedRoot, descriptorPath) ||
      !contained(resolvedRoot, reopenedPath) ||
      descriptorStat.dev !== linkStat.dev ||
      descriptorStat.ino !== linkStat.ino ||
      descriptorStat.nlink > 1
    )
      return {
        ok: false,
        kind: 'unsafe',
        sizeBytes: descriptorStat.size,
        detail: 'Opened source descriptor is not the contained regular file that was inspected.',
      };
    if (descriptorStat.size > maxBytes)
      return {
        ok: false,
        kind: 'oversize',
        sizeBytes: descriptorStat.size,
        detail: `${descriptorStat.size} bytes exceeds quota ${maxBytes}.`,
      };

    const bytes = Buffer.allocUnsafe(descriptorStat.size);
    let offset = 0;
    while (offset < descriptorStat.size) {
      const length = Math.min(64 * 1024, descriptorStat.size - offset);
      const { bytesRead } = await handle.read(bytes, offset, length, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset !== descriptorStat.size)
      return {
        ok: false,
        kind: 'unsafe',
        sizeBytes: offset,
        detail: 'Source file size changed while it was being read.',
      };
    return { ok: true, bytes, sizeBytes: descriptorStat.size };
  } catch (error) {
    return { ok: false, kind: 'unsafe', sizeBytes: linkStat.size, detail: String(error) };
  } finally {
    await handle?.close();
  }
}

function errorCode(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string')
    return error.code;
  return undefined;
}
