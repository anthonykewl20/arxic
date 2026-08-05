import type { SurfaceDiscoverer } from '@arxic/contracts';
import { validateDiagnostic } from '@arxic/contracts';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ARXIC_SURFACE_BUILD_UNATTESTED,
  ARXIC_SURFACE_EXTERNAL_ORIGIN,
  ARXIC_SURFACE_FORM_SUBMIT_BLOCKED,
  ARXIC_SURFACE_FRONTIER_STOP,
  ARXIC_SURFACE_MUTATION_BLOCKED,
  ARXIC_SURFACE_NAVIGATION_FAILED,
  ARXIC_SURFACE_ORIGIN_INVALID,
  ARXIC_SURFACE_PERSONA_SERIALIZED,
  CrawleeSurfaceDiscoverer,
} from '..';

let server: Server | undefined;

afterEach(async () => {
  if (!server) return;
  server.close();
  await once(server, 'close');
  server = undefined;
});

describe('frozen SurfaceDiscoverer contract', () => {
  it('maps collect surfaces to runtime EvidenceRefs and diagnostics through discover()', async () => {
    let origin = '';
    server = createServer((request, response) => {
      if (request.url === '/.well-known/arxic-test-target.json') {
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ origin, buildDigest: 'b'.repeat(64) }));
        return;
      }
      response.setHeader('content-type', 'text/html');
      response.end(
        '<title>contract surface</title><form method="post"><button>Mutate</button></form>',
      );
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('Could not allocate contract port');
    origin = `http://127.0.0.1:${address.port}`;
    const adapter: SurfaceDiscoverer = new CrawleeSurfaceDiscoverer({
      now: () => '2026-08-05T00:00:00.000Z',
      runId: () => 'frozen-contract-run',
    });

    const events = [];
    for await (const event of adapter.discover({ origin, maxUrls: 1, maxDepth: 0 }))
      events.push(event);

    expect(events).toContainEqual(
      expect.objectContaining({
        ref: expect.objectContaining({ kind: 'runtime', url: `${origin}/` }),
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        diagnostic: expect.objectContaining({ code: ARXIC_SURFACE_FORM_SUBMIT_BLOCKED }),
      }),
    );
  }, 60_000);

  it('keeps every stable surface diagnostic valid under the frozen Diagnostic schema', () => {
    for (const code of [
      ARXIC_SURFACE_EXTERNAL_ORIGIN,
      ARXIC_SURFACE_FORM_SUBMIT_BLOCKED,
      ARXIC_SURFACE_FRONTIER_STOP,
      ARXIC_SURFACE_MUTATION_BLOCKED,
      ARXIC_SURFACE_PERSONA_SERIALIZED,
      ARXIC_SURFACE_NAVIGATION_FAILED,
      ARXIC_SURFACE_ORIGIN_INVALID,
      ARXIC_SURFACE_BUILD_UNATTESTED,
    ]) {
      expect(
        validateDiagnostic({
          code,
          severity: 'blocked',
          subject: 'contract',
          message: 'stable diagnostic',
        }),
      ).toEqual(expect.objectContaining({ ok: true }));
    }
  });
});
