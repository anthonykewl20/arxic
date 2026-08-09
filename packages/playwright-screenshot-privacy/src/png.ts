import { inflateSync } from 'node:zlib';
import { ScreenshotPrivacyError } from './standalone-runtime';

export type InspectedPng = Readonly<{
  width: number;
  height: number;
  bytes: number;
}>;

const signature = Buffer.from('89504e470d0a1a0a', 'hex');
const maximumBytes = 16 * 1024 * 1024;
const maximumDimension = 8192;
const maximumPixels = 16 * 1024 * 1024;
const maximumChunks = 256;

export function inspectPng(input: Uint8Array): InspectedPng {
  const bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (bytes.length < signature.length + 12 || bytes.length > maximumBytes) {
    invalid('PNG byte length is outside the retained-evidence limit');
  }
  if (!bytes.subarray(0, signature.length).equals(signature)) invalid('PNG signature is invalid');

  let offset = signature.length;
  let width = 0;
  let height = 0;
  let channels = 0;
  let sawHeader = false;
  let sawData = false;
  let endedData = false;
  let sawEnd = false;
  let chunkCount = 0;
  const compressed: Buffer[] = [];
  let compressedBytes = 0;

  while (offset < bytes.length) {
    chunkCount += 1;
    if (chunkCount > maximumChunks || offset + 12 > bytes.length) {
      invalid('PNG chunk inventory is truncated or exceeds its bound');
    }
    const length = bytes.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (length > maximumBytes || end > bytes.length) invalid('PNG chunk length is invalid');
    const typeBytes = bytes.subarray(offset + 4, offset + 8);
    const type = typeBytes.toString('ascii');
    if (!/^[A-Za-z]{4}$/u.test(type)) invalid('PNG chunk type is invalid');
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    const expectedCrc = bytes.readUInt32BE(offset + 8 + length);
    const actualCrc = crc32(Buffer.concat([typeBytes, data]));
    if (actualCrc !== expectedCrc) invalid(`PNG ${type} chunk CRC is invalid`);
    if (!['IHDR', 'IDAT', 'IEND'].includes(type)) {
      invalid(`PNG ${type} chunk is not permitted in retained evidence`);
    }
    if (type === 'IHDR') {
      if (sawHeader || chunkCount !== 1 || length !== 13) invalid('PNG IHDR is invalid');
      sawHeader = true;
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const bitDepth = data[8];
      const colorType = data[9];
      const compression = data[10];
      const filter = data[11];
      const interlace = data[12];
      if (
        width < 1 ||
        height < 1 ||
        width > maximumDimension ||
        height > maximumDimension ||
        width * height > maximumPixels
      ) {
        invalid('PNG dimensions exceed the retained-evidence limit');
      }
      if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) {
        invalid('PNG must be 8-bit RGB or RGBA');
      }
      if (compression !== 0 || filter !== 0 || interlace !== 0) {
        invalid('PNG compression, filter, or interlace method is unsupported');
      }
      channels = colorType === 2 ? 3 : 4;
    } else if (type === 'IDAT') {
      if (!sawHeader || sawEnd || endedData) invalid('PNG IDAT ordering is invalid');
      sawData = true;
      compressed.push(data);
      compressedBytes += data.length;
      if (compressedBytes > maximumBytes) invalid('PNG compressed pixels exceed their bound');
    } else {
      if (!sawHeader || !sawData || sawEnd || length !== 0) invalid('PNG IEND is invalid');
      sawEnd = true;
      if (end !== bytes.length) invalid('PNG contains trailing or polyglot bytes');
    }
    if (sawData && type !== 'IDAT') endedData = true;
    offset = end;
  }
  if (!sawHeader || !sawData || !sawEnd || offset !== bytes.length) {
    invalid('PNG is missing a required critical chunk');
  }

  const rowBytes = width * channels + 1;
  const expectedInflatedBytes = rowBytes * height;
  let pixels: Buffer;
  try {
    const inflated = inflateSync(Buffer.concat(compressed), {
      info: true,
      maxOutputLength: expectedInflatedBytes + 1,
    }) as unknown as { buffer: Buffer; engine: { bytesWritten: number } };
    pixels = inflated.buffer;
    if (inflated.engine.bytesWritten !== compressedBytes) {
      invalid('PNG IDAT contains bytes after the zlib stream');
    }
  } catch {
    invalid('PNG pixel stream could not be inflated within its declared bound');
  }
  if (pixels.length !== expectedInflatedBytes) invalid('PNG inflated pixel length is invalid');
  for (let row = 0; row < height; row += 1) {
    const filter = pixels[row * rowBytes];
    if (filter === undefined || filter > 4) invalid('PNG row filter is invalid');
  }
  return { width, height, bytes: bytes.length };
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function invalid(message: string): never {
  throw new ScreenshotPrivacyError('ARXIC-SCREENSHOT-PNG-INVALID', message);
}
