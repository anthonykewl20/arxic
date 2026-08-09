import { open } from 'node:fs/promises';
import { posix } from 'node:path';
import { fromBufferPromise, type Entry, type ZipFile as UnzipFile } from 'yauzl';
import { ZipFile } from 'yazl';

export type TraceArchiveLimits = Readonly<{
  maxArchiveBytes: number;
  maxEntries: number;
  maxEntryBytes: number;
  maxTotalBytes: number;
  maxCompressionRatio: number;
}>;

export const DEFAULT_TRACE_ARCHIVE_LIMITS: TraceArchiveLimits = Object.freeze({
  maxArchiveBytes: 128 * 1024 * 1024,
  maxEntries: 4_096,
  maxEntryBytes: 32 * 1024 * 1024,
  maxTotalBytes: 128 * 1024 * 1024,
  maxCompressionRatio: 200,
});

export class TraceArchiveError extends Error {
  readonly code:
    | 'TRACE_ZIP_INVALID'
    | 'TRACE_ZIP_UNSAFE_PATH'
    | 'TRACE_ZIP_DUPLICATE_ENTRY'
    | 'TRACE_ZIP_LIMIT_EXCEEDED';

  constructor(code: TraceArchiveError['code'], message: string) {
    super(message);
    this.name = 'TraceArchiveError';
    this.code = code;
  }
}

export class BoundedFileLimitError extends Error {
  constructor() {
    super('File exceeds its configured safety limit');
    this.name = 'BoundedFileLimitError';
  }
}

export async function readArchive(
  source: string | Buffer,
  overrides: Partial<TraceArchiveLimits> = {},
): Promise<Map<string, Buffer>> {
  const limits = { ...DEFAULT_TRACE_ARCHIVE_LIMITS, ...overrides };
  assertLimits(limits);
  let sourceBytes: Buffer;
  try {
    sourceBytes = Buffer.isBuffer(source)
      ? source
      : await readBoundedFile(source, limits.maxArchiveBytes);
  } catch (error) {
    if (error instanceof BoundedFileLimitError) throw limitError();
    throw error;
  }
  if (sourceBytes.byteLength > limits.maxArchiveBytes) throw limitError();
  let archive: UnzipFile;
  try {
    archive = await fromBufferPromise(sourceBytes, strictOptions);
  } catch {
    throw new TraceArchiveError('TRACE_ZIP_INVALID', 'Trace archive is not a valid ZIP');
  }
  const entries = new Map<string, Buffer>();
  const seen = new Set<string>();
  let entryCount = 0;
  let totalBytes = 0;
  try {
    for await (const entry of archive.eachEntry()) {
      entryCount += 1;
      if (entryCount > limits.maxEntries) throw limitError();
      const { name, key, directory } = safeEntryName(entry.fileName);
      if (seen.has(key)) {
        throw new TraceArchiveError(
          'TRACE_ZIP_DUPLICATE_ENTRY',
          'Trace archive contains duplicate normalized entries',
        );
      }
      seen.add(key);
      assertSafeEntry(entry, limits);
      await assertCanonicalEntryMetadata(archive, entry);
      totalBytes += entry.uncompressedSize;
      if (totalBytes > limits.maxTotalBytes) throw limitError();
      if (directory) continue;
      const bytes = await readEntry(archive, entry, limits.maxEntryBytes);
      entries.set(name, bytes);
    }
  } catch (error) {
    if (error instanceof TraceArchiveError) throw error;
    if (
      error instanceof Error &&
      /^(?:absolute path|invalid characters in fileName|invalid relative path):/u.test(
        error.message,
      )
    ) {
      throw unsafePathError();
    }
    throw new TraceArchiveError('TRACE_ZIP_INVALID', 'Trace archive could not be read safely');
  } finally {
    archive.close();
  }
  return entries;
}

export async function readBoundedFile(path: string, maxBytes: number): Promise<Buffer> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new BoundedFileLimitError();
  const handle = await open(path, 'r');
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size > maxBytes) throw new BoundedFileLimitError();
    const chunks: Buffer[] = [];
    let total = 0;
    while (true) {
      const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, maxBytes - total + 1));
      const { bytesRead } = await handle.read(chunk, 0, chunk.byteLength, null);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > maxBytes) throw new BoundedFileLimitError();
      chunks.push(chunk.subarray(0, bytesRead));
    }
    return Buffer.concat(chunks, total);
  } finally {
    await handle.close();
  }
}

