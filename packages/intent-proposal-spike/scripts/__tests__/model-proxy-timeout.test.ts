/**
 * Regression coverage for the DG-12 run17/18 failure class: the recording
 * model proxy's UPSTREAM timeout was hardcoded at 120s while reasoning
 * models (glm-5.3 over the coding endpoint) legitimately exceed it on
 * full-size structured-output prompts — the proxy aborted mid-reasoning,
 * the adapter saw a transport failure, and every such call landed as an
 * ACCOUNTING GAP (run INVALID, headroom frozen). The timeout is now
 * parameterized: ARXIC_DG11_UPSTREAM_TIMEOUT_MS (default 120_000, the
 * historical value), fail-closed on invalid values, honored end-to-end by
 * the proxy's upstream fetch.
 */
import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { RecordingModelProxy, resolveUpstreamTimeoutMs } from '../dg11-run-validation';

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});

function stubUpstream(sleepMs: number): Promise<{ server: Server; origin: string }> {
  return new Promise((resolve) => {
    const server = createServer((request, response) => {
      response.on('error', () => {});
      request.on('data', () => {
        // drain the request body so 'end' fires
      });
      request.on('end', () => {
        setTimeout(() => {
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end(
            JSON.stringify({
              id: 'stub-1',
              model: 'glm-5.3',
              usage: { prompt_tokens: 10, completion_tokens: 5 },
            }),
          );
        }, sleepMs);
      });
    });
    servers.push(server);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address !== 'object') throw new Error('no port');
      resolve({ server, origin: `http://127.0.0.1:${address.port}` });
    });
  });
}

async function callThrough(proxy: RecordingModelProxy, bearer: string): Promise<Response> {
  return fetch(`${proxy.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'glm-5.3', messages: [] }),
  });
}

describe('resolveUpstreamTimeoutMs (ARXIC_DG11_UPSTREAM_TIMEOUT_MS)', () => {
  it('defaults to the historical 120s and honors a positive integer override', () => {
    const previous = process.env.ARXIC_DG11_UPSTREAM_TIMEOUT_MS;
    try {
      delete process.env.ARXIC_DG11_UPSTREAM_TIMEOUT_MS;
      expect(resolveUpstreamTimeoutMs()).toBe(120_000);
      process.env.ARXIC_DG11_UPSTREAM_TIMEOUT_MS = '300000';
      expect(resolveUpstreamTimeoutMs()).toBe(300_000);
    } finally {
      if (previous === undefined) delete process.env.ARXIC_DG11_UPSTREAM_TIMEOUT_MS;
      else process.env.ARXIC_DG11_UPSTREAM_TIMEOUT_MS = previous;
    }
  });

  it('fails closed on invalid values', () => {
    for (const value of ['0', '-5', 'abc', '1.5']) {
      process.env.ARXIC_DG11_UPSTREAM_TIMEOUT_MS = value;
      try {
        expect(() => resolveUpstreamTimeoutMs(), value).toThrow(/ARXIC_DG11_UPSTREAM_TIMEOUT_MS/);
      } finally {
        delete process.env.ARXIC_DG11_UPSTREAM_TIMEOUT_MS;
      }
    }
  });
});

describe('RecordingModelProxy upstream timeout is honored end-to-end', () => {
  it('aborts a slow upstream at the configured timeout and reports 502 (no hang, no telemetry)', async () => {
    const previous = process.env.ARXIC_DG11_UPSTREAM_TIMEOUT_MS;
    process.env.ARXIC_DG11_UPSTREAM_TIMEOUT_MS = '400';
    let proxy: RecordingModelProxy | undefined;
    try {
      const { origin } = await stubUpstream(5_000);
      proxy = await RecordingModelProxy.start({
        upstreamBaseUrl: origin,
        upstreamApiKey: 'stub-upstream-key',
        inboundBearer: 'stub-canary',
        ceilingUsd: 1,
        spendBeforeUsd: 0,
        prices: { promptPerMillion: 1.4, completionPerMillion: 4.4 },
        runId: 'timeout-proof',
      });
      const startedAt = Date.now();
      const response = await callThrough(proxy, 'stub-canary');
      const elapsed = Date.now() - startedAt;
      expect(response.status).toBe(502);
      expect(elapsed).toBeLessThan(2_000);
      expect(proxy.telemetry).toHaveLength(0);
    } finally {
      if (previous === undefined) delete process.env.ARXIC_DG11_UPSTREAM_TIMEOUT_MS;
      else process.env.ARXIC_DG11_UPSTREAM_TIMEOUT_MS = previous;
      await proxy?.stop();
    }
  }, 15_000);

  it('forwards a response that lands within the configured timeout', async () => {
    const previous = process.env.ARXIC_DG11_UPSTREAM_TIMEOUT_MS;
    process.env.ARXIC_DG11_UPSTREAM_TIMEOUT_MS = '4000';
    let proxy: RecordingModelProxy | undefined;
    try {
      const { origin } = await stubUpstream(150);
      proxy = await RecordingModelProxy.start({
        upstreamBaseUrl: origin,
        upstreamApiKey: 'stub-upstream-key',
        inboundBearer: 'stub-canary',
        ceilingUsd: 1,
        spendBeforeUsd: 0,
        prices: { promptPerMillion: 1.4, completionPerMillion: 4.4 },
        runId: 'timeout-proof-ok',
      });
      const response = await callThrough(proxy, 'stub-canary');
      expect(response.status).toBe(200);
      expect(proxy.telemetry).toHaveLength(1);
    } finally {
      if (previous === undefined) delete process.env.ARXIC_DG11_UPSTREAM_TIMEOUT_MS;
      else process.env.ARXIC_DG11_UPSTREAM_TIMEOUT_MS = previous;
      await proxy?.stop();
    }
  }, 15_000);
});
