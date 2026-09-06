import { sha256 } from '@arxic/contracts';
import { readBoundedRegularFile } from '../../../packages/playwright-screenshot-privacy/src/safe-filesystem';

/** Shared byte mechanics; callers own HTTP/workflow failure disposition. */
export async function readEvidenceFile(
  path: string,
  expectedHash: string,
  maximumBytes: number,
): Promise<{ ok: true; bytes: Buffer } | { ok: false; reason: 'unavailable' | 'hash-mismatch' }> {
  let bytes: Buffer;
  try {
    bytes = await readBoundedRegularFile(path, {
      minimumBytes: 1,
      maximumBytes,
      onFailure: () => {
        throw new Error('Evidence file unavailable');
      },
    });
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
  return sha256(bytes) === expectedHash
    ? { ok: true, bytes }
    : { ok: false, reason: 'hash-mismatch' };
}
