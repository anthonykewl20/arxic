import { sha256 } from '@arxic/contracts';
import { inspectPng } from '@arxic/playwright-screenshot-privacy';

export type ModelImage = Readonly<{
  mediaType: 'image/png';
  sha256: string;
  bytes: Uint8Array;
}>;
export type ModelImageMetadata = Readonly<{
  mediaType: 'image/png';
  sha256: string;
  bytes: number;
  width: number;
  height: number;
}>;
export type PreparedModelImage = ModelImage & { metadata: ModelImageMetadata };

/** Validates bounded canonical pixels and takes ownership before asynchronous provider work. */
export function prepareModelImages(
  input: readonly ModelImage[] | undefined,
): PreparedModelImage[] | undefined {
  if (input === undefined) return undefined;
  if (!Array.isArray(input) || input.length < 1 || input.length > 4)
    throw new Error('Image requests require 1–4 PNGs');
  let total = 0;
  return input.map((image) => {
    if (
      !image ||
      image.mediaType !== 'image/png' ||
      !(image.bytes instanceof Uint8Array) ||
      image.bytes.byteLength > 4 * 1024 * 1024 ||
      !/^[a-f0-9]{64}$/u.test(image.sha256)
    )
      throw new Error('Invalid model image');
    total += image.bytes.byteLength;
    if (total > 8 * 1024 * 1024) throw new Error('Model image payload exceeds its bound');
    const bytes = Buffer.from(image.bytes);
    if (sha256(bytes) !== image.sha256) throw new Error('Model image hash mismatch');
    const inspected = inspectPng(bytes);
    if (
      inspected.width > 4096 ||
      inspected.height > 4096 ||
      inspected.width * inspected.height > 4 * 1024 * 1024
    )
      throw new Error('Model image dimensions exceed their bound');
    return {
      mediaType: 'image/png',
      sha256: image.sha256,
      bytes,
      metadata: { mediaType: 'image/png', sha256: image.sha256, ...inspected },
    };
  });
}
