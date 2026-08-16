// DG-03 sad-path-first unit tests: the API-level replay executor's gates, over
// REAL node:http servers (no mocked fetch). Every gate must fail closed BEFORE
// the business endpoint is touched.
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { freePort } from '@arxic/real-world-testkit';
import {
  ARXIC_DG03_ATTESTATION_REFUSED,
  ARXIC_DG03_ATTESTATION_UNAVAILABLE,
  ARXIC_DG03_ORIGIN_DRIFT,
  ARXIC_DG03_POLICY_DENIED,
  ARXIC_DG03_REDACTION_FAILED,
} from '../diagnostics';
import { executeApiReplay } from '../api-replay';

type GateServer = {
  origin: string;
  server: Server;
  businessHits: () => number;
  setBehavior: (behavior: 'ok' | 'reject-signature' | 'flip') => void;
};

async function startGateServer(
  options: { attestation?: 'local-test' | 'production' | 'none' } = {},
): Promise<GateServer> {
  const attestation = options.attestation ?? 'local-test';
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  let businessHits = 0;
  let behavior: 'ok' | 'reject-signature' | 'flip' = 'ok';
  let flipCount = 0;
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', origin);
    if (url.pathname === '/.well-known/arxic-test-target.json') {
      if (attestation === 'none') {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          environmentClass: attestation,
          origin,
          allowedOrigins: [origin],
          buildDigest: 'f'.repeat(64),
          nonce: 'gate-server-v1',
        }),
      );
      return;
    }
    if (url.pathname === '/api/things') {
      businessHits += 1;
      if (behavior === 'reject-signature') {
        response.writeHead(401, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: 'invalid signature' }));
        return;
      }
      if (behavior === 'flip') {
        flipCount += 1;
        if (flipCount % 2 === 0) {
          response.writeHead(500, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ error: 'boom' }));
          return;
        }
      }
      response.writeHead(201, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: true, echoed: 'fixed-value' }));
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  return {
    origin,
    server,
    businessHits: () => businessHits,
    setBehavior: (next) => {
      behavior = next;
    },
  };
}

const servers: Server[] = [];
afterAll(async () => {
  await Promise.all(
    servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});

async function newServer(options?: { attestation?: 'local-test' | 'production' | 'none' }) {
  const gateServer = await startGateServer(options);
  servers.push(gateServer.server);
  return gateServer;
}

const lease = (runId: string, expiresAt = new Date(Date.now() + 60_000).toISOString()) => ({
  id: 'lease-1',
  owner: runId,
  expiresAt,
  inUse: false,
});

async function artifactsDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'dg03-api-replay-'));
}

