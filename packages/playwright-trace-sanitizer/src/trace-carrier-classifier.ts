import { inflateSync } from 'node:zlib';
import { isBoundedPlaywrightTraceArchive } from './trace-sanitizer';
import { readBoundedFile } from './zip';

export const TRACE_CARRIER_PNG_MAX_BYTES = 32 * 1024 * 1024;

export type TraceCarrierPngClassification =
  'safe-png' | 'embedded-playwright-trace' | 'not-strict-png';

export type TraceCarrierPngReadResult =
  | Readonly<{ ok: true; bytes: Buffer }>
  | Readonly<{
      ok: false;
      classification: Exclude<TraceCarrierPngClassification, 'safe-png'> | 'unreadable';
    }>;

export type ScreenshotCheckpointValidation =
  | Readonly<{ ok: true }>
  | Readonly<{
      ok: false;
      code: 'invalid-checkpoint' | 'duplicate-checkpoint' | 'missing-source';
    }>;

const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const zipLocalHeader = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const zipEmptyArchive = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
const maxEmbeddedZipCandidates = 64;
const maxEmbeddedZipParserAttempts = 64;
const maxPngChunks = 4_096;
const maxPngAncillaryChunks = 256;

/**
 * Bounded screenshot classification for the raw-trace retention boundary.
 * This does not attest visual/pixel privacy; that is owned by screenshot capture policy.
 */
export async function classifyTraceCarrierPng(
  bytes: Buffer,
): Promise<TraceCarrierPngClassification> {
  const payloads = strictPngAncillaryPayloads(bytes);
  if (!payloads) return 'not-strict-png';
  return (await containsEmbeddedPlaywrightTrace(payloads))
    ? 'embedded-playwright-trace'
    : 'safe-png';
}

export async function readTraceCarrierFreePng(path: string): Promise<TraceCarrierPngReadResult> {
  try {
    const bytes = await readBoundedFile(path, TRACE_CARRIER_PNG_MAX_BYTES);
    const classification = await classifyTraceCarrierPng(bytes);
    return classification === 'safe-png' ? { ok: true, bytes } : { ok: false, classification };
  } catch {
    return { ok: false, classification: 'unreadable' };
  }
}

export function isSafeScreenshotCheckpoint(
  checkpoint: string,
  forbiddenSubstrings: readonly string[] = [],
): boolean {
  return (
    /^[a-z][a-z0-9-]{0,63}$/u.test(checkpoint) &&
    !forbiddenSubstrings.some((value) => value.length > 0 && checkpoint.includes(value)) &&
    !/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu.test(checkpoint)
  );
}

export function isPolicyOwnedScreenshotFilename(
  fileName: string,
  checkpoints: readonly string[] = [],
): boolean {
  return checkpoints.some(
    (checkpoint) =>
      isSafeScreenshotCheckpoint(checkpoint) &&
      screenshotFilenameMatchesCheckpoint(fileName, checkpoint),
  );
}

export function validateScreenshotCheckpointFilenames(
  fileNames: readonly string[],
  checkpoints: readonly string[] = [],
  forbiddenSubstrings: readonly string[] = [],
): ScreenshotCheckpointValidation {
  const declared = new Set<string>();
  for (const checkpoint of checkpoints) {
    if (!isSafeScreenshotCheckpoint(checkpoint, forbiddenSubstrings)) {
      return { ok: false, code: 'invalid-checkpoint' };
    }
    if (declared.has(checkpoint)) return { ok: false, code: 'duplicate-checkpoint' };
    declared.add(checkpoint);
  }
  const available = [...fileNames].sort();
  const matched = new Set<string>();
  for (const checkpoint of [...checkpoints].sort(
    (left, right) => right.length - left.length || (left < right ? -1 : left > right ? 1 : 0),
  )) {
    const source = available.find(
      (fileName) =>
        !matched.has(fileName) && screenshotFilenameMatchesCheckpoint(fileName, checkpoint),
    );
    if (!source) return { ok: false, code: 'missing-source' };
    matched.add(source);
  }
  return { ok: true };
}

function screenshotFilenameMatchesCheckpoint(fileName: string, checkpoint: string): boolean {
  return (
    fileName === `${checkpoint}.png` ||
    (/^step-\d+-[a-z0-9-]+\.png$/u.test(fileName) && fileName.endsWith(`-${checkpoint}.png`))
  );
}

