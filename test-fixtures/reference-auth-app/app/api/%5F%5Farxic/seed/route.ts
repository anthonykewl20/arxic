import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { NextResponse } from 'next/server';
import { db } from '../../../../lib/db';

interface SeedBody { personaId: string; email: string; password: string; mfaSecret?: string }

function isSeedBody(value: unknown): value is SeedBody {
  if (!value || typeof value !== 'object') return false;
  const body = value as Record<string, unknown>;
  return typeof body.personaId === 'string' && typeof body.email === 'string' && typeof body.password === 'string';
}

export async function POST(request: Request): Promise<NextResponse> {
  const body: unknown = await request.json().catch(() => null);
  if (!isSeedBody(body)) return NextResponse.json({ ok: false, error: 'Invalid seed payload' }, { status: 400 });
  const email = body.email.trim().toLowerCase();
  const passwordHash = await bcrypt.hash(body.password, 12);
  db.prepare(`
    INSERT INTO users (id, email, passwordHash, mfaSecret, locked, failedAttempts)
    VALUES (?, ?, ?, ?, 0, 0)
    ON CONFLICT(id) DO UPDATE SET
      email = excluded.email, passwordHash = excluded.passwordHash,
      mfaSecret = excluded.mfaSecret, locked = 0, failedAttempts = 0
  `).run(body.personaId || randomUUID(), email, passwordHash, body.mfaSecret ?? null);
  return NextResponse.json({ ok: true }, { status: 201 });
}
