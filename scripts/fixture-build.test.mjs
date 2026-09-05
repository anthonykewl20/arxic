import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';

const execute = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const fixtureRequire = createRequire(
  new URL('../test-fixtures/reference-auth-app/package.json', import.meta.url),
);
const Database = fixtureRequire('better-sqlite3');

it('builds the real reference app without opening or changing its locked runtime database', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'arxic-build-db-'));
  const databasePath = join(directory, 'runtime.sqlite');
  const db = new Database(databasePath);
  try {
    db.exec(
      "CREATE TABLE release_marker(value TEXT); INSERT INTO release_marker VALUES ('unchanged'); BEGIN EXCLUSIVE",
    );
    await execute('pnpm', ['--filter', 'reference-auth-app', 'build'], {
      cwd: root,
      env: { ...process.env, ARXIC_DB_PATH: databasePath },
      timeout: 180_000,
    });
    expect(db.prepare('SELECT value FROM release_marker').pluck().get()).toBe('unchanged');
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").pluck().all()).toEqual(
      ['release_marker'],
    );
  } finally {
    if (db.inTransaction) db.exec('ROLLBACK');
    db.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 190_000);
