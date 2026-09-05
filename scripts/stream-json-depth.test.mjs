import { createRequire } from 'node:module';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { expect, it } from 'vitest';

const adapterRequire = createRequire(
  new URL('../packages/crawlee-adapter/package.json', import.meta.url),
);
const crawleeRequire = createRequire(adapterRequire.resolve('crawlee'));
const coreRequire = createRequire(crawleeRequire.resolve('@crawlee/core'));
const { parser } = coreRequire('stream-json');
const { stringer } = coreRequire('stream-json/Stringer');
const { serializeArray, deserializeArray } = coreRequire('./serialization');

async function filtered(document, kind, filter) {
  const Filter = coreRequire(`stream-json/filters/${kind}`);
  const chunks = [];
  await pipeline(
    Readable.from([document]),
    parser({ streamValues: false }),
    new Filter({ filter }),
    stringer({ useValues: true }),
    new Writable({
      write(value, _encoding, next) {
        chunks.push(value);
        next();
      },
    }),
  );
  return Buffer.concat(chunks).toString();
}

it.each(['Pick', 'Ignore', 'Filter', 'Replace'])(
  'refuses excessive %s path-filter nesting through the installed stream API',
  async (kind) => {
    for (const filter of ['data', /^data$/u]) {
      for (const document of [
        '{"meta":'.repeat(2048) + '1' + '}'.repeat(2048),
        '['.repeat(2048) + '1' + ']'.repeat(2048),
      ])
        await expect(filtered(document, kind, filter)).rejects.toThrow('maximum depth of 1024');
    }
  },
);

it('accepts the 1024-level boundary and rejects the next path level', async () => {
  await expect(
    filtered('{"meta":'.repeat(1024) + '1' + '}'.repeat(1024), 'Pick', 'data'),
  ).resolves.toBe('');
  await expect(
    filtered('{"meta":'.repeat(1025) + '1' + '}'.repeat(1025), 'Pick', 'data'),
  ).rejects.toThrow(RangeError);
});

it.each([
  ['Pick', '[{"name":"日本"}]'],
  ['Ignore', '{"meta":{"count":1}}'],
  ['Filter', '{"data":[{"name":"日本"}]}'],
  ['Replace', '{"data":null,"meta":{"count":1}}'],
])('preserves ordinary %s filter output', async (kind, expected) => {
  expect(await filtered('{"data":[{"name":"日本"}],"meta":{"count":1}}', kind, 'data')).toBe(
    expected,
  );
});

it('preserves the actual Crawlee compressed-request serialization and StreamArray reader', async () => {
  const requests = [
    {
      url: 'http://127.0.0.1/login',
      uniqueKey: 'login',
      userData: { title: '日本', flags: [true, false] },
    },
  ];
  const compressed = await serializeArray(requests);
  expect(await deserializeArray(compressed)).toEqual(requests);
});