export async function writeDeterministicArchive(
  entries: ReadonlyMap<string, Buffer>,
): Promise<Buffer> {
  const zip = new ZipFile();
  for (const [name, bytes] of [...entries].sort(([left], [right]) => compare(left, right))) {
    safeEntryName(name);
    zip.addBuffer(bytes, name, {
      mtime: new Date('1980-01-01T00:00:00.000Z'),
      mode: 0o100644,
      compress: false,
      forceDosTimestamp: true,
    });
  }
  zip.end({ forceZip64Format: false, comment: '' });
  const chunks: Buffer[] = [];
  for await (const chunk of zip.outputStream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

const strictOptions = {
  autoClose: false,
  lazyEntries: true,
  decodeStrings: true,
  validateEntrySizes: true,
  // Receive legacy backslashes as normalized slashes, then apply the stricter
  // path policy above so traversal has a stable failure classification.
  strictFileNames: false,
} as const;

function safeEntryName(fileName: string): { name: string; key: string; directory: boolean } {
  const directory = fileName.endsWith('/');
  const name = directory ? fileName.slice(0, -1) : fileName;
  if (
    name.length === 0 ||
    name.includes('\0') ||
    name.includes('\\') ||
    name !== name.normalize('NFC') ||
    name.startsWith('/') ||
    /^[A-Za-z]:/u.test(name)
  ) {
    throw unsafePathError();
  }
  const segments = name.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw unsafePathError();
  }
  const normalized = posix.normalize(name);
  if (normalized !== name || normalized.startsWith('../')) throw unsafePathError();
  return { name, key: normalized, directory };
}

function assertSafeEntry(entry: Entry, limits: TraceArchiveLimits): void {
  if (entry.isEncrypted() || !entry.canDecodeFileData()) {
    throw new TraceArchiveError('TRACE_ZIP_INVALID', 'Trace archive uses unsupported ZIP features');
  }
  if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) {
    throw new TraceArchiveError('TRACE_ZIP_INVALID', 'Trace archive uses unsupported compression');
  }
  const unixMode = entry.externalFileAttributes >>> 16;
  const fileType = unixMode & 0o170000;
  if (fileType !== 0 && fileType !== 0o100000 && fileType !== 0o040000) {
    throw new TraceArchiveError('TRACE_ZIP_INVALID', 'Trace archive contains a special file');
  }
  if (entry.uncompressedSize > limits.maxEntryBytes) throw limitError();
  if (
    entry.uncompressedSize > 1_024 &&
    entry.uncompressedSize / Math.max(1, entry.compressedSize) > limits.maxCompressionRatio
  ) {
    throw limitError();
  }
}

async function assertCanonicalEntryMetadata(archive: UnzipFile, entry: Entry): Promise<void> {
  const local = await archive.readLocalFileHeaderPromise(entry);
  if (
    !local.fileName.equals(entry.fileNameRaw) ||
    local.versionNeededToExtract !== entry.versionNeededToExtract ||
    local.generalPurposeBitFlag !== entry.generalPurposeBitFlag ||
    local.compressionMethod !== entry.compressionMethod ||
    local.lastModFileTime !== entry.lastModFileTime ||
    local.lastModFileDate !== entry.lastModFileDate
  ) {
    throw inconsistentMetadataError();
  }
  // Bit 3 permits a data descriptor, in which case the local CRC and sizes may
  // legally be zero. Without it, the local and central records must agree.
  if (
    (entry.generalPurposeBitFlag & 0x8) === 0 &&
    (local.crc32 !== entry.crc32 ||
      local.compressedSize !== entry.compressedSize ||
      local.uncompressedSize !== entry.uncompressedSize)
  ) {
    throw inconsistentMetadataError();
  }
}

async function readEntry(archive: UnzipFile, entry: Entry, maxBytes: number): Promise<Buffer> {
  const stream = await archive.openReadStreamPromise(entry);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    const bytes = Buffer.from(chunk);
    size += bytes.byteLength;
    if (size > maxBytes) throw limitError();
    chunks.push(bytes);
  }
  if (size !== entry.uncompressedSize) {
    throw new TraceArchiveError('TRACE_ZIP_INVALID', 'Trace archive entry size is inconsistent');
  }
  return Buffer.concat(chunks);
}

function unsafePathError(): TraceArchiveError {
  return new TraceArchiveError(
    'TRACE_ZIP_UNSAFE_PATH',
    'Trace archive contains an unsafe entry path',
  );
}

function limitError(): TraceArchiveError {
  return new TraceArchiveError(
    'TRACE_ZIP_LIMIT_EXCEEDED',
    'Trace archive exceeds configured safety limits',
  );
}

function inconsistentMetadataError(): TraceArchiveError {
  return new TraceArchiveError(
    'TRACE_ZIP_INVALID',
    'Trace archive contains inconsistent ZIP metadata',
  );
}

function assertLimits(limits: TraceArchiveLimits): void {
  if (
    !Number.isSafeInteger(limits.maxArchiveBytes) ||
    limits.maxArchiveBytes < 1 ||
    !Number.isSafeInteger(limits.maxEntries) ||
    limits.maxEntries < 1 ||
    !Number.isSafeInteger(limits.maxEntryBytes) ||
    limits.maxEntryBytes < 1 ||
    !Number.isSafeInteger(limits.maxTotalBytes) ||
    limits.maxTotalBytes < 1 ||
    !Number.isFinite(limits.maxCompressionRatio) ||
    limits.maxCompressionRatio <= 0
  ) {
    throw limitError();
  }
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
