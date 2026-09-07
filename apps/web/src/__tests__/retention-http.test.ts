import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { startWorkbench } from '../server';
it('requires an authenticated same-origin administrator for retention changes and exposes a disabled preview', async () => {
  const root = await mkdtemp(join(tmpdir(), 'arxic-retention-http-'));
  const app = await startWorkbench({
    roots: [root],
    stateDirectory: join(root, 'state'),
    port: 0,
    adminToken: 'retention-test-token-at-least-32-characters',
  });
  try {
    expect((await fetch(app.origin + '/api/retention')).status).toBe(401);
    const session = await fetch(app.origin + '/api/session', {
      method: 'POST',
      headers: { origin: app.origin, 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'retention-test-token-at-least-32-characters' }),
    });
    const cookie = session.headers.get('set-cookie')!.split(';')[0];
    expect((await fetch(app.origin + '/api/retention', { headers: { cookie } })).status).toBe(200);
    const post = (path: string, body: unknown, origin = app.origin) =>
      fetch(app.origin + path, {
        method: 'POST',
        headers: { cookie, origin, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    const policy = { enabled: true, maxAgeDays: 30, keepLatest: 1 };
    expect((await post('/api/retention', policy, 'https://elsewhere.invalid')).status).toBe(403);
    expect((await post('/api/retention', policy)).status).toBe(400);
    expect((await post('/api/retention/cleanup', {})).status).toBe(409);
    const preview = await post('/api/retention/preview', { ...policy, enabled: false });
    expect(preview.status).toBe(200);
    expect(await preview.json()).toMatchObject({ total: 0, candidateCount: 0, candidates: [] });
    expect((await post('/api/retention', { ...policy, confirmDeletion: true })).status).toBe(200);
    expect((await post('/api/retention/cleanup', { unknown: true })).status).toBe(400);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
