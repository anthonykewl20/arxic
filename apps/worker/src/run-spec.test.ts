import { describe, expect, it } from 'vitest';
import type { WorkerClient } from './index';
import type { ArxicConfig, RunHandle, RunSpec, RunStreamEvent } from './run-spec';

// The expected config is the ADR §19 example, transcribed verbatim — an
// independent source of truth, not a re-derivation of the type (charter §3).
const adr19Config = {
  version: 1,
  source: {
    repository: '.',
    revision: 'HEAD',
    languages: ['typescript', 'javascript'],
  },
  scope: {
    domains: ['authentication'],
    frameworks: ['nextjs', 'react', 'express'],
    browsers: ['chromium'],
    personas: ['anonymous', 'registered-user'],
    featureFlags: { 'password-reset': true, mfa: true },
  },
  target: {
    origin: 'http://app.arxic.test',
    environmentClass: 'local-test',
    attestationPath: '/.well-known/arxic-test-target.json',
    allowedOrigins: ['http://app.arxic.test', 'http://mail-sink.arxic.test'],
  },
  policy: {
    maxUrls: 250,
    maxDepth: 8,
    maxRuntimeMinutes: 30,
    mutation: 'leased-fixtures-only',
    externalNetwork: 'deny',
    requiredVerificationRuns: 2,
    screenshots: 'transition-checkpoints',
    trace: 'retain',
    humanApproval: ['destructive', 'external-side-effect'],
  },
  fixtures: {
    inbox: 'captured-mail-sink',
    otp: 'test-otp',
    personaProvisioner: 'app-seed-api',
  },
  models: {
    provider: 'configured-adapter',
    sourceRetention: 'disabled',
  },
} satisfies ArxicConfig;

describe('CLI↔worker seam types (run-spec)', () => {
  it('accepts the ADR §19 configuration example as a valid ArxicConfig', () => {
    const config: ArxicConfig = adr19Config;
    expect(config.version).toBe(1);
    expect(config.policy.externalNetwork).toBe('deny');
    expect(config.policy.mutation).toBe('leased-fixtures-only');
  });

  it('assembles a RunSpec, RunHandle, and stream events from real values', () => {
    const spec: RunSpec = { runId: 'run-1', config: adr19Config };
    const handle: RunHandle = {
      runId: spec.runId,
      status: 'running',
      outcome: 'observed',
      activeStage: 5,
      diagnostics: [],
      promotionEligible: false,
    };
    const events: RunStreamEvent[] = [
      { type: 'stage-started', stage: 0, name: 'target-attestation', startedAt: 't0' },
      {
        type: 'diagnostic',
        diagnostic: {
          code: 'ARXIC-WORKER-QUOTA-EXCEEDED',
          severity: 'blocked',
          subject: 'cpu',
          message: 'CPU quota exceeded; run terminated',
        },
      },
      { type: 'finished', handle: { ...handle, status: 'failed', outcome: 'blocked' } },
    ];
    expect(spec.runId).toBe(handle.runId);
    expect(events.at(-1)?.type).toBe('finished');
  });

  it('a WorkerClient is realizable from the seam alone (no orchestrator import)', async () => {
    const fake: WorkerClient = {
      async start(spec) {
        return {
          runId: spec.runId,
          status: 'queued',
          outcome: 'hypothesized',
          diagnostics: [],
          promotionEligible: false,
        };
      },
      async *stream() {
        yield { type: 'finished', handle: await this.inspect({} as never) };
      },
      async collectArtifacts() {
        return {
          manifest: { runId: 'run-2', resultReady: true, files: [] },
          files: [],
        };
      },
      async inspect(handle) {
        return { ...handle, status: 'completed', outcome: 'blocked' };
      },
      async approve(handle) {
        return { ...handle, status: 'running' };
      },
      async cancel(handle) {
        return { ...handle, status: 'failed' };
      },
    };
    const handle = await fake.start({ runId: 'run-2', config: adr19Config });
    expect(handle.status).toBe('queued');
    const approved = await fake.approve(handle, { approver: 'op', reason: 'ok' });
    expect(approved.status).toBe('running');
  });
});
