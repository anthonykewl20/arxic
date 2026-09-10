import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type Database from 'better-sqlite3';

/**
 * Runtime-entered credentials — provider keys and the sign-in identities visual
 * runs use to reach authorized pages. Values stay server-side: they are handed
 * to a run's launch environment and never reach the browser, a run record, the
 * action timeline or a screenshot.
 *
 * Records are encrypted at rest with AES-256-GCM, so a copied database file or
 * a backup does not disclose them. This protects the artifact, not the host: an
 * attacker who can already read this server's process memory or its key
 * material can still recover the values, and the dashboard says so rather than
 * implying otherwise.
 */
const PREFIX = 'v1:';
const KEY_FILE = 'vault.key';

/** Where the key comes from, so the operator can be told plainly. */
export type VaultKeySource = 'environment' | 'file';

function resolveKeyMaterial(directory: string, env: NodeJS.ProcessEnv) {
  const supplied = env.ARXIC_VAULT_KEY?.trim();
  if (supplied) return { material: supplied, source: 'environment' as const };
  // No operator-managed key: keep one beside the database, readable only by
  // this account, so encryption at rest works without a setup wall. Weaker
  // than an env-supplied key — the key travels with the data it protects.
  const path = join(directory, KEY_FILE);
  try {
    const existing = readFileSync(path, 'utf8').trim();
    if (existing) return { material: existing, source: 'file' as const, path };
  } catch {
    /* first run */
  }
  mkdirSync(dirname(path), { recursive: true });
  const generated = randomBytes(32).toString('base64');
  writeFileSync(path, generated, { mode: 0o600 });
  chmodSync(path, 0o600);
  return { material: generated, source: 'file' as const, path };
}

export class SecretStore {
  readonly keySource: VaultKeySource;
  readonly keyPath?: string;
  private readonly key: Buffer;

  constructor(
    private readonly db: Database.Database,
    directory: string,
    env: NodeJS.ProcessEnv = process.env,
  ) {
    db.exec(
      'CREATE TABLE IF NOT EXISTS provider_secrets (ref TEXT PRIMARY KEY, value TEXT NOT NULL)',
    );
    db.exec('CREATE TABLE IF NOT EXISTS vault_meta (id INTEGER PRIMARY KEY, salt TEXT NOT NULL)');
    const resolved = resolveKeyMaterial(directory, env);
    this.keySource = resolved.source;
    this.keyPath = 'path' in resolved ? resolved.path : undefined;
    // The salt is per-database, so the same operator key on two instances does
    // not produce the same ciphertext.
    const existing = db.prepare('SELECT salt FROM vault_meta WHERE id=1').get() as
      { salt: string } | undefined;
    const salt = existing?.salt ?? randomBytes(16).toString('base64');
    if (!existing) db.prepare('INSERT INTO vault_meta VALUES (1, ?)').run(salt);
    this.key = scryptSync(resolved.material, Buffer.from(salt, 'base64'), 32);
  }

  private encrypt(value: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return `${PREFIX}${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${body.toString('base64')}`;
  }

  /**
   * Rows written before encryption was introduced are stored as plain text and
   * are returned unchanged, so an upgrade never loses a working credential.
   * A row that fails authentication — a changed key, a truncated value — is
   * dropped rather than returned corrupt; the run then reports the credential
   * as missing instead of signing in with rubbish.
   */
  private decrypt(stored: string): string | undefined {
    if (!stored.startsWith(PREFIX)) return stored;
    const [iv, tag, body] = stored.slice(PREFIX.length).split(':');
    if (!iv || !tag || !body) return undefined;
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64'));
      decipher.setAuthTag(Buffer.from(tag, 'base64'));
      return Buffer.concat([
        decipher.update(Buffer.from(body, 'base64')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      return undefined;
    }
  }

  set(ref: string, value: string) {
    this.db
      .prepare(
        'INSERT INTO provider_secrets VALUES (?, ?) ON CONFLICT(ref) DO UPDATE SET value=excluded.value',
      )
      .run(ref, this.encrypt(value));
  }

  remove(ref: string) {
    this.db.prepare('DELETE FROM provider_secrets WHERE ref=?').run(ref);
  }

  /** Which refs hold a value. Names only — never the values. */
  refs(): string[] {
    return (
      this.db.prepare('SELECT ref FROM provider_secrets ORDER BY ref').all() as Array<{
        ref: string;
      }>
    ).map((row) => row.ref);
  }

  all(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {};
    for (const row of this.db.prepare('SELECT ref, value FROM provider_secrets').all() as Array<{
      ref: string;
      value: string;
    }>) {
      const value = this.decrypt(row.value);
      if (value !== undefined) env[row.ref] = value;
    }
    return env;
  }
}
