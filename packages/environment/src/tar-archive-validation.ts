import { open } from 'node:fs/promises';
import { ArtifactImportError } from './artifact-quota';

const BLOCK_BYTES = 512;
const MAX_EXTENSION_BYTES = 1024 * 1024;
const UNSAFE_ARCHIVE_MESSAGE =
  'Worker result contains an unsafe filesystem entry; host extraction was blocked';

type PaxOverrides = Readonly<{ path?: string; type?: '0' | '5' }>;

/**
 * Parse a tar archive without extracting it. This deliberately accepts only
 * directory and regular-file members, and resolves path-bearing extension
 * records before accepting the member they modify.
 */
export async function validateTarArchive(path: string): Promise<void> {
  const archive = await open(path, 'r');
  try {
    const { size: archiveBytes } = await archive.stat();
    let offset = 0;
    let zeroBlocks = 0;
    let globalPax: PaxOverrides = {};
    let localPax: PaxOverrides | undefined;
    let longPath: string | undefined;

    while (offset < archiveBytes) {
      const header = await readExactly(archive, BLOCK_BYTES, offset);
      offset += BLOCK_BYTES;
      if (header.every((byte) => byte === 0)) {
        zeroBlocks += 1;
        if (zeroBlocks === 2) {
          if (localPax !== undefined || longPath !== undefined) throw unsafe();
          // GNU tar pads its final record with additional zero blocks. They
          // are harmless only when every remaining complete block is zero.
          while (offset < archiveBytes) {
            const padding = await readExactly(archive, BLOCK_BYTES, offset);
            if (!padding.every((byte) => byte === 0)) throw unsafe();
            offset += BLOCK_BYTES;
          }
          return;
        }
        continue;
      }
      if (zeroBlocks !== 0) throw unsafe();
      assertHeaderChecksum(header);
      const memberBytes = parseOctal(header.subarray(124, 136));
      const paddedBytes = Math.ceil(memberBytes / BLOCK_BYTES) * BLOCK_BYTES;
      if (!Number.isSafeInteger(memberBytes) || offset + paddedBytes > archiveBytes) throw unsafe();

      const type = header[156] === 0 ? '\0' : String.fromCharCode(header[156]!);
      if (type === 'x' || type === 'g' || type === 'L' || type === 'K') {
        if (memberBytes > MAX_EXTENSION_BYTES) throw unsafe();
        const extensionData = await readExactly(archive, memberBytes, offset);
        if (type === 'x') {
          if (localPax !== undefined) throw unsafe();
          localPax = parsePax(extensionData);
        } else if (type === 'g') {
          globalPax = { ...globalPax, ...parsePax(extensionData) };
        } else if (type === 'L') {
          if (longPath !== undefined) throw unsafe();
          longPath = parseGnuLongPath(extensionData);
        } else {
          // GNU K is an explicit long link-target record. Nothing in an
          // artifact archive needs a link target, so reject rather than trying
          // to reason about a future link member.
          throw unsafe();
        }
        offset += paddedBytes;
        continue;
      }

      const headerPath = parseHeaderPath(header);
      const overrides = { ...globalPax, ...localPax };
      const effectivePath = longPath ?? overrides.path ?? headerPath;
      const effectiveType = type === '\0' ? '0' : type;
      if (
        (effectiveType !== '0' && effectiveType !== '5') ||
        (overrides.type !== undefined && overrides.type !== effectiveType) ||
        !safeArchivePath(effectivePath) ||
        !emptyTarField(header.subarray(157, 257))
      )
        throw unsafe();

      localPax = undefined;
      longPath = undefined;
      offset += paddedBytes;
    }
    throw unsafe();
  } finally {
    await archive.close();
  }
}

function unsafe(): ArtifactImportError {
  return new ArtifactImportError('invalid', UNSAFE_ARCHIVE_MESSAGE);
}

async function readExactly(
  archive: Awaited<ReturnType<typeof open>>,
  bytes: number,
  position: number,
): Promise<Buffer> {
  const output = Buffer.alloc(bytes);
  let read = 0;
  while (read < bytes) {
    const result = await archive.read(output, read, bytes - read, position + read);
    if (result.bytesRead === 0) throw unsafe();
    read += result.bytesRead;
  }
  return output;
}

