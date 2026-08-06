import { validateDiagnostic } from '@arxic/contracts';
import type { Candidate, CoverageMatrix } from '@arxic/orchestrator-langgraph';
import { describe, expect, it } from 'vitest';
import * as reconciler from '..';
import { reconDiagnostic, reconcile } from '..';

describe('reconciler contracts', () => {
  it('is a drop-in implementation of the stage-6 orchestrator seam', () => {
    const seam: (input: {
      candidates: readonly Candidate[];
      surface: Parameters<typeof reconcile>[0]['surface'];
    }) => Promise<CoverageMatrix> = reconcile;
    expect(seam).toBe(reconcile);
  });

  it('validates every exported ARXIC-RECON code through the frozen validator', () => {
    const codes = (Object.values(reconciler) as unknown[]).filter(
      (value): value is string => typeof value === 'string' && value.startsWith('ARXIC-RECON-'),
    );
    expect(codes).toHaveLength(6);
    for (const code of codes) {
      const diagnostic = reconDiagnostic(
        code as Parameters<typeof reconDiagnostic>[0],
        'blocked',
        'contract',
        'Loop-close diagnostic validation.',
      );
      expect(validateDiagnostic(diagnostic)).toMatchObject({ ok: true });
    }
  });

  it('does not assign or echo verified in a maximally supported reconciliation result', async () => {
    const result = await reconcile({
      candidates: [
        {
          id: 'auth.login',
          title: 'Login /login',
          evidenceRefs: ['src:login'],
          workflow: {
            $schema: 'https://arxic.dev/schemas/workflow/v1.json',
            id: 'auth.login',
            version: 1,
            title: 'Login',
            domain: 'authentication',
            persona: 'registered-user',
            status: 'verified',
            confidence: 1,
            scope: {
              commit: 'a'.repeat(40),
              environment: 'local-test',
              browser: 'chromium',
            },
            preconditions: [],
            states: [{ id: '/login' }, { id: 'complete' }],
            transitions: [
              {
                from: '/login',
                to: 'complete',
                action: { intent: 'Submit login' },
                assertions: [{ intent: 'Login succeeds' }],
                evidenceRefs: ['src:login', 'run:login'],
              },
            ],
            negativeCases: [],
            verification: {
              requiredRuns: 2,
              screenshotCheckpoints: ['complete'],
              forbidNetworkErrors: true,
            },
            evidenceRefs: ['src:login', 'run:login'],
          },
        },
      ],
      surface: {
        schemaVersion: 1,
        truthState: 'observed',
        origin: 'http://app.test',
        routes: [
          {
            truthState: 'observed',
            url: 'http://app.test/login',
            path: '/login',
            depth: 0,
            title: 'Login',
            forms: [],
            controls: [],
            links: [],
            evidence: {
              kind: 'runtime',
              runId: 'login',
              appBuildDigest: 'b'.repeat(64),
              browser: 'chromium',
              browserVersion: '1',
              url: 'http://app.test/login',
              timestamp: '2026-08-05T00:00:00.000Z',
            },
          },
        ],
        navigationEdges: [],
        diagnostics: [],
      },
    });
    expect(JSON.stringify({ rows: result.rows, summary: result.summary })).not.toContain(
      ':"verified"',
    );
    expect(result.summary.verifiedTransitionCoverage).toBe(0);
    expect(result.orderedCandidates[0]?.workflow?.status).toBe('hypothesized');
  });
});
