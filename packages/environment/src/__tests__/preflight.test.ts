import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type RequestListener, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runPreflightAttestation, type AttestationPolicy } from '..';

const servers: Server[] = [];
const directories: string[] = [];
const nonce = 'preflight-fixture-nonce';
const digest = createHash('sha256').update('preflight-build').digest('hex');
const now = () => '2026-08-05T15:00:00.000Z';

async function serve(handler: RequestListener): Promise<{ server: Server; origin: string }> {
  const server = createServer(handler);
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not allocate a port');
  return { server, origin: `http://127.0.0.1:${address.port}` };
}

async function artifactsDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'arxic-preflight-'));
  directories.push(directory);
  return directory;
}

const policy = (origin: string): AttestationPolicy => ({
  allowedOrigins: [origin],
  expectedNonce: nonce,
});

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolveClose) => server.close(() => resolveClose()))),
  );
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe('preflight attestation sad paths', () => {
  it('records a production-styled target as refused with blocked diagnostics', async () => {
    let origin = '';
    await serve((_request, response) => {
      response.setHeader('content-type', 'application/json');
      response.end(
        JSON.stringify({
          environmentClass: 'production',
          origin,
          allowedOrigins: [origin],
          buildDigest: digest,
          nonce,
        }),
      );
    }).then((served) => {
      origin = served.origin;
    });

    const result = await runPreflightAttestation({
      targets: [{ id: 'production', origin }],
      policy: policy(origin),
      artifactsDir: await artifactsDir(),
      now,
    });

    expect(result.accepted).not.toContain('production');
    expect(result.refused).toEqual(['production']);
    expect(result.results).toMatchObject([
      { id: 'production', environmentClass: 'production', disposition: 'refused' },
    ]);
    expect(result.diagnostics.every(({ severity }) => severity === 'blocked')).toBe(true);
    expect(JSON.parse(await readFile(result.artifactPath, 'utf8'))).toMatchObject({
      targets: [{ id: 'production', disposition: 'refused' }],
    });
  });

  it('records malformed attestation as refused with blocked diagnostics', async () => {
    const { origin } = await serve((_request, response) => {
      response.setHeader('content-type', 'text/plain');
      response.end('not-json');
    });
    const result = await runPreflightAttestation({
      targets: [{ id: 'malformed', origin }],
      policy: policy(origin),
      artifactsDir: await artifactsDir(),
      now,
    });

    expect(result).toMatchObject({
      accepted: [],
      refused: ['malformed'],
      results: [{ id: 'malformed', environmentClass: 'unknown', disposition: 'refused' }],
      diagnostics: [{ code: 'ARXIC-ATTESTATION-FETCH-FAILED', severity: 'blocked' }],
    });
    expect(JSON.parse(await readFile(result.artifactPath, 'utf8'))).toMatchObject({
      targets: [{ id: 'malformed', disposition: 'refused' }],
    });
  });

  it('records a reachable app missing local-test attestation as refused and blocked', async () => {
    const { origin } = await serve((request, response) => {
      response.statusCode = request.url === '/' ? 200 : 404;
      response.end(request.url === '/' ? 'ready' : 'missing');
    });
    expect((await fetch(origin)).ok).toBe(true);

    const result = await runPreflightAttestation({
      targets: [{ id: 'missing-attestation', origin }],
      policy: policy(origin),
      artifactsDir: await artifactsDir(),
      now,
    });

    expect(result.accepted).toEqual([]);
    expect(result.refused).toEqual(['missing-attestation']);
    expect(result.diagnostics).toMatchObject([
      { code: 'ARXIC-ATTESTATION-FETCH-FAILED', severity: 'blocked' },
    ]);
    expect(JSON.parse(await readFile(result.artifactPath, 'utf8'))).toMatchObject({
      targets: [{ id: 'missing-attestation', disposition: 'refused' }],
    });
  });

  it('reports artifact write failure as blocked without changing target decisions', async () => {
    let origin = '';
    await serve((_request, response) => {
      response.setHeader('content-type', 'application/json');
      response.end(
        JSON.stringify({
          environmentClass: 'local-test',
          origin,
          allowedOrigins: [origin],
          buildDigest: digest,
          nonce,
        }),
      );
    }).then((served) => {
      origin = served.origin;
    });
    const parent = await artifactsDir();
    const occupiedPath = join(parent, 'not-a-directory');
    await writeFile(occupiedPath, 'occupied');

    const result = await runPreflightAttestation({
      targets: [{ id: 'local', origin }],
      policy: policy(origin),
      artifactsDir: occupiedPath,
      now,
    });

    expect(result).toMatchObject({
      accepted: ['local'],
      refused: [],
      diagnostics: [{ code: 'ARXIC-ATTESTATION-ARTIFACT-WRITE-FAILED', severity: 'blocked' }],
    });
  });
});
