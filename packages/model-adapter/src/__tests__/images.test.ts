import { expect, it } from 'vitest';
import { ModelAdapter } from '..';
import { adapterRequest, BEARER_TOKEN, completion, startStub, validOutput } from './stub';

it('refuses malformed image evidence before contacting the model provider', async () => {
  const stub = await startStub(() => ({ completion: completion(JSON.stringify(validOutput())) }));
  try {
    const result = await new ModelAdapter({
      baseUrl: stub.baseUrl,
      credentials: BEARER_TOKEN,
    }).requestStructuredOutput({
      ...adapterRequest(),
      images: [{ mediaType: 'image/png', bytes: Buffer.from('not a PNG'), sha256: 'a'.repeat(64) }],
    });
    expect(result).toMatchObject({
      ok: false,
      diagnostics: [expect.objectContaining({ code: 'ARXIC-MODEL-IMAGE-INVALID' })],
    });
    expect(stub.requests).toHaveLength(0);
  } finally {
    await stub.close();
  }
});

it.each([
  [],
  Array.from({ length: 5 }, () => ({
    mediaType: 'image/png',
    bytes: Buffer.from('png'),
    sha256: 'a'.repeat(64),
  })),
  [{ mediaType: 'image/jpeg', bytes: Buffer.from('jpeg'), sha256: 'a'.repeat(64) }],
  [{ mediaType: 'image/png', bytes: Buffer.alloc(4 * 1024 * 1024 + 1), sha256: 'a'.repeat(64) }],
  [{ mediaType: 'image/png', bytes: Buffer.from('png'), sha256: '../image' }],
])(
  'rejects malformed or unbounded image input before resolving credentials (%#)',
  async (...images) => {
    let called = false;
    const result = await new ModelAdapter({
      baseUrl: 'unused',
      credentials: () => {
        called = true;
        return 'never-used';
      },
    }).requestStructuredOutput({ ...adapterRequest(), images: images as never });
    expect(result).toMatchObject({
      ok: false,
      diagnostics: [expect.objectContaining({ code: 'ARXIC-MODEL-IMAGE-INVALID' })],
    });
    expect(called).toBe(false);
  },
);
