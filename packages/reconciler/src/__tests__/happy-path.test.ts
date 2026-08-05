import type { SurfaceMap } from '@arxic/crawlee-adapter';
import { describe, expect, it } from 'vitest';
import { reconcile, serializeCoverageMatrix, type ReconciliationCandidate } from '..';

const candidate = (id: string, route: string, evidenceCount: number): ReconciliationCandidate => ({
  id,
  title: `${id} ${route}`,
  evidenceRefs: Array.from({ length: evidenceCount }, (_, index) => `src:evidence:${index}`),
  workflow: {
    $schema: 'https://arxic.dev/schemas/workflow/v1.json',
    id,
    version: 1,
    title: id,
    domain: 'authentication',
    persona: id.includes('admin') ? 'admin' : 'registered-user',
    status: 'hypothesized',
    confidence: 0.8,
    scope: {
      commit: 'a'.repeat(40),
      environment: 'local-test',
      browser: 'chromium',
      featureFlags: ['auth=true'],
    },
    preconditions: [{ fixture: 'user.exists' }],
    states: [{ id: route }, { id: 'complete' }],
    transitions: [
      {
        from: route,
        to: 'complete',
        action: { intent: 'Submit', inputRefs: { email: 'persona.email' } },
        assertions: [{ intent: 'Success is visible' }],
        evidenceRefs: ['src:transition'],
      },
    ],
    negativeCases: [],
    verification: {
      requiredRuns: 2,
      screenshotCheckpoints: ['complete'],
      forbidNetworkErrors: true,
    },
    evidenceRefs: ['src:workflow'],
  },
});

const route = (path: string) => ({
  truthState: 'observed' as const,
  url: `http://app.test${path}`,
  path,
  depth: 1,
  title: path,
  forms: [
    {
      action: `http://app.test${path}`,
      method: 'POST',
      destructive: true,
      controls: [{ tag: 'input', type: 'email', name: 'email', required: true }],
    },
  ],
  controls: [],
  links: [],
  evidence: {
    kind: 'runtime' as const,
    runId: 'run-real',
    appBuildDigest: 'b'.repeat(64),
    browser: 'chromium',
    browserVersion: '1',
    url: `http://app.test${path}`,
    timestamp: '2026-08-05T00:00:00.000Z',
  },
});

const map = (paths: readonly string[]): SurfaceMap => ({
  schemaVersion: 1,
  truthState: 'observed',
  origin: 'http://app.test',
  routes: paths.map(route),
  navigationEdges: [],
  diagnostics: [],
});

describe('reconciliation accountability', () => {
  it('keeps overlapping static and runtime evidence observed and exposes section 11 dimensions', async () => {
    const result = await reconcile({
      candidates: [candidate('auth.login', '/login', 2)],
      surface: map(['/login']),
    });
    expect(result.rows[0]).toMatchObject({
      candidateId: 'auth.login',
      outcome: 'observed',
      revision: 'a'.repeat(40),
      build: 'b'.repeat(64),
      domain: 'authentication',
      feature: 'login',
      persona: 'registered-user',
      role: 'registered-user',
      route: '/login',
      preconditions: ['user.exists'],
      pathKind: 'happy',
      featureFlags: ['auth=true'],
      browser: 'chromium',
      staticStatus: 'asserted',
      runtimeReachability: 'observed',
      verificationStatus: 'observed',
    });
    expect(result.summary.verifiedTransitionCoverage).toBe(0);
    expect(result.rows.some((row) => row.outcome === ('verified' as never))).toBe(false);
  });

  it('prioritizes the candidate with the greatest accountability potential', async () => {
    const result = await reconcile({
      candidates: [
        { id: 'source.only', title: 'Source only', evidenceRefs: ['src:one'] },
        candidate('auth.login', '/login', 3),
      ],
      surface: map(['/login']),
    });
    expect(result.orderedCandidates.map((item) => item.id)).toEqual(['auth.login', 'source.only']);
  });

  it('serializes byte-identically across repeated and permuted fixed inputs', async () => {
    const candidates = [candidate('auth.login', '/login', 2), candidate('auth.admin', '/admin', 1)];
    const first = await reconcile({ candidates, surface: map(['/login', '/admin', '/about']) });
    const second = await reconcile({
      candidates: [...candidates].reverse(),
      surface: map(['/about', '/admin', '/login']),
    });
    expect(serializeCoverageMatrix(first)).toBe(serializeCoverageMatrix(second));
  });
});
