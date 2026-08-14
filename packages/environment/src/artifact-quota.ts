import { createReadStream } from 'node:fs';

export const DEFAULT_RESULT_QUOTA_BYTES = 256 * 1024 * 1024;
export const DEFAULT_RESULT_FILE_LIMIT = 4096;
export const DEFAULT_RESULT_FILE_QUOTA_BYTES = 512 * 1024 * 1024;

export class ArtifactImportError extends Error {
  constructor(
    readonly reason: 'quota' | 'invalid',
    message: string,
  ) {
    super(message);
    this.name = 'ArtifactImportError';
  }
}

export type ArtifactReadBudget = {
  totalBytes: number;
  fileCount: number;
};

export type ArtifactReadResult =
  | Readonly<{ accepted: true; bytes: Uint8Array; budget: ArtifactReadBudget }>
  | Readonly<{
      accepted: false;
      reason: 'file-size' | 'total-bytes';
      budget: ArtifactReadBudget;
    }>;

/**
 * Read one hostile artifact with incremental limits. Chunks are charged before
 * they are retained, so rejection never constructs a whole over-limit Buffer.
 */
export async function readArtifactWithinQuota(
  path: string,
  budget: ArtifactReadBudget,
  limits: Readonly<{ perFileBytes: number; totalBytes: number }>,
): Promise<ArtifactReadResult> {
  const chunks: Buffer[] = [];
  let fileBytes = 0;
  for await (const chunk of createReadStream(path, { highWaterMark: 64 * 1024 })) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const nextFileBytes = fileBytes + bytes.byteLength;
    const nextTotalBytes = budget.totalBytes + bytes.byteLength;
    if (nextFileBytes > limits.perFileBytes) {
      return { accepted: false, reason: 'file-size', budget };
    }
    if (nextTotalBytes > limits.totalBytes) {
      return { accepted: false, reason: 'total-bytes', budget };
    }
    chunks.push(bytes);
    fileBytes = nextFileBytes;
    budget.totalBytes = nextTotalBytes;
  }
  return {
    accepted: true,
    bytes: Buffer.concat(chunks, fileBytes),
    budget,
  };
}
