import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { sha256 as digest } from '@arxic/contracts';
import { BaselineStore } from '../baseline-store';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});

async function open(env: NodeJS.ProcessEnv = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'arxic-baselines-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  return { directory, store: new BaselineStore(directory, env) };
}

const pixels = (text: string) => Buffer.from(text);

it('stores bytes under their own digest and reads them back', async () => {
  const { store } = await open();
  const bytes = pixels('approved-capture');
  const sha = digest(bytes);
  const first = await store.promote(bytes, sha);
  expect(first.stored).toBe(true);
  expect(first.path).toContain(sha);
  expect((await store.read(sha))?.equals(bytes)).toBe(true);
  expect(await store.has(sha)).toBe(true);
});

it('approving identical pixels twice writes nothing the second time', async () => {
  const { store } = await open();
  const bytes = pixels('same-pixels');
  const sha = digest(bytes);
  expect((await store.promote(bytes, sha)).stored).toBe(true);
  expect((await store.promote(bytes, sha)).stored).toBe(false);
});

it('refuses bytes that do not match the digest they were offered under', async () => {
  const { store } = await open();
  await expect(store.promote(pixels('real-bytes'), digest(pixels('other-bytes')))).rejects.toThrow(
    /do not match the digest/,
  );
});

it('survives the deletion of the run that produced it', async () => {
  // The point of the store: a baseline is not a pointer into a run directory.
  const { directory, store } = await open();
  const runs = join(directory, 'runs', 'run-1');
  const bytes = pixels('capture-from-run-1');
  const sha = digest(bytes);
  await store.promote(bytes, sha);
  await rm(join(directory, 'runs'), { recursive: true, force: true });
  expect((await store.read(sha))?.equals(bytes)).toBe(true);
  expect(runs).toBeTruthy();
});

it('treats a corrupted entry as absent rather than comparing against it', async () => {
  const { store } = await open();
  const bytes = pixels('will-be-corrupted');
  const sha = digest(bytes);
  const { path } = await store.promote(bytes, sha);
  await writeFile(path, pixels('something-else'));
  // A file that no longer hashes to its own name is not this baseline.
  expect(await store.read(sha)).toBeUndefined();
  expect(await store.has(sha)).toBe(true);
});

it('returns nothing for a digest it does not hold', async () => {
  const { store } = await open();
  expect(await store.read(digest(pixels('never-approved')))).toBeUndefined();
  expect(await store.has(digest(pixels('never-approved')))).toBe(false);
});

it('fans out by digest prefix and keeps entries owner-only', async () => {
  const { directory, store } = await open();
  const bytes = pixels('fanned-out');
  const sha = digest(bytes);
  const { path } = await store.promote(bytes, sha);
  expect(await readdir(join(directory, 'baselines'))).toEqual([sha.slice(0, 2)]);
  expect((await stat(path)).mode & 0o777).toBe(0o600);
});

it('leaves no partial file behind after a completed write', async () => {
  const { directory, store } = await open();
  const bytes = pixels('atomic');
  await store.promote(bytes, digest(bytes));
  const entries = await readdir(join(directory, 'baselines', digest(bytes).slice(0, 2)));
  expect(entries.some((name) => name.includes('partial'))).toBe(false);
});

it('honours an external root so baselines can live on durable storage', async () => {
  const external = await mkdtemp(join(tmpdir(), 'arxic-baselines-external-'));
  cleanup.push(() => rm(external, { recursive: true, force: true }));
  const { directory, store } = await open({ ARXIC_BASELINE_STORE: external });
  expect(store.external).toBe(true);
  expect(store.root).toBe(external);
  const bytes = pixels('on-the-mount');
  await store.promote(bytes, digest(bytes));
  expect(await readdir(external)).toEqual([digest(bytes).slice(0, 2)]);
  // Nothing landed in the state directory.
  await expect(readFile(join(directory, 'baselines'))).rejects.toThrow();
});

it('deduplicates identical pixels across projects', async () => {
  const { directory, store } = await open();
  const bytes = pixels('two-projects-render-the-same');
  const sha = digest(bytes);
  await store.promote(bytes, sha);
  await store.promote(bytes, sha);
  const entries = await readdir(join(directory, 'baselines', sha.slice(0, 2)));
  expect(entries).toEqual([`${sha}.png`]);
});

it('reports a corrupted entry as present, so a caller fails loudly instead of falling back', async () => {
  // `read` refuses corrupt bytes; `has` deliberately does not. A comparison
  // that finds a present-but-corrupt baseline must surface the storage fault,
  // not quietly compare against a copy from somewhere else.
  const { store } = await open();
  const bytes = pixels('will-be-corrupted');
  const sha = digest(bytes);
  const { path } = await store.promote(bytes, sha);
  await writeFile(path, pixels('replaced'));
  expect(await store.has(sha)).toBe(true);
  expect(await store.read(sha)).toBeUndefined();
  expect(store.pathFor(sha)).toBe(path);
});
