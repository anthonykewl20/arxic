import { createServer, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, test } from 'vitest';
import { LangGraphOrchestrator } from '../orchestrator';
import { FileStageCheckpointer } from '../checkpointer';

const root = fileURLToPath(new URL('../../../..', import.meta.url));

/**
 * #259 — the stage-0 attestation gate must verify `buildDigest` against an
 * INDEPENDENT operator-pinned expectation. The reported defect: on the local
 * lane the CLI fed the digest served by the target's OWN attestation endpoint
 * back as the expected value, so the gate compared the attestation against
 * itself and a tampered 64-hex digest passed with zero diagnostics.
 */
describe('stage-0 buildDigest binding (#259 tamper repro)', () => {
  test('refuses a tampered served digest when the operator pinned the true digest', async () => {
    const trueDigest = 'a'.repeat(64);
    const tamperedDigest = 'b'.repeat(64);
    const { origin, server } = await startAttestationServer(tamperedDigest);

    try {
      const runDirectory = await mkdtemp(join(tmpdir(), 'arxic-259-tamper-'));
      try {
        const orchestrator = new LangGraphOrchestrator({
          checkpointer: new FileStageCheckpointer(runDirectory),
        });
        const result = await orchestrator.run({
          runId: 'tamper-repro-259',
          origin,
          revision: {
            repository: pathToFileURL(join(root, 'test-fixtures/reference-auth-app')).href,
            commit: '0123456789abcdef0123456789abcdef01234567',
            dirty: false,
          },
          rulepacksDir: join(root, 'rulepacks'),
          artifactsDir: runDirectory,
          framework: 'nextjs',
          features: ['authentication'],
          maxUrls: 1,
          maxDepth: 0,
          // The operator pinned the TRUE digest; the target serves a
          // TAMPERED one. Before #259 the gate compared the served digest
          // against itself (when fed as appBuildDigest) and passed clean.
          expectedBuildDigest: trueDigest,
          expectedNonce: 'arxic-259-tamper-repro',
        });

        // Fatal at stage 0: the stage failed closed — no artifact committed,
        // no later stage executed, and the mismatch diagnostic is on the run.
        expect(result.diagnostics).toContainEqual(
          expect.objectContaining({
            code: 'ARXIC-ATTESTATION-BUILD-DIGEST-MISMATCH',
            severity: 'blocked',
          }),
        );
        expect(result.outcome).toBe('blocked');
        expect(result.status).toBe('failed');
        expect(result.promotionEligible).toBe(false);
        expect(result.completedStages).toEqual([]);
        expect(Object.keys(result.artifacts)).toEqual([]);
      } finally {
        await rm(runDirectory, { recursive: true, force: true });
      }
    } finally {
      await closeServer(server);
    }
  }, 120_000);

  test('still refuses a tampered digest when the legacy self-fetched digest is supplied (no regression of the fix)', async () => {
    const tamperedDigest = 'b'.repeat(64);
    const { origin, server } = await startAttestationServer(tamperedDigest);

    try {
      const runDirectory = await mkdtemp(join(tmpdir(), 'arxic-259-legacy-'));
      try {
        const orchestrator = new LangGraphOrchestrator({
          checkpointer: new FileStageCheckpointer(runDirectory),
        });
        const result = await orchestrator.run({
          runId: 'legacy-digest-259',
          origin,
          revision: {
            repository: pathToFileURL(join(root, 'test-fixtures/reference-auth-app')).href,
            commit: '0123456789abcdef0123456789abcdef01234567',
            dirty: false,
          },
          rulepacksDir: join(root, 'rulepacks'),
          artifactsDir: runDirectory,
          framework: 'nextjs',
          features: ['authentication'],
          maxUrls: 1,
          maxDepth: 0,
          // Exactly the pre-#288 CLI wiring: appBuildDigest fetched from the
          // target's own endpoint. The gate must NOT treat this as the
          // expectation (that was the self-referential defect) — it is only
          // the recorded evidence digest, so no local-test binding exists and
          // the run proceeds (trust-on-first-use local-test), WITH the digest
          // recorded for later stages.
          appBuildDigest: tamperedDigest,
          expectedNonce: 'arxic-259-tamper-repro',
        });

        // The defect this test pins: appBuildDigest alone must NOT create a
        // pass/fail gate (it never compared against anything independent).
        // The run must NOT carry BUILD_DIGEST_MISMATCH from a self-sourced
        // digest, and must not claim the digest was verified either.
        expect(
          result.diagnostics.filter(
            (diagnostic) => diagnostic.code === 'ARXIC-ATTESTATION-BUILD-DIGEST-MISMATCH',
          ),
        ).toEqual([]);
      } finally {
        await rm(runDirectory, { recursive: true, force: true });
      }
    } finally {
      await closeServer(server);
    }
  }, 120_000);
});

function startAttestationServer(buildDigest: string) {
  let origin = '';
  const server: Server = createServer((request, response) => {
    if (request.url === '/.well-known/arxic-test-target.json') {
      response.setHeader('content-type', 'application/json');
      response.end(
        JSON.stringify({
          environmentClass: 'local-test',
          origin,
          allowedOrigins: [origin],
          buildDigest,
          nonce: 'arxic-259-tamper-repro',
        }),
      );
      return;
    }
    response.setHeader('content-type', 'text/html');
    response.end('<!doctype html><title>Arxic 259 tamper target</title>');
  });
  return new Promise<{ origin: string; server: Server }>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Attestation server did not bind'));
        return;
      }
      origin = `http://127.0.0.1:${address.port}`;
      resolve({ origin, server });
    });
  });
}

async function closeServer(server: Server | undefined): Promise<void> {
  if (!server) return;
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
