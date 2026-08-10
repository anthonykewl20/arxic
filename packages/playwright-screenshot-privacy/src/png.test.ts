import { deflateSync } from 'node:zlib';
import { describe, expect, test } from 'vitest';
import { inspectPng } from './index';

describe('bounded Playwright PNG validation', () => {
  test.each([
    ['empty', Buffer.alloc(0)],
    ['truncated', validPng().subarray(0, 30)],
    ['wrong signature', Buffer.from(validPng()).fill(0, 0, 8)],
    ['trailing bytes', Buffer.concat([validPng(), Buffer.from('PK\u0003\u0004')])],
    ['CRC mismatch', mutate(validPng(), 29)],
    [
      'ancillary text chunk',
      png([chunk('IHDR', ihdr()), chunk('tEXt', Buffer.from('secret')), idat(), iend()]),
    ],
    ['duplicate IHDR', png([chunk('IHDR', ihdr()), chunk('IHDR', ihdr()), idat(), iend()])],
    ['missing IDAT', png([chunk('IHDR', ihdr()), iend()])],
    ['unsupported interlace', png([chunk('IHDR', ihdr({ interlace: 1 })), idat(), iend()])],
    ['unsupported color type', png([chunk('IHDR', ihdr({ colorType: 0 })), idat(), iend()])],
    ['oversized dimensions', png([chunk('IHDR', ihdr({ width: 20_000 })), idat(), iend()])],
    [
      'inflated row mismatch',
      png([chunk('IHDR', ihdr()), chunk('IDAT', deflateSync(Buffer.from([0]))), iend()]),
    ],
    [
      'payload after the zlib stream inside IDAT',
      png([
        chunk('IHDR', ihdr()),
        chunk(
          'IDAT',
          Buffer.concat([
            deflateSync(Buffer.from([0, 0x11, 0x22, 0x33])),
            Buffer.from('PK\u0003\u0004hidden'),
          ]),
        ),
        iend(),
      ]),
    ],
    [
      'decompression bomb',
      png([
        chunk('IHDR', ihdr()),
        chunk('IDAT', deflateSync(Buffer.alloc(128 * 1024, 0x41))),
        iend(),
      ]),
    ],
  ])('rejects %s', (_label, bytes) => {
    expect(() => inspectPng(bytes)).toThrow(/ARXIC-SCREENSHOT-PNG/u);
  });

  test('accepts a strict non-interlaced 8-bit RGB PNG', () => {
    expect(inspectPng(validPng())).toEqual({ width: 1, height: 1, bytes: validPng().length });
  });
});

function validPng(): Buffer {
  return png([chunk('IHDR', ihdr()), idat(), iend()]);
}

function idat(): Buffer {
  return chunk('IDAT', deflateSync(Buffer.from([0, 0x11, 0x22, 0x33])));
}

function iend(): Buffer {
  return chunk('IEND', Buffer.alloc(0));
}

function ihdr(
  overrides: Partial<{
    width: number;
    height: number;
    bitDepth: number;
    colorType: number;
    interlace: number;
  }> = {},
): Buffer {
  const values = {
    width: 1,
    height: 1,
    bitDepth: 8,
    colorType: 2,
    interlace: 0,
    ...overrides,
  };
  const bytes = Buffer.alloc(13);
  bytes.writeUInt32BE(values.width, 0);
  bytes.writeUInt32BE(values.height, 4);
  bytes[8] = values.bitDepth;
  bytes[9] = values.colorType;
  bytes[10] = 0;
  bytes[11] = 0;
  bytes[12] = values.interlace;
  return bytes;
}

function png(chunks: Buffer[]): Buffer {
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), ...chunks]);
}

function chunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([length, typeBytes, data, checksum]);
}

function mutate(bytes: Buffer, offset: number): Buffer {
  const changed = Buffer.from(bytes);
  changed[offset] ^= 1;
  return changed;
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