function assertHeaderChecksum(header: Buffer): void {
  const stored = parseOctal(header.subarray(148, 156));
  const calculated = header.reduce(
    (total, byte, index) => total + (index >= 148 && index < 156 ? 0x20 : byte),
    0,
  );
  if (stored !== calculated) throw unsafe();
}

function parseOctal(field: Uint8Array): number {
  if (field.some((byte) => byte !== 0 && byte !== 0x20 && (byte < 0x30 || byte > 0x37)))
    throw unsafe();
  const value = Buffer.from(field)
    .toString('ascii')
    .replace(/[\0 ]+$/u, '')
    .trimStart();
  if (value.length === 0) return 0;
  const parsed = Number.parseInt(value, 8);
  if (!Number.isSafeInteger(parsed)) throw unsafe();
  return parsed;
}

function parseHeaderPath(header: Buffer): string {
  const name = decodeTarString(header.subarray(0, 100));
  const prefix = decodeTarString(header.subarray(345, 500));
  return prefix.length === 0 ? name : `${prefix}/${name}`;
}

function emptyTarField(field: Uint8Array): boolean {
  return field.every((byte) => byte === 0);
}

function decodeTarString(field: Uint8Array): string {
  const terminator = field.indexOf(0);
  const bytes = terminator === -1 ? field : field.subarray(0, terminator);
  if (terminator !== -1 && field.subarray(terminator).some((byte) => byte !== 0)) throw unsafe();
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw unsafe();
  }
}

function parseGnuLongPath(data: Buffer): string {
  if (data.byteLength === 0 || data.at(-1) !== 0) throw unsafe();
  try {
    const path = new TextDecoder('utf-8', { fatal: true }).decode(data.subarray(0, -1));
    if (path.includes('\0') || !safeArchivePath(path)) throw unsafe();
    return path;
  } catch (error) {
    if (error instanceof ArtifactImportError) throw error;
    throw unsafe();
  }
}

function parsePax(data: Buffer): PaxOverrides {
  let offset = 0;
  let overrides: PaxOverrides = {};
  while (offset < data.byteLength) {
    const space = data.indexOf(0x20, offset);
    if (space === -1 || space === offset) throw unsafe();
    const lengthText = data.subarray(offset, space).toString('ascii');
    if (!/^\d+$/u.test(lengthText)) throw unsafe();
    const length = Number(lengthText);
    const end = offset + length;
    if (!Number.isSafeInteger(length) || length <= space - offset + 1 || end > data.byteLength)
      throw unsafe();
    const record = data.subarray(space + 1, end);
    if (record.at(-1) !== 0x0a) throw unsafe();
    const separator = record.indexOf(0x3d);
    if (separator <= 0) throw unsafe();
    let key: string;
    let value: string;
    try {
      const decoder = new TextDecoder('utf-8', { fatal: true });
      key = decoder.decode(record.subarray(0, separator));
      value = decoder.decode(record.subarray(separator + 1, -1));
    } catch {
      throw unsafe();
    }
    if (key === 'path') {
      if (value.includes('\0') || !safeArchivePath(value)) throw unsafe();
      overrides = { ...overrides, path: value };
    } else if (key === 'type') {
      if (value !== '0' && value !== '5' && value !== 'regular' && value !== 'directory')
        throw unsafe();
      overrides = {
        ...overrides,
        type: value === 'regular' ? '0' : value === 'directory' ? '5' : value,
      };
    } else if (!['atime', 'ctime', 'gid', 'gname', 'mtime', 'uid', 'uname'].includes(key)) {
      // PAX linkpath and all unknown keys are deliberately unsupported. A
      // permissive parser could miss a future path- or type-affecting key.
      throw unsafe();
    }
    offset = end;
  }
  return overrides;
}

function safeArchivePath(path: string): boolean {
  return path.length > 0 && !path.startsWith('/') && !path.split('/').includes('..');
}