describe('api replay executor gates (fail-closed, real HTTP)', () => {
  it('blocks when the target has no attestation endpoint and never reaches the business endpoint', async () => {
    const gateServer = await newServer({ attestation: 'none' });
    const result = await executeApiReplay({
      runId: 'dg03-unattested',
      subject: 'things.create',
      origin: gateServer.origin,
      steps: [
        {
          request: { intent: 'create thing', method: 'POST', path: '/api/things', body: '{"a":1}' },
          expect: { status: 201 },
        },
      ],
      requiredRuns: 2,
      lease: lease('dg03-unattested'),
      resetAndSeed: async () => {},
      artifactsDir: await artifactsDir(),
      forbiddenSubstrings: [],
    });
    expect(result.outcome).toBe('blocked');
    expect(result.diagnostics.map(({ code }) => code)).toContain(
      ARXIC_DG03_ATTESTATION_UNAVAILABLE,
    );
    expect(gateServer.businessHits()).toBe(0);
  });

  it('blocks a production-looking attestation without approval and never reaches the business endpoint', async () => {
    const gateServer = await newServer({ attestation: 'production' });
    const result = await executeApiReplay({
      runId: 'dg03-prod',
      subject: 'things.create',
      origin: gateServer.origin,
      steps: [
        {
          request: { intent: 'create thing', method: 'POST', path: '/api/things' },
          expect: { status: 201 },
        },
      ],
      requiredRuns: 2,
      lease: lease('dg03-prod'),
      resetAndSeed: async () => {},
      artifactsDir: await artifactsDir(),
      forbiddenSubstrings: [],
    });
    expect(result.outcome).toBe('blocked');
    expect(result.diagnostics.map(({ code }) => code)).toContain(ARXIC_DG03_ATTESTATION_REFUSED);
    expect(gateServer.businessHits()).toBe(0);
  });

  it('blocks a mutating replay without a fixture lease (policy-engine default-deny)', async () => {
    const gateServer = await newServer();
    const result = await executeApiReplay({
      runId: 'dg03-no-lease',
      subject: 'things.create',
      origin: gateServer.origin,
      steps: [
        {
          request: { intent: 'create thing', method: 'POST', path: '/api/things' },
          expect: { status: 201 },
        },
      ],
      requiredRuns: 2,
      resetAndSeed: async () => {},
      artifactsDir: await artifactsDir(),
      forbiddenSubstrings: [],
    });
    expect(result.outcome).toBe('blocked');
    const denied = result.diagnostics.find(({ code }) => code === ARXIC_DG03_POLICY_DENIED);
    expect(denied?.message).toContain('ARXIC-POLICY-LEASE-MISSING');
    expect(gateServer.businessHits()).toBe(0);
  });

  it('blocks a mutating replay with an expired lease', async () => {
    const gateServer = await newServer();
    const result = await executeApiReplay({
      runId: 'dg03-expired-lease',
      subject: 'things.create',
      origin: gateServer.origin,
      steps: [
        {
          request: { intent: 'create thing', method: 'POST', path: '/api/things' },
          expect: { status: 201 },
        },
      ],
      requiredRuns: 2,
      lease: lease('dg03-expired-lease', new Date(Date.now() - 1_000).toISOString()),
      resetAndSeed: async () => {},
      artifactsDir: await artifactsDir(),
      forbiddenSubstrings: [],
    });
    expect(result.outcome).toBe('blocked');
    const denied = result.diagnostics.find(({ code }) => code === ARXIC_DG03_POLICY_DENIED);
    expect(denied?.message).toContain('ARXIC-POLICY-LEASE-EXPIRED');
    expect(gateServer.businessHits()).toBe(0);
  });

  it('blocks a destructive method without recorded approval', async () => {
    const gateServer = await newServer();
    const result = await executeApiReplay({
      runId: 'dg03-destructive',
      subject: 'things.delete',
      origin: gateServer.origin,
      steps: [
        {
          request: { intent: 'delete thing', method: 'DELETE', path: '/api/things' },
          expect: { status: 204 },
        },
      ],
      requiredRuns: 2,
      lease: lease('dg03-destructive'),
      resetAndSeed: async () => {},
      artifactsDir: await artifactsDir(),
      forbiddenSubstrings: [],
    });
    expect(result.outcome).toBe('blocked');
    const denied = result.diagnostics.find(({ code }) => code === ARXIC_DG03_POLICY_DENIED);
    expect(denied?.message).toContain('ARXIC-POLICY-DESTRUCTIVE-WITHOUT-APPROVAL');
    expect(gateServer.businessHits()).toBe(0);
  });

  it('fails closed pre-flight when a forbidden substring appears in the request path', async () => {
    const gateServer = await newServer();
    const result = await executeApiReplay({
      runId: 'dg03-redact-path',
      subject: 'things.create',
      origin: gateServer.origin,
      steps: [
        {
          request: {
            intent: 'create thing',
            method: 'POST',
            path: '/api/things?token=sekrit-value',
          },
          expect: { status: 201 },
        },
      ],
      requiredRuns: 2,
      lease: lease('dg03-redact-path'),
      resetAndSeed: async () => {},
      artifactsDir: await artifactsDir(),
      forbiddenSubstrings: ['sekrit-value'],
    });
    expect(result.outcome).toBe('blocked');
    expect(result.diagnostics.map(({ code }) => code)).toContain(ARXIC_DG03_REDACTION_FAILED);
    expect(gateServer.businessHits()).toBe(0);
  });

  it('fails closed pre-flight when a step path resolves off the attested origin (absolute URL escape)', async () => {
    const gateServer = await newServer();
    const result = await executeApiReplay({
      runId: 'dg03-origin-escape',
      subject: 'things.create',
      origin: gateServer.origin,
      steps: [
        {
          request: {
            intent: 'create thing elsewhere',
            method: 'POST',
            path: 'http://127.0.0.1:1/api/things',
          },
          expect: { status: 201 },
        },
      ],
      requiredRuns: 2,
      lease: lease('dg03-origin-escape'),
      resetAndSeed: async () => {},
      artifactsDir: await artifactsDir(),
      forbiddenSubstrings: [],
    });
    expect(result.outcome).toBe('blocked');
    expect(result.diagnostics.map(({ code }) => code)).toContain(ARXIC_DG03_ORIGIN_DRIFT);
    expect(gateServer.businessHits()).toBe(0);
  });

  it('contradicts when every replay run fails the expectation (server rejects)', async () => {
    const gateServer = await newServer();
    gateServer.setBehavior('reject-signature');
    const result = await executeApiReplay({
      runId: 'dg03-all-fail',
      subject: 'things.create',
      origin: gateServer.origin,
      steps: [
        {
          request: { intent: 'create thing', method: 'POST', path: '/api/things', body: '{"a":1}' },
          expect: { status: 201, bodyContains: '"ok":true' },
        },
      ],
      requiredRuns: 2,
      lease: lease('dg03-all-fail'),
      resetAndSeed: async () => {},
      artifactsDir: await artifactsDir(),
      forbiddenSubstrings: [],
    });
    expect(result.outcome).toBe('contradicted');
    expect(result.runs).toEqual([{ passed: false }, { passed: false }]);
    expect(result.diagnostics.map(({ code }) => code)).toContain('ARXIC-VERIFY-APP-DEFECT');
  });

  it('contradicts split runs (flaky), never averages them into a pass', async () => {
    const gateServer = await newServer();
    gateServer.setBehavior('flip');
    const result = await executeApiReplay({
      runId: 'dg03-flaky',
      subject: 'things.create',
      origin: gateServer.origin,
      steps: [
        {
          request: { intent: 'create thing', method: 'POST', path: '/api/things' },
          expect: { status: 201 },
        },
      ],
      requiredRuns: 2,
      lease: lease('dg03-flaky'),
      resetAndSeed: async () => {},
      artifactsDir: await artifactsDir(),
      forbiddenSubstrings: [],
    });
    expect(result.outcome).toBe('contradicted');
    expect(result.diagnostics.map(({ code }) => code)).toContain('ARXIC-VERIFY-FLAKY-RUNS');
  });

  it('blocks when reset/seed fixtures fail between runs (missing fixtures stay blocked)', async () => {
    const gateServer = await newServer();
    let resets = 0;
    const result = await executeApiReplay({
      runId: 'dg03-fixture-fail',
      subject: 'things.create',
      origin: gateServer.origin,
      steps: [
        {
          request: { intent: 'create thing', method: 'POST', path: '/api/things' },
          expect: { status: 201 },
        },
      ],
      requiredRuns: 2,
      lease: lease('dg03-fixture-fail'),
      resetAndSeed: async () => {
        resets += 1;
        if (resets > 1) throw new Error('fixture provider unavailable');
      },
      artifactsDir: await artifactsDir(),
      forbiddenSubstrings: [],
    });
    expect(result.outcome).toBe('blocked');
    expect(result.diagnostics.map(({ code }) => code)).toContain('ARXIC-VERIFY-BLOCKED-FIXTURE');
    expect(result.runs.length).toBeLessThan(2);
  });

  it('verifies a read-only GET replay across two clean runs with hashed artifacts', async () => {
    const gateServer = await newServer();
    const dir = await artifactsDir();
    const result = await executeApiReplay({
      runId: 'dg03-get',
      subject: 'things.read',
      origin: gateServer.origin,
      steps: [
        {
          request: { intent: 'read thing surface', method: 'GET', path: '/api/things' },
          expect: { status: 201, bodyContains: '"ok":true' },
        },
      ],
      requiredRuns: 2,
      resetAndSeed: async () => {},
      artifactsDir: dir,
      forbiddenSubstrings: [],
    });
    expect(result.outcome, JSON.stringify(result.diagnostics)).toBe('verified');
    expect(result.runs).toEqual([{ passed: true }, { passed: true }]);
    expect(result.artifacts).toHaveLength(2);
    for (const artifact of result.artifacts) {
      const digest = await readFile(artifact.path, 'utf8');
      expect(digest.length).toBeGreaterThan(0);
    }
    expect((await readdir(dir)).sort()).toEqual(
      result.artifacts.map(({ path }) => basename(path)).sort(),
    );
  });

  it('redacts forbidden substrings from retained request/response artifacts', async () => {
    const gateServer = await newServer();
    const dir = await artifactsDir();
    const result = await executeApiReplay({
      runId: 'dg03-redact-body',
      subject: 'things.create',
      origin: gateServer.origin,
      steps: [
        {
          request: {
            intent: 'create thing',
            method: 'POST',
            path: '/api/things',
            body: '{"secretField":"sekrit-value","plain":"visible"}',
          },
          expect: { status: 201 },
        },
      ],
      requiredRuns: 1,
      lease: lease('dg03-redact-body'),
      resetAndSeed: async () => {},
      artifactsDir: dir,
      forbiddenSubstrings: ['sekrit-value'],
    });
    expect(result.outcome, JSON.stringify(result.diagnostics)).toBe('verified');
    const artifact = result.artifacts[0];
    if (!artifact) throw new Error('expected a retained artifact');
    const content = await readFile(artifact.path, 'utf8');
    expect(content).not.toContain('sekrit-value');
    expect(content).toContain('[REDACTED]');
    expect(content).toContain('visible');
  });

  it('requires at least one run (zero requiredRuns is blocked)', async () => {
    const gateServer = await newServer();
    const result = await executeApiReplay({
      runId: 'dg03-zero-runs',
      subject: 'things.read',
      origin: gateServer.origin,
      steps: [
        {
          request: { intent: 'read thing surface', method: 'GET', path: '/api/things' },
          expect: { status: 201 },
        },
      ],
      requiredRuns: 0,
      resetAndSeed: async () => {},
      artifactsDir: await artifactsDir(),
      forbiddenSubstrings: [],
    });
    expect(result.outcome).toBe('blocked');
    expect(result.diagnostics.map(({ code }) => code)).toContain('ARXIC-VERIFY-SUITE-UNAVAILABLE');
  });
});
