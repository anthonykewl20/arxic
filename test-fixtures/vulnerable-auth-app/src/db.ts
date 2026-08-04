import Database from 'better-sqlite3';

const databasePath = process.env.ARXIC_DB_PATH || './auth.db';

export const db = new Database(databasePath);

db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    passwordHash TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS reset_tokens (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    token TEXT NOT NULL,
    expiresAt INTEGER NOT NULL
  );
`);

export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
}

export interface ResetTokenRecord {
  id: string;
  email: string;
  token: string;
  expiresAt: number;
}

export function findUserByEmail(email: string): UserRecord | undefined {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email) as UserRecord | undefined;
}

export function findResetToken(token: string): ResetTokenRecord | undefined {
  return db.prepare('SELECT * FROM reset_tokens WHERE token = ?').get(token) as ResetTokenRecord | undefined;
}

export function resetFixtureDatabase(): void {
  db.transaction(() => {
    db.prepare('DELETE FROM reset_tokens').run();
    db.prepare('DELETE FROM users').run();
  })();
}
