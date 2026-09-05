import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { fetchAttestation } from '../../../../packages/environment/src/service';
import { validateConfig } from '../config/validate';
import { LocalRunExecutor } from '../local-executor';
import { VALID_CONFIG } from './fixtures';

const servers: Server[] = [];
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(async (server) => {
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
    }),
  );
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function listen(server: Server): Promise<string> {
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected an ephemeral TCP port');
  return `http://127.0.0.1:${address.port}`;
}

describe('local executor attestation network boundary (refs #398)', () => {
  it('does not echo an unknown upstream response body in malformed attestation errors', async () => {
    const origin = await listen(createServer((_request, response) => response.end('Unknown398!')));
    await expect(fetchAttestation(origin)).rejects.toThrow(
      'Attestation endpoint returned invalid JSON',
    );
  });
  it('refuses a redirected attestation without sending a preflight request to the outside origin', async () => {
    let outsideRequests = 0;
    const outside = await listen(
      createServer((_request, response) => {
        outsideRequests += 1;
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ buildDigest: 'a'.repeat(64) }));
      }),
    );
    const origin = await listen(
      createServer((_request, response) => {
        response.writeHead(302, { location: `${outside}/collect` });
        response.end();
      }),
    );
    const directory = await mkdtemp(join(tmpdir(), 'arxic-attestation-egress-'));
    directories.push(directory);
    const result = await new LocalRunExecutor().execute(
      {
        runId: 'redirect-refusal',
        config: {
          ...VALID_CONFIG,
          source: { ...VALID_CONFIG.source, repository: directory, revision: 'a'.repeat(40) },
          target: { ...VALID_CONFIG.target, origin, allowedOrigins: [origin] },
          models: { provider: 'none', sourceRetention: 'disabled' },
        },
        runDirectory: join(directory, 'runs'),
        rulepacksDir: join(directory, 'rulepacks'),
      },
      { emit() {} },
    );
    expect(result.outcome).toBe('blocked');
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'ARXIC-ATTESTATION-FETCH-FAILED' }),
    );
    expect(outsideRequests).toBe(0);
  });

  it.each(['//outside.example/attestation', '/\\outside.example/attestation'])(
    'rejects an origin-escaping attestation path %j before execution',
    (attestationPath) => {
      expect(
        validateConfig({ ...VALID_CONFIG, target: { ...VALID_CONFIG.target, attestationPath } }),
      ).toMatchObject({
        ok: false,
        diagnostics: expect.arrayContaining([
          expect.objectContaining({
            code: 'ARXIC-CONFIG-INVALID',
            subject: 'config.target.attestationPath',
          }),
        ]),
      });
    },
  );

  it('uses the configured same-origin attestation endpoint for the actual gate', async () => {
    const requests: string[] = [];
    const origin = await listen(
      createServer((request, response) => {
        requests.push(request.url!);
        if (request.url !== '/test-attestation') {
          response.writeHead(404).end();
          return;
        }
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({
            environmentClass: 'local-test',
            origin,
            allowedOrigins: [origin],
            buildDigest: 'a'.repeat(64),
            nonce: 'custom-path-proof',
          }),
        );
      }),
    );
    const directory = await mkdtemp(join(tmpdir(), 'arxic-custom-attestation-'));
    directories.push(directory);
    const result = await new LocalRunExecutor().execute(
      {
        runId: 'custom-path',
        config: {
          ...VALID_CONFIG,
          source: { ...VALID_CONFIG.source, repository: directory, revision: 'a'.repeat(40) },
          target: {
            ...VALID_CONFIG.target,
            origin,
            allowedOrigins: [origin],
            attestationPath: '/test-attestation',
          },
          models: { provider: 'none', sourceRetention: 'disabled' },
        },
        runDirectory: join(directory, 'runs'),
        rulepacksDir: join(directory, 'rulepacks'),
      },
      { emit() {} },
    );
    expect(result.state.completedStages).toContain(0);
    expect(requests.slice(0, 2)).toEqual(['/test-attestation', '/test-attestation']);
    expect(requests).not.toContain('/.well-known/arxic-test-target.json');
  }, 30_000);
});
