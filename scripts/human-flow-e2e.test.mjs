import { describe, expect, it } from 'vitest';

import {
  assertBlockedRun,
  assertSuccessfulRun,
  createConfig,
  stableRunRoot,
} from './human-flow-e2e.mjs';

describe('human-flow E2E pure helpers', () => {
  it('creates the documented configuration shape for an attested local target', () => {
    expect(
      createConfig({
        origin: 'http://127.0.0.1:43123',
        repository: '/tmp/reference-auth-app',
        revision: 'a'.repeat(40),
      }),
    ).toContain(`target:\n  origin: "http://127.0.0.1:43123"\n  environmentClass: local-test`);
  });

  it('uses the documented stable run root outside a source checkout', () => {
    const root = stableRunRoot('/tmp/arxic-state', '/tmp/reference-auth-app');
    expect(root).toMatch(/^\/tmp\/arxic-state\/runs\/[a-f0-9]{16}$/u);
    expect(root.startsWith('/tmp/reference-auth-app/')).toBe(false);
  });

  it('rejects a happy run without a verified promoted bundle', () => {
    expect(() =>
      assertSuccessfulRun({
        exitCode: 0,
        output: 'arxic run human-happy -> /tmp/run (status=completed, outcome=verified)',
        run: { outcome: 'verified', status: 'completed' },
        bundle: { manifest: { workflow: { id: 'authentication.login', status: 'observed' } } },
      }),
    ).toThrow('promoted bundle manifest must record a verified workflow');
  });

  it('requires the sad path to remain blocked and preserve prior promoted bytes', () => {
    expect(() =>
      assertBlockedRun({
        exitCode: 1,
        run: { outcome: 'blocked', status: 'failed' },
        diagnostics: [{ severity: 'blocked', code: 'ARXIC-ENV-REFUSED' }],
        priorBundle: Buffer.from('before'),
        currentBundle: Buffer.from('after'),
      }),
    ).toThrow('prior promoted bundle changed after blocked run');
  });
});
