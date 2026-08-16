// DG-03 PROOF 4b — a non-UI intent (an HMAC-verified webhook endpoint) replays
// at HTTP level with evidence through the spike's API replay executor, against
// the REAL redirect-login-app over real HTTP sockets. Request/response
// artifacts are retained, SHA-256 hashed, and redaction-scanned; the outcome
// is classified by the REAL @arxic/verifier classifier.
//
// Sad twins: a wrong-signature replay is `contradicted` (the app correctly
// rejects; expectations unmet), and a replay without a fixture lease is
// `blocked` before any business request is sent.
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { freePort } from '@arxic/real-world-testkit';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { executeApiReplay, DG03_API_ARTIFACT_KIND } from '../api-replay';
import { ARXIC_DG03_POLICY_DENIED } from '../diagnostics';
import { startRedirectLoginApp, stopRedirectLoginApp } from '../test-app/redirect-login-app';

const WEBHOOK_SECRET_ENV = 'ARXIC_INPUT_WEBHOOK_SECRET';
const WEBHOOK_SECRET = 'whsec_dg03_' + 'd'.repeat(24);
const PROVIDER_EVENT_ID = 'evt-dg03-proof-001';

const orderBody = JSON.stringify({
  eventType: 'order.created',
  providerEventId: PROVIDER_EVENT_ID,
  orderNumber: 'ORD-1001',
  amount: '42.50',
});

function webhookSteps(): Parameters<typeof executeApiReplay>[0]['steps'] {
  return [
    {
      request: {
        intent: 'accept order.created webhook from the provider',
        method: 'POST',
        path: '/api/webhooks/order.created',
        body: orderBody,
        hmacSecretEnv: WEBHOOK_SECRET_ENV,
        hmacHeader: 'x-arxic-signature',
      },
      expect: { status: 201, bodyContains: '"ok":true' },
    },
    {
      request: {
        intent: 'read back the persisted order by provider event id',
        method: 'GET',
        path: `/api/orders/by-event/${PROVIDER_EVENT_ID}`,
      },
      expect: { status: 200, jsonField: { path: ['orderNumber'], equals: 'ORD-1001' } },
    },
  ];
}