function strictPngAncillaryPayloads(bytes: Buffer): readonly Buffer[] | undefined {
  if (
    bytes.byteLength > TRACE_CARRIER_PNG_MAX_BYTES ||
    bytes.byteLength < 45 ||
    !bytes.subarray(0, pngSignature.length).equals(pngSignature)
  ) {
    return undefined;
  }
  let offset = pngSignature.length;
  let chunks = 0;
  let sawIdat = false;
  let idatEnded = false;
  let sawPalette = false;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat: Buffer[] = [];
  const ancillaryPayloads: Buffer[] = [];
  while (offset + 12 <= bytes.byteLength) {
    const length = bytes.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > bytes.byteLength) return undefined;
    const type = bytes.subarray(offset + 4, offset + 8);
    if (!/^[A-Za-z]{4}$/u.test(type.toString('ascii'))) return undefined;
    const expectedCrc = bytes.readUInt32BE(offset + 8 + length);
    if (crc32(bytes.subarray(offset + 4, offset + 8 + length)) !== expectedCrc) return undefined;
    const name = type.toString('ascii');
    if (chunks === 0) {
      if (name !== 'IHDR' || length !== 13) return undefined;
      width = bytes.readUInt32BE(offset + 8);
      height = bytes.readUInt32BE(offset + 12);
      bitDepth = bytes[offset + 16]!;
      colorType = bytes[offset + 17]!;
      if (
        width === 0 ||
        height === 0 ||
        !validPngColorDepth(colorType, bitDepth) ||
        bytes[offset + 18] !== 0 ||
        bytes[offset + 19] !== 0 ||
        bytes[offset + 20] !== 0
      ) {
        return undefined;
      }
    } else if (name === 'IHDR') {
      return undefined;
    }
    if (name === 'PLTE') {
      if (sawPalette || sawIdat || length === 0 || length > 768 || length % 3 !== 0) {
        return undefined;
      }
      sawPalette = true;
    }
    if (name === 'IDAT') {
      if (idatEnded) return undefined;
      sawIdat = true;
      idat.push(bytes.subarray(offset + 8, offset + 8 + length));
    } else if (sawIdat && name !== 'IEND') {
      idatEnded = true;
    }
    if (type[0]! >= 0x41 && type[0]! <= 0x5a && !['IHDR', 'PLTE', 'IDAT', 'IEND'].includes(name)) {
      return undefined;
    }
    if ((type[0]! & 0x20) !== 0) {
      ancillaryPayloads.push(bytes.subarray(offset + 8, offset + 8 + length));
    }
    offset = end;
    chunks += 1;
    if (chunks > maxPngChunks || ancillaryPayloads.length > maxPngAncillaryChunks) {
      return undefined;
    }
    if (name === 'IEND') {
      if (
        length !== 0 ||
        !sawIdat ||
        offset !== bytes.byteLength ||
        (colorType === 3 && !sawPalette) ||
        ((colorType === 0 || colorType === 4) && sawPalette)
      ) {
        return undefined;
      }
      return hasDecodablePngRows(idat, width, height, colorType, bitDepth)
        ? ancillaryPayloads
        : undefined;
    }
  }
  return undefined;
}

async function containsEmbeddedPlaywrightTrace(payloads: readonly Buffer[]): Promise<boolean> {
  if (payloads.length === 0) return false;
  const payload = payloads.length === 1 ? payloads[0]! : Buffer.concat(payloads);
  const starts = [
    ...signatureOffsets(payload, zipLocalHeader),
    ...signatureOffsets(payload, zipEmptyArchive),
  ].sort((left, right) => left - right);
  const ends = signatureOffsets(payload, zipEmptyArchive);
  if (starts.length + ends.length > maxEmbeddedZipCandidates) return true;
  let parserAttempts = 0;
  for (const start of starts) {
    for (const eocd of ends) {
      if (eocd < start || eocd + 22 > payload.byteLength) continue;
      const end = eocd + 22 + payload.readUInt16LE(eocd + 20);
      if (end > payload.byteLength) continue;
      parserAttempts += 1;
      if (parserAttempts > maxEmbeddedZipParserAttempts) return true;
      try {
        if (
          await isBoundedPlaywrightTraceArchive(payload.subarray(start, end), {
            maxArchiveBytes: TRACE_CARRIER_PNG_MAX_BYTES,
          })
        ) {
          return true;
        }
      } catch {
        // A local-header/EOCD lookalike is not a trace unless the shared parser accepts it.
      }
    }
  }
  return false;
}

function signatureOffsets(bytes: Buffer, signature: Buffer): number[] {
  const offsets: number[] = [];
  let offset = 0;
  while (offset <= bytes.byteLength - signature.byteLength) {
    const found = bytes.indexOf(signature, offset);
    if (found === -1) break;
    offsets.push(found);
    if (offsets.length > maxEmbeddedZipCandidates) break;
    offset = found + 1;
  }
  return offsets;
}

function validPngColorDepth(colorType: number, bitDepth: number): boolean {
  const allowed = new Map<number, readonly number[]>([
    [0, [1, 2, 4, 8, 16]],
    [2, [8, 16]],
    [3, [1, 2, 4, 8]],
    [4, [8, 16]],
    [6, [8, 16]],
  ]);
  return allowed.get(colorType)?.includes(bitDepth) === true;
}

function hasDecodablePngRows(
  idat: readonly Buffer[],
  width: number,
  height: number,
  colorType: number,
  bitDepth: number,
): boolean {
  const channels = new Map([
    [0, 1],
    [2, 3],
    [3, 1],
    [4, 2],
    [6, 4],
  ]).get(colorType);
  if (!channels) return false;
  const rowBytes = (BigInt(width) * BigInt(channels) * BigInt(bitDepth) + 7n) / 8n;
  const expectedBytes = BigInt(height) * (rowBytes + 1n);
  if (expectedBytes <= 0n || expectedBytes > BigInt(TRACE_CARRIER_PNG_MAX_BYTES)) return false;
  try {
    const compressed = Buffer.concat(idat);
    const decoded = inflateSync(compressed, {
      info: true,
      maxOutputLength: Number(expectedBytes),
    }) as unknown as { buffer: Buffer; engine: { bytesWritten: number } };
    if (
      decoded.engine.bytesWritten !== compressed.byteLength ||
      decoded.buffer.byteLength !== Number(expectedBytes)
    ) {
      return false;
    }
    const stride = Number(rowBytes) + 1;
    for (let offset = 0; offset < decoded.buffer.byteLength; offset += stride) {
      if (decoded.buffer[offset]! > 4) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
