import type { VerificationResult } from '@arxic/contracts';
import { describe, expect, it } from 'vitest';
import { projectVerifiedBundle } from '..';
import { stagedBundle } from './bundle-fixture';

describe('verified bundle projection mechanics', () => {
  it('projects verifier-owned state, runs, gates, and artifact hashes without mutation', async () => {
    const bundle = await stagedBundle();
    const original = structuredClone(bundle);
    const verification: VerificationResult & { gates: [{ gate: string; passed: boolean }] } = {
      outcome: 'verified',
      diagnostics: [],
      runs: [{ passed: true }],
      artifacts: [
        { kind: 'trace', path: '/safe/trace.zip', sha256: 'a'.repeat(64) },
        {
          kind: 'trace-sanitization-report',
          path: '/safe/trace.zip.sanitization.json',
          sha256: 'b'.repeat(64),
        },
        { kind: 'screenshot', path: '/safe/login.png', sha256: 'c'.repeat(64) },
        {
          kind: 'screenshot-privacy-report',
          path: '/safe/login.png.privacy.json',
          sha256: 'd'.repeat(64),
        },
        {
          kind: 'screenshot-capture-runtime',
          path: '/safe/screenshot-privacy.ts',
          sha256: 'e'.repeat(64),
        },
        {
          kind: 'playwright-config',
          path: '/safe/playwright.config.ts',
          sha256: 'f'.repeat(64),
        },
      ],
      gates: [{ gate: 'verify', passed: true }],
    };

    const result = projectVerifiedBundle(bundle, verification, '2026-08-05T13:00:00.000Z');

    expect(result).toMatchObject({
      ok: true,
      value: {
        workflow: { status: 'verified' },
        manifest: {
          workflow: { id: 'authentication.login', status: 'verified' },
          verification: {
            requiredRuns: 1,
            runs: [
              {
                startedAt: '2026-08-05T13:00:00.000Z',
                finishedAt: '2026-08-05T13:00:00.000Z',
                passed: true,
              },
            ],
          },
          gateResults: expect.arrayContaining([{ gate: 'verify', passed: true }]),
          fileHashes: expect.arrayContaining([{ path: '/safe/login.png', sha256: 'c'.repeat(64) }]),
        },
        artifacts: expect.arrayContaining(verification.artifacts),
      },
    });
    expect(bundle).toEqual(original);
    if (!result.ok) throw new Error(result.reason);
    expect(result.value.manifest.fileHashes).toEqual(
      result.value.artifacts.map(({ path, sha256 }) => ({ path, sha256 })),
    );
    expect(result.value.artifacts.map(({ kind }) => kind)).toEqual(
      expect.arrayContaining([
        'trace',
        'trace-sanitization-report',
        'screenshot',
        'screenshot-privacy-report',
        'screenshot-capture-runtime',
        'playwright-config',
      ]),
    );
  });

  it.each([
    { runs: [], gates: undefined, reason: 'verification-evidence-incomplete' },
    {
      runs: [{ passed: false }],
      gates: undefined,
      reason: 'verification-evidence-incomplete',
    },
    {
      runs: [{ passed: true }],
      gates: [{ gate: 'verify', passed: false }],
      reason: 'verification-evidence-incomplete',
    },
    {
      runs: [{ passed: true }],
      gates: [],
      reason: 'verification-evidence-incomplete',
    },
    {
      runs: [{ passed: true }],
      gates: [
        { gate: 'verify', passed: true },
        { gate: 'policy', passed: false },
      ],
      reason: 'verification-evidence-incomplete',
    },
  ])(
    'rejects verified output with missing or failed verifier evidence',
    async ({ runs, gates, reason }) => {
      const result = projectVerifiedBundle(
        await stagedBundle(),
        {
          outcome: 'verified',
          diagnostics: [],
          artifacts: [],
          runs,
          gates: gates ?? (undefined as never),
        },
        '2026-08-05T13:00:00.000Z',
      );

      expect(result).toEqual({ ok: false, reason });
    },
  );

  it('rejects conflicting artifact hashes instead of projecting a partial verified bundle', async () => {
    const bundle = await stagedBundle();
    const result = projectVerifiedBundle(
      bundle,
      {
        outcome: 'verified',
        diagnostics: [],
        runs: [{ passed: true }],
        artifacts: [{ ...bundle.artifacts[0]!, sha256: 'e'.repeat(64) }],
        gates: [{ gate: 'verify', passed: true }],
      },
      '2026-08-05T13:00:00.000Z',
    );

    expect(result).toEqual({ ok: false, reason: 'artifact-reference-conflict' });
  });

  it('rejects a contradictory pre-verification bundle instead of healing its identity', async () => {
    const bundle = await stagedBundle();
    bundle.manifest.workflow.id = 'authentication.other';

    const result = projectVerifiedBundle(
      bundle,
      {
        outcome: 'verified',
        diagnostics: [],
        runs: [{ passed: true }],
        artifacts: [],
        gates: [{ gate: 'verify', passed: true }],
      },
      '2026-08-05T13:00:00.000Z',
    );

    expect(result).toEqual({ ok: false, reason: 'projected-bundle-invalid' });
  });
});