describe.sequential(
  'DG-03 proof 4b: API-level replay of a non-UI webhook intent with evidence',
  () => {
    let origin = '';
    let server: Awaited<ReturnType<typeof startRedirectLoginApp>>['server'] | undefined;
    let artifactsDirectory = '';
    let businessHits = 0;
    let previousSecret: string | undefined;

    beforeAll(async () => {
      previousSecret = process.env[WEBHOOK_SECRET_ENV];
      process.env[WEBHOOK_SECRET_ENV] = WEBHOOK_SECRET;
      const port = await freePort();
      origin = `http://127.0.0.1:${port}`;
      const dbDirectory = await mkdtemp(join(tmpdir(), 'dg03-webhook-db-'));
      const started = await startRedirectLoginApp({
        port,
        dbPath: join(dbDirectory, 'app.db'),
        origin,
        webhookSecretEnv: WEBHOOK_SECRET_ENV,
      });
      server = started.server;
      // Count real business requests reaching the webhook endpoint.
      server.on('request', (request) => {
        if (request.method === 'POST' && request.url === '/api/webhooks/order.created') {
          businessHits += 1;
        }
      });
      artifactsDirectory = await mkdtemp(join(tmpdir(), 'dg03-webhook-artifacts-'));
    }, 60_000);

    afterAll(async () => {
      if (previousSecret === undefined) delete process.env[WEBHOOK_SECRET_ENV];
      else process.env[WEBHOOK_SECRET_ENV] = previousSecret;
      if (server) await stopRedirectLoginApp(server);
      if (artifactsDirectory) await rm(artifactsDirectory, { recursive: true, force: true });
    });

    test('replays the webhook intent at HTTP level across two clean runs with hashed, redacted evidence', async () => {
      const hitsBefore = businessHits;
      const result = await executeApiReplay({
        runId: 'dg03-webhook-proof',
        subject: 'orders.webhook.order-created',
        origin,
        steps: webhookSteps(),
        requiredRuns: 2,
        lease: {
          id: 'lease-dg03-webhook',
          owner: 'dg03-webhook-proof',
          expiresAt: new Date(Date.now() + 120_000).toISOString(),
          inUse: false,
        },
        resetAndSeed: async () => {
          const response = await fetch(`${origin}/__arxic/reset`, { method: 'POST' });
          if (!response.ok) throw new Error(`fixture reset returned ${response.status}`);
        },
        artifactsDir: artifactsDirectory,
        forbiddenSubstrings: [WEBHOOK_SECRET],
      });

      expect(result.outcome, JSON.stringify(result.diagnostics)).toBe('verified');
      expect(result.runs).toEqual([{ passed: true }, { passed: true }]);
      expect(result.attestation?.environmentClass).toBe('local-test');
      // Two runs × two steps = four retained, hashed artifacts over real HTTP.
      expect(result.artifacts).toHaveLength(4);
      expect(businessHits - hitsBefore).toBe(2);
      for (const artifact of result.artifacts) {
        expect(artifact.kind).toBe(DG03_API_ARTIFACT_KIND);
        const bytes = await readFile(artifact.path, 'utf8');
        expect(createHash('sha256').update(bytes).digest('hex')).toBe(artifact.sha256);
        expect(bytes).not.toContain(WEBHOOK_SECRET);
        const record = JSON.parse(bytes) as {
          method?: string;
          status?: number;
          requestHeaders?: Record<string, string>;
          url?: string;
        };
        expect(record.url?.startsWith(origin)).toBe(true);
      }
      // The HMAC signature header is retained only as a digest, never raw —
      // check it on the webhook artifacts specifically.
      for (const artifact of result.artifacts.filter(({ path }) => path.includes('step-00'))) {
        const record = JSON.parse(await readFile(artifact.path, 'utf8')) as {
          requestHeaders?: Record<string, string>;
        };
        const signature = record.requestHeaders?.['x-arxic-signature'];
        expect(signature).toMatch(/^sha256:[0-9a-f]{16}$/);
      }
      // The webhook step artifact records the accepted status; the read-back records the order number.
      const webhookArtifactPath = result.artifacts.find(({ path }) =>
        path.includes('step-00'),
      )!.path;
      const webhookArtifact = JSON.parse(await readFile(webhookArtifactPath, 'utf8')) as {
        status: number;
        intent: string;
      };
      expect(webhookArtifact.status).toBe(201);
      const readBack = JSON.parse(
        await readFile(result.artifacts.find(({ path }) => path.includes('step-01'))!.path, 'utf8'),
      ) as { status: number; responseBody: string };
      expect(readBack.status).toBe(200);
      expect(readBack.responseBody).toContain('ORD-1001');
      // Retained-evidence hook (mirrors ARXIC_TRACE_SANITIZATION_EVIDENCE_DIR):
      // copy sanitized artifacts for the docs/evidence/DG-03 record on demand.
      const retainedEvidence = process.env.ARXIC_DG03_EVIDENCE_DIR;
      if (retainedEvidence) {
        await mkdir(retainedEvidence, { recursive: true });
        await copyFile(
          webhookArtifactPath,
          join(retainedEvidence, 'api-replay-run01-webhook.json'),
        );
        await writeFile(
          join(retainedEvidence, 'api-replay-summary.json'),
          `${JSON.stringify(
            {
              subject:
                result.outcome === 'verified'
                  ? 'orders.webhook.order-created (verified)'
                  : result.outcome,
              engine: 'real HTTP (node:http) + HMAC-SHA256 signature replay',
              outcome: result.outcome,
              runs: result.runs,
              attestedEnvironmentClass: result.attestation?.environmentClass,
              artifacts: result.artifacts.map(({ kind, sha256 }) => ({ kind, sha256 })),
            },
            null,
            2,
          )}\n`,
          'utf8',
        );
      }
    }, 120_000);

    test('a wrong-signature replay is contradicted — the real app rejects it', async () => {
      const wrongSecretDir = await mkdtemp(join(tmpdir(), 'dg03-wrong-hmac-'));
      const previous = process.env[WEBHOOK_SECRET_ENV];
      process.env[WEBHOOK_SECRET_ENV] = 'whsec_WRONG_' + 'e'.repeat(24);
      try {
        const result = await executeApiReplay({
          runId: 'dg03-webhook-wrong-sig',
          subject: 'orders.webhook.order-created',
          origin,
          steps: webhookSteps(),
          requiredRuns: 2,
          lease: {
            id: 'lease-dg03-wrong-sig',
            owner: 'dg03-webhook-wrong-sig',
            expiresAt: new Date(Date.now() + 120_000).toISOString(),
            inUse: false,
          },
          resetAndSeed: async () => {},
          artifactsDir: wrongSecretDir,
          forbiddenSubstrings: [process.env[WEBHOOK_SECRET_ENV]],
        });
        expect(result.outcome, JSON.stringify(result.diagnostics)).toBe('contradicted');
        expect(result.runs).toEqual([{ passed: false }, { passed: false }]);
        expect(result.diagnostics.map(({ code }) => code)).toContain('ARXIC-VERIFY-APP-DEFECT');
      } finally {
        if (previous === undefined) delete process.env[WEBHOOK_SECRET_ENV];
        else process.env[WEBHOOK_SECRET_ENV] = previous;
        await rm(wrongSecretDir, { recursive: true, force: true });
      }
    }, 120_000);

    test('a webhook replay without a fixture lease is blocked before any business request', async () => {
      const hitsBefore = businessHits;
      const result = await executeApiReplay({
        runId: 'dg03-webhook-no-lease',
        subject: 'orders.webhook.order-created',
        origin,
        steps: webhookSteps(),
        requiredRuns: 2,
        resetAndSeed: async () => {},
        artifactsDir: await mkdtemp(join(tmpdir(), 'dg03-no-lease-')),
        forbiddenSubstrings: [WEBHOOK_SECRET],
      });
      expect(result.outcome).toBe('blocked');
      expect(result.diagnostics.map(({ code }) => code)).toContain(ARXIC_DG03_POLICY_DENIED);
      expect(result.runs).toEqual([]);
      expect(businessHits - hitsBefore).toBe(0);
    }, 60_000);
  },
);
