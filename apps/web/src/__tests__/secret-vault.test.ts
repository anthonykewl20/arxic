import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, expect, it } from 'vitest';
import { SecretStore } from '../secret-store';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});

async function open(env: NodeJS.ProcessEnv = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'arxic-vault-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const db = new Database(join(directory, 'vault.sqlite'));
  cleanup.push(async () => {
    db.close();
  });
  return { directory, db, store: new SecretStore(db, directory, env) };
}

/** Read the row exactly as the database holds it, bypassing the store. */
const stored = (db: Database.Database, ref: string) =>
  (
    db.prepare('SELECT value FROM provider_secrets WHERE ref=?').get(ref) as
      { value: string } | undefined
  )?.value;

it('never writes a credential to the database in plain text', async () => {
  const { db, store } = await open({ ARXIC_VAULT_KEY: 'operator-supplied-key' });
  store.set('ARXIC_SECRET_LOGIN_PASSWORD', 'correct horse battery staple');
  const row = stored(db, 'ARXIC_SECRET_LOGIN_PASSWORD')!;
  expect(row).not.toContain('correct horse battery staple');
  expect(row.startsWith('v1:')).toBe(true);
  // iv : tag : ciphertext, each base64.
  expect(row.slice(3).split(':')).toHaveLength(3);
  expect(store.all().ARXIC_SECRET_LOGIN_PASSWORD).toBe('correct horse battery staple');
});

it('keeps the ciphertext out of every file in the state directory', async () => {
  const { directory, store } = await open({ ARXIC_VAULT_KEY: 'operator-supplied-key' });
  store.set('ARXIC_SECRET_LOGIN_EMAIL', 'operator@example.test');
  for (const name of await readdir(directory)) {
    const bytes = await readFile(join(directory, name));
    expect(bytes.includes('operator@example.test'), name).toBe(false);
  }
});

it('reports a credential as missing rather than returning it corrupt under a different key', async () => {
  const { directory, db, store } = await open({ ARXIC_VAULT_KEY: 'first-key' });
  store.set('ARXIC_SECRET_LOGIN_PASSWORD', 'value-under-first-key');
  expect(store.all().ARXIC_SECRET_LOGIN_PASSWORD).toBe('value-under-first-key');
  // A rotated or mistyped key must not sign a run in with rubbish: the ref
  // resolves to nothing, so the run blocks on a missing credential instead.
  const rotated = new SecretStore(db, directory, { ARXIC_VAULT_KEY: 'second-key' });
  expect(rotated.all().ARXIC_SECRET_LOGIN_PASSWORD).toBeUndefined();
  expect(rotated.refs()).toEqual(['ARXIC_SECRET_LOGIN_PASSWORD']);
});

it('rejects a record whose authentication tag no longer matches its ciphertext', async () => {
  const { db, store } = await open({ ARXIC_VAULT_KEY: 'operator-supplied-key' });
  store.set('ARXIC_SECRET_LOGIN_PASSWORD', 'value-before-tampering');
  const [iv, tag, body] = stored(db, 'ARXIC_SECRET_LOGIN_PASSWORD')!.slice(3).split(':');
  const flipped = Buffer.from(body!, 'base64');
  flipped[0] ^= 0xff;
  db.prepare('UPDATE provider_secrets SET value=? WHERE ref=?').run(
    `v1:${iv}:${tag}:${flipped.toString('base64')}`,
    'ARXIC_SECRET_LOGIN_PASSWORD',
  );
  expect(store.all().ARXIC_SECRET_LOGIN_PASSWORD).toBeUndefined();
});

it('still resolves rows written before encryption existed', async () => {
  const { directory, db } = await open({ ARXIC_VAULT_KEY: 'operator-supplied-key' });
  db.exec(
    'CREATE TABLE IF NOT EXISTS provider_secrets (ref TEXT PRIMARY KEY, value TEXT NOT NULL)',
  );
  db.prepare('INSERT INTO provider_secrets VALUES (?, ?)').run(
    'ARXIC_SECRET_LEGACY',
    'written-before-the-vault',
  );
  const store = new SecretStore(db, directory, { ARXIC_VAULT_KEY: 'operator-supplied-key' });
  expect(store.all().ARXIC_SECRET_LEGACY).toBe('written-before-the-vault');
  // Rewriting it upgrades the record in place.
  store.set('ARXIC_SECRET_LEGACY', 'written-before-the-vault');
  expect(stored(db, 'ARXIC_SECRET_LEGACY')!.startsWith('v1:')).toBe(true);
});

it('generates an owner-only key file when the operator supplies no key, and reuses it', async () => {
  const { directory, db, store } = await open();
  expect(store.keySource).toBe('file');
  expect(store.keyPath).toBe(join(directory, 'vault.key'));
  store.set('ARXIC_SECRET_LOGIN_PASSWORD', 'value-under-generated-key');
  expect((await stat(join(directory, 'vault.key'))).mode & 0o777).toBe(0o600);
  // A later process on the same directory reads the same key back.
  const reopened = new SecretStore(db, directory, {});
  expect(reopened.all().ARXIC_SECRET_LOGIN_PASSWORD).toBe('value-under-generated-key');
});

