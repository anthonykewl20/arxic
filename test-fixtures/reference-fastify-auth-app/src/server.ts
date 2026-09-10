import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyJwt from '@fastify/jwt';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { createUser, findUserByEmail } from './db.js';
import { sendWelcomeMail } from './mail.js';

type Credentials = { email: string; password: string };

const app = Fastify({ logger: false });

app.register(fastifyCookie);
app.register(fastifyJwt, {
  secret: process.env.ARXIC_FASTIFY_JWT_SECRET ?? 'reference-only-secret',
});

app.post('/register', async (request: FastifyRequest<{ Body: Credentials }>, reply: FastifyReply) => {
  const email = request.body.email;
  const password = request.body.password;
  if (findUserByEmail(email)) {
    reply.code(409);
    return { error: 'already registered' };
  }
  const passwordSalt = randomBytes(16).toString('hex');
  const passwordHash = scryptSync(password, passwordSalt, 64).toString('hex');
  createUser({ email, passwordHash, passwordSalt });
  await sendWelcomeMail(email);
  const token = app.jwt.sign({ email });
  reply.setCookie('session', token, { httpOnly: true, path: '/', sameSite: 'lax' });
  reply.code(201);
  return { ok: true };
});

app.post('/login', async (request: FastifyRequest<{ Body: Credentials }>, reply: FastifyReply) => {
  const email = request.body.email;
  const password = request.body.password;
  const user = findUserByEmail(email);
  if (!user) {
    reply.code(401);
    return { error: 'invalid credentials' };
  }
  const expected = Buffer.from(user.passwordHash, 'hex');
  const supplied = scryptSync(password, Buffer.from(user.passwordSalt, 'hex'), 64);
  if (!timingSafeEqual(expected, supplied)) {
    reply.code(401);
    return { error: 'invalid credentials' };
  }
  const token = app.jwt.sign({ email: user.email });
  reply.setCookie('session', token, { httpOnly: true, path: '/', sameSite: 'lax' });
  return { ok: true };
});

app.post('/logout', async (request, reply) => {
  reply.clearCookie('session', { path: '/' });
  return { ok: true };
});

app.get('/me', async (request, reply) => {
  await request.jwtVerify();
  return { email: (request.user as { email: string }).email };
});

const port = Number(process.env.PORT ?? 34010);
app.listen({ port, host: '127.0.0.1' });
