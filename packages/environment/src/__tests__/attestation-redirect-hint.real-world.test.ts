import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { EnvironmentHandshake } from '..';

/**
 * Issue #473: auth middleware that redirects /.well-known/arxic-test-target.json
 * to /login (the live mightybox shape) produced only "Attestation endpoint
 * returned HTTP 307" — no path, no remedy. The refusal disposition is correct;
 * the diagnostic must become actionable: name the exact path tried and state
 * the remedy (serve it without redirecting, or point attestationPath at the
 * served route, recipe in docs/attestation-for-your-app.md).
 */
let server: Server | undefined;

const stopServer = async () => {
  if (!server) return;
  server.close();
  await once(server, 'close');
  server = undefined;
};

const listen = async (target: Server) => {
  target.listen(0, '127.0.0.1');
  await once(target, 'listening');
  const address = target.address();
  if (!address || typeof address === 'string') throw new Error('Could not allocate test port');
  return `http://127.0.0.1:${address.port}`;
};

afterEach(stopServer);

describe('real-world attestation redirect/status hint (#473)', () => {
  it('names the exact attestation path and the remedy when auth middleware 307-redirects it to login', async () => {
    server = createServer((request, response) => {
      if (request.url === '/.well-known/arxic-test-target.json') {
        response.statusCode = 307;
        response.setHeader('location', '/login');
        response.end();
        return;
      }
      response.statusCode = 404;
      response.end();
    });
    const origin = await listen(server!);

    const result = await new EnvironmentHandshake().attest(
      { origin },
      { allowedOrigins: [origin], now: () => '2026-09-08T00:00:00.000Z' },
    );

    expect(result.disposition).toBe('refused');
    const message = result.diagnostics.map(({ message: text }) => text).join('\n');
    expect(message).toContain('/.well-known/arxic-test-target.json');
    expect(message).toContain('HTTP 307');
    expect(message).toMatch(/serve the attestation/u);
    expect(message).toContain('attestationPath');
    expect(message).toContain('docs/attestation-for-your-app.md');
  });

  it('sad path: a plain 404 keeps the refusal and carries the same actionable hint', async () => {
    server = createServer((_request, response) => {
      response.statusCode = 404;
      response.end();
    });
    const origin = await listen(server!);

    const result = await new EnvironmentHandshake().attest(
      { origin },
      { allowedOrigins: [origin], now: () => '2026-09-08T00:00:00.000Z' },
    );

    expect(result.disposition).toBe('refused');
    const message = result.diagnostics.map(({ message: text }) => text).join('\n');
    expect(message).toContain('/.well-known/arxic-test-target.json');
    expect(message).toContain('HTTP 404');
    expect(message).toContain('docs/attestation-for-your-app.md');
  });

  it('honors a configured attestationPath by naming that exact path in the hint', async () => {
    server = createServer((request, response) => {
      response.statusCode = request.url === '/health/attestation' ? 500 : 404;
      response.end();
    });
    const origin = await listen(server!);

    const result = await new EnvironmentHandshake().attest(
      { origin, attestationPath: '/health/attestation' },
      { allowedOrigins: [origin], now: () => '2026-09-08T00:00:00.000Z' },
    );

    expect(result.disposition).toBe('refused');
    const message = result.diagnostics.map(({ message: text }) => text).join('\n');
    expect(message).toContain('/health/attestation');
    expect(message).toContain('HTTP 500');
  });
});
