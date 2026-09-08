import type Database from 'better-sqlite3';

/** Provider credentials entered at runtime. Values stay server-side and never reach the browser. */
export class SecretStore {
  constructor(private readonly db: Database.Database) {
    db.exec(
      'CREATE TABLE IF NOT EXISTS provider_secrets (ref TEXT PRIMARY KEY, value TEXT NOT NULL)',
    );
  }
  set(ref: string, value: string) {
    this.db
      .prepare(
        'INSERT INTO provider_secrets VALUES (?, ?) ON CONFLICT(ref) DO UPDATE SET value=excluded.value',
      )
      .run(ref, value);
  }
  remove(ref: string) {
    this.db.prepare('DELETE FROM provider_secrets WHERE ref=?').run(ref);
  }
  all(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {};
    for (const row of this.db.prepare('SELECT ref, value FROM provider_secrets').all() as Array<{
      ref: string;
      value: string;
    }>)
      env[row.ref] = row.value;
    return env;
  }
}
