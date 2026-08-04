import Database from 'better-sqlite3';

const databasePath = process.env.ARXIC_DB_PATH || './auth.db';

export const db = new Database(databasePath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    passwordHash TEXT NOT NULL,
    mfaSecret TEXT,
    locked INTEGER NOT NULL DEFAULT 0,
    failedAttempts INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS reset_tokens (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    expiresAt INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    createdAt INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS mfa_challenges (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    createdAt INTEGER NOT NULL
  );
`);

export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
  mfaSecret: string | null;
  locked: number;
  failedAttempts: number;
}

export function findUserByEmail(email: string): UserRecord | undefined {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email) as
    | UserRecord
    | undefined;
}

export function resetFixtureDatabase(): void {
  db.transaction(() => {
    db.prepare('DELETE FROM sessions').run();
    db.prepare('DELETE FROM mfa_challenges').run();
    db.prepare('DELETE FROM reset_tokens').run();
    db.prepare('DELETE FROM users').run();
  })();
}
