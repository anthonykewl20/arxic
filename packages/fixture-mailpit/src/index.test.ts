import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, test } from 'vitest';
import {
  ARXIC_FIXTURE_INBOX_MISSING,
  ARXIC_FIXTURE_UNKNOWN_DB,
  InboxAdapter,
  PersonaProvisioner,
} from './index';

const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

describe('fixture service sad paths', () => {
  test('does not fabricate a missing Mailpit message', async () => {
    const origin = await serve((_request, response) => {
      response.setHeader('content-type', 'application/json');
      response.end('{"messages":[]}');
    });
    const adapter = new InboxAdapter({ smtp: origin, api: origin });
    const lease = await adapter.provision({
      kind: 'inbox',
      parameters: { recipient: 'missing@example.test' },
    });
    await expect(adapter.readLatest(lease)).rejects.toMatchObject({
      diagnostic: { code: ARXIC_FIXTURE_INBOX_MISSING, severity: 'blocked' },
    });
  });

  test('blocks multiple Mailpit messages with no distinguishable latest result', async () => {
    const origin = await serve((request, response) => {
      response.setHeader('content-type', 'application/json');
      response.end(
        request.url?.startsWith('/api/v1/search')
          ? '{"messages":[{"ID":"one","Created":"2026-08-06T00:00:00Z"},{"ID":"two","Created":"2026-08-06T00:00:00Z"}]}'
          : '{}',
      );
    });
    const adapter = new InboxAdapter({ smtp: origin, api: origin });
    const lease = await adapter.provision({
      kind: 'inbox',
      parameters: { recipient: 'ambiguous@example.test' },
    });
    await expect(adapter.readLatest(lease)).rejects.toMatchObject({
      diagnostic: { code: ARXIC_FIXTURE_INBOX_MISSING, severity: 'blocked' },
    });
  });

  test('blocks persona provisioning when the target lacks the seed API', async () => {
    const origin = await serve((_request, response) => {
      response.statusCode = 404;
      response.end();
    });
    const adapter = new PersonaProvisioner({ origin });
    await expect(
      adapter.provision({
        kind: 'persona',
        parameters: {
          personaId: 'u1',
          email: 'user@example.test',
          password: 'NotPersisted1!',
        },
      }),
    ).rejects.toMatchObject({
      diagnostic: { code: ARXIC_FIXTURE_UNKNOWN_DB, severity: 'blocked' },
    });
  });

  test('refuses production-looking Mailpit and persona origins', () => {
    expect(
      () =>
        new InboxAdapter({ smtp: 'smtp://smtp.example.com:1025', api: 'https://mail.example.com' }),
    ).toThrow('not an approved test origin');
    expect(() => new PersonaProvisioner({ origin: 'https://accounts.example.com' })).toThrow(
      'not an approved test origin',
    );
  });

  test('accepts an allowlisted IPv6 loopback origin', () => {
    expect(
      () => new InboxAdapter({ smtp: 'smtp://[::1]:1025', api: 'http://[::1]:8025' }),
    ).not.toThrow();
    expect(() => new PersonaProvisioner({ origin: 'http://[::1]:3000' })).not.toThrow();
  });

  test('reaps mailbox messages expired before the supplied coordinator clock', async () => {
    let requested = '';
    const origin = await serve((request, response) => {
      requested = request.url ?? '';
      response.end();
    });

    await new InboxAdapter({ smtp: origin, api: origin }).reapExpired(
      [
        {
          id: 'expired-inbox',
          requirement: { kind: 'inbox', parameters: { recipient: 'expired@example.test' } },
        },
      ],
      new Date('2026-08-15T12:34:56.000Z'),
    );

    expect(requested).toBe(
      '/api/v1/search?query=to%3Aexpired%40example.test%20before%3A%222026%2F08%2F15%2012%3A34%3A56%22',
    );
  });
});

async function serve(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<string> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  closers.push(
    () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  return `http://127.0.0.1:${address.port}`;
}