it('prefers an operator-supplied key over the generated file', async () => {
  const { directory, db } = await open();
  await writeFile(join(directory, 'vault.key'), 'file-key');
  const store = new SecretStore(db, directory, { ARXIC_VAULT_KEY: 'environment-key' });
  expect(store.keySource).toBe('environment');
  expect(store.keyPath).toBeUndefined();
});

it('gives two databases different ciphertext for the same key and value', async () => {
  const one = await open({ ARXIC_VAULT_KEY: 'shared-operator-key' });
  const two = await open({ ARXIC_VAULT_KEY: 'shared-operator-key' });
  one.store.set('ARXIC_SECRET_LOGIN_PASSWORD', 'identical-value');
  two.store.set('ARXIC_SECRET_LOGIN_PASSWORD', 'identical-value');
  expect(stored(one.db, 'ARXIC_SECRET_LOGIN_PASSWORD')).not.toBe(
    stored(two.db, 'ARXIC_SECRET_LOGIN_PASSWORD'),
  );
  expect(one.store.all().ARXIC_SECRET_LOGIN_PASSWORD).toBe('identical-value');
  expect(two.store.all().ARXIC_SECRET_LOGIN_PASSWORD).toBe('identical-value');
});

it('lists reference names without disclosing any value', async () => {
  const { store } = await open({ ARXIC_VAULT_KEY: 'operator-supplied-key' });
  store.set('ARXIC_SECRET_B', 'second');
  store.set('ARXIC_SECRET_A', 'first');
  expect(store.refs()).toEqual(['ARXIC_SECRET_A', 'ARXIC_SECRET_B']);
  expect(JSON.stringify(store.refs())).not.toContain('first');
  store.remove('ARXIC_SECRET_A');
  expect(store.refs()).toEqual(['ARXIC_SECRET_B']);
});

// ---------------------------------------------------------------------------
// Credential inventory: what the dashboard is allowed to learn about a secret.
// ---------------------------------------------------------------------------

async function workbench() {
  const { Workbench } = await import('../workbench');
  const directory = await mkdtemp(join(tmpdir(), 'arxic-vault-wb-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const root = resolve(import.meta.dirname, '../../../..');
  const wb = await Workbench.open(directory, [root]);
  cleanup.push(() => wb.close());
  return { wb, root };
}

it('reports which references a project needs, where each is used, and never their values', async () => {
  const { wb, root } = await workbench();
  await wb.saveProject({
    name: 'Signed-in project',
    folder: root,
    origin: 'http://127.0.0.1:1',
    paths: ['/'],
    viewports: [{ width: 1280, height: 800 }],
    masks: [],
    captureConsent: true,
    pageMode: 'manual',
    recordVideo: false,
    maxPages: 5,
    maxDepth: 1,
    configPath: '',
    cron: '',
    scheduleMode: 'discovery',
    paused: false,
    login: {
      loginPath: '/login',
      emailRef: 'ARXIC_SECRET_SITE_EMAIL',
      passwordRef: 'ARXIC_SECRET_SITE_PASSWORD',
      emailLabel: 'Email',
      passwordLabel: 'Password',
      submitLabel: 'Sign in',
    },
  });

  const before = wb.credentialInventory();
  expect(before.credentials.map((item) => [item.ref, item.status])).toEqual([
    ['ARXIC_SECRET_SITE_EMAIL', 'missing'],
    ['ARXIC_SECRET_SITE_PASSWORD', 'missing'],
  ]);
  expect(before.credentials[0]!.uses).toEqual(['Signed-in project · sign-in email']);

  const after = await wb.saveSecret({
    ref: 'ARXIC_SECRET_SITE_PASSWORD',
    value: 'never-leaves-the-server',
  });
  expect(after.credentials.find((item) => item.ref.endsWith('PASSWORD'))!.status).toBe('vault');
  // The value must not appear anywhere in what the browser receives.
  expect(JSON.stringify(after)).not.toContain('never-leaves-the-server');
  expect(JSON.stringify(wb.state())).not.toContain('never-leaves-the-server');
  // It does reach a run's launch environment — that is the whole point.
  expect(wb.effectiveEnv().ARXIC_SECRET_SITE_PASSWORD).toBe('never-leaves-the-server');

  const removed = await wb.removeSecret({ ref: 'ARXIC_SECRET_SITE_PASSWORD' });
  expect(removed.credentials.find((item) => item.ref.endsWith('PASSWORD'))!.status).toBe('missing');
});

it('refuses a reference that is not an ARXIC_SECRET_ name, and an empty value', async () => {
  const { wb } = await workbench();
  await expect(wb.saveSecret({ ref: 'PATH', value: 'x' })).rejects.toThrow(/ARXIC_SECRET_/);
  await expect(wb.saveSecret({ ref: 'ARXIC_SECRET_OK', value: '' })).rejects.toThrow(
    /between 1 and 5000/,
  );
});
