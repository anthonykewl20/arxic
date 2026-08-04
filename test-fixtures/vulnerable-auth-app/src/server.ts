import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import bcrypt from 'bcryptjs';
import express, { type Request, type Response } from 'express';
import { db, findResetToken, findUserByEmail, resetFixtureDatabase } from './db.js';
import { sendResetEmail } from './mail.js';

interface SeedBody {
  personaId: string;
  email: string;
  password: string;
}

function isSeedBody(value: unknown): value is SeedBody {
  if (!value || typeof value !== 'object') return false;
  const body = value as Record<string, unknown>;
  return typeof body.personaId === 'string' && typeof body.email === 'string' && typeof body.password === 'string';
}

function originFor(request: Request): string {
  return process.env.ARXIC_TARGET_ORIGIN || `${request.protocol}://${request.get('host')}`;
}

export const app = express();
app.set('view engine', 'ejs');
app.set('views', resolve(process.cwd(), 'src/views'));
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

app.get('/', (request: Request, response: Response) => {
  response.render('index', { message: request.query.message ?? '', error: request.query.error ?? '' });
});

app.post('/login', async (request: Request, response: Response) => {
  const email = String(request.body.email ?? '').trim().toLowerCase();
  const password = String(request.body.password ?? '');
  const user = findUserByEmail(email);
  if (!user) {
    response.status(401).render('index', { message: '', error: 'No account with that email' });
    return;
  }
  if (!(await bcrypt.compare(password, user.passwordHash))) {
    response.status(401).render('index', { message: '', error: 'Incorrect password for that account' });
    return;
  }
  response.cookie('session', email, { httpOnly: false, sameSite: false, secure: false });
  response.redirect(302, '/?message=Logged%20in');
});

app.post('/logout', (_request: Request, response: Response) => {
  response.clearCookie('session');
  response.redirect(302, '/?message=Logged%20out');
});

app.post('/forgot', async (request: Request, response: Response) => {
  const email = String(request.body.email ?? '').trim().toLowerCase();
  const user = findUserByEmail(email);
  if (!user) {
    response.status(404).render('index', { message: '', error: 'No account with that email' });
    return;
  }
  const token = randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO reset_tokens (id, email, token, expiresAt) VALUES (?, ?, ?, ?)').run(
    randomUUID(),
    email,
    token,
    Date.now() + 7 * 24 * 60 * 60 * 1000,
  );
  await sendResetEmail(email, `${originFor(request)}/?token=${token}`);
  response.render('index', { message: 'A reset link has been sent to that account', error: '' });
});

app.post('/reset', async (request: Request, response: Response) => {
  const token = String(request.body.token ?? '');
  const password = String(request.body.password ?? '');
  const record = findResetToken(token);
  if (!record) {
    response.status(404).render('index', { message: '', error: 'That reset token does not exist' });
    return;
  }
  if (record.expiresAt <= Date.now()) {
    response.status(410).render('index', { message: '', error: 'That reset token has expired' });
    return;
  }
  const passwordHash = await bcrypt.hash(password, 12);
  db.prepare('UPDATE users SET passwordHash = ? WHERE email = ?').run(passwordHash, record.email);
  response.render('index', { message: 'Password reset successfully; this token remains reusable', error: '' });
});

app.post('/__arxic/seed', async (request: Request, response: Response) => {
  const body: unknown = request.body;
  if (!isSeedBody(body)) {
    response.status(400).json({ ok: false, error: 'Invalid seed payload' });
    return;
  }
  const passwordHash = await bcrypt.hash(body.password, 12);
  db.prepare(`
    INSERT INTO users (id, email, passwordHash) VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET email = excluded.email, passwordHash = excluded.passwordHash
  `).run(body.personaId, body.email.trim().toLowerCase(), passwordHash);
  response.status(201).json({ ok: true });
});

app.post('/__arxic/reset', (_request: Request, response: Response) => {
  resetFixtureDatabase();
  response.status(204).end();
});

app.get('/.well-known/arxic-test-target.json', (request: Request, response: Response) => {
  const origin = originFor(request);
  response.json({
    environmentClass: 'local-test',
    origin,
    allowedOrigins: [origin],
    buildDigest: createHash('sha256').update('vulnerable-auth-app@0.0.0').digest('hex'),
    nonce: process.env.ARXIC_ATTESTATION_NONCE || 'vulnerable-auth-app-fixture-v1',
  });
});

const port = Number(process.env.PORT || 3001);
app.listen(port, () => console.log(`[real-express] listening on http://localhost:${port}`));
