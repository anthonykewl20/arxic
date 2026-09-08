import { lookup } from 'node:dns/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runPreflightAttestation } from '..';

const nonce = 'localhost-origins-472';

/**
 * The reverse-proxy local-stack convention (Traefik/dokploy): the app is
 * published on <name>.localhost, which RFC 6761 §6.3 reserves to resolve to
 * the loopback interface. A valid local-test attestation served on such an
 * origin must pass the real target handshake — before issue #472 the origin
 * was misclassified production-looking and every such stack was untargetable.
 */
describe('real-world *.localhost target origin', () => {
  const temporaryDirectories: string[] = [];
  let server: Server;
  let origin: string;

  beforeAll(async () => {
    // Environment property this journey depends on, failed loudly instead of
    // surfacing as an unrelated network error: the resolver must map names
    // under .localhost to loopback only.
    const addresses = await lookup('stack.localhost', { all: true });
    const foreign = addresses.filter(({ address }) => address !== '127.0.0.1' && address !== '::1');
    if (foreign.length)
      throw new Error(
        `Resolver must map *.localhost to loopback (stack.localhost resolved to ${addresses
          .map(({ address }) => address)
          .join(', ')})`,
      );

    server = createServer((request, response) => {
      if (request.url !== '/.well-known/arxic-test-target.json') {
        response.statusCode = 404;
        response.end();
        return;
      }
      response.setHeader('content-type', 'application/json');
      response.end(
        JSON.stringify({
          environmentClass: 'local-test',
          origin,
          allowedOrigins: [origin],
          buildDigest: 'a'.repeat(64),
          nonce,
        }),
      );
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Could not allocate a port');
    origin = `http://stack.localhost:${address.port}`;
  }, 30_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await Promise.all(
      temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  it('accepts a valid local-test attestation served on a real *.localhost origin', async () => {
    const artifactsDir = await mkdtemp(join(tmpdir(), 'arxic-localhost-origins-'));
    temporaryDirectories.push(artifactsDir);
    const result = await runPreflightAttestation({
      targets: [{ id: 'stack-localhost', origin }],
      policy: {
        allowedOrigins: [origin],
        expectedNonce: nonce,
        now: () => '2026-09-08T00:00:00.000Z',
      },
      artifactsDir,
      now: () => '2026-09-08T00:01:00.000Z',
    });
    expect(result.refused).toEqual([]);
    expect(result.accepted).toEqual(['stack-localhost']);
    expect(result.results[0]).toMatchObject({
      origin,
      environmentClass: 'local-test',
      disposition: 'allowed',
    });
  });
});
