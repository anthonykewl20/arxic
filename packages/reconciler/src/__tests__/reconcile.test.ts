import type { Diagnostic, Workflow } from '@arxic/contracts';
import type { SurfaceMap } from '@arxic/crawlee-adapter';
import { describe, expect, it } from 'vitest';
import {
  ARXIC_RECON_CONFLICT,
  ARXIC_RECON_DENOMINATOR_TAMPERED,
  ARXIC_RECON_RUNTIME_ONLY,
  ARXIC_RECON_SOURCE_ONLY,
  DenominatorTamperedError,
  assertDenominatorFrozen,
  reconcile,
} from '..';

const workflow = (route: string, inputRefs: Record<string, string> = {}): Workflow => ({
  $schema: 'https://arxic.dev/schemas/workflow/v1.json',
  id: `auth${route}`,
  version: 1,
  title: `Use ${route}`,
  domain: 'authentication',
  persona: 'registered-user',
  status: 'hypothesized',
  confidence: 0.7,
  scope: {
    commit: 'a'.repeat(40),
    environment: 'local-test',
    browser: 'chromium',
    featureFlags: ['auth=true'],
  },
  preconditions: [{ fixture: 'user.exists' }],
  states: [{ id: route }, { id: 'done' }],
  transitions: [
    {
      from: route,
      to: 'done',
      action: { intent: `Submit ${route}`, inputRefs },
      assertions: [{ intent: 'A result is shown' }],
      evidenceRefs: ['src:route'],
    },
  ],
  negativeCases: [],
  verification: {
    requiredRuns: 2,
    screenshotCheckpoints: [],
    forbidNetworkErrors: true,
  },
  evidenceRefs: ['src:route'],
});

const surface = (...routes: string[]): SurfaceMap => ({
  schemaVersion: 1,
  truthState: 'observed',
  origin: 'http://app.test',
  routes: routes.map((path) => ({
    truthState: 'observed',
    url: `http://app.test${path}`,
    path,
    depth: 0,
    title: path,
    forms: [],
    controls: [],
    links: [],
    evidence: {
      kind: 'runtime',
      runId: 'run-1',
      appBuildDigest: 'b'.repeat(64),
      browser: 'chromium',
      browserVersion: '1',
      url: `http://app.test${path}`,
      timestamp: '2026-08-05T00:00:00.000Z',
    },
  })),
  navigationEdges: [],
  diagnostics: [],
});

describe('reconcile sad paths', () => {
  it('marks a static route contradicted when the observed route structure disagrees', async () => {
    const result = await reconcile({
      candidates: [
        {
          id: 'auth.login',
          title: 'Login',
          evidenceRefs: ['src:login'],
          workflow: workflow('/login'),
        },
      ],
      surface: surface('/sign-in'),
    });
    expect(result.rows.find((row) => row.candidateId === 'auth.login')?.outcome).toBe(
      'contradicted',
    );
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: ARXIC_RECON_CONFLICT, severity: 'contradicted' }),
    );
  });

  it('keeps a source-only candidate hypothesized', async () => {
    const result = await reconcile({
      candidates: [{ id: 'auth.login', title: 'Login', evidenceRefs: ['src:login'] }],
      surface: surface(),
    });
    expect(result.rows[0]?.outcome).toBe('hypothesized');
    expect(result.diagnostics[0]).toMatchObject({
      code: ARXIC_RECON_SOURCE_ONLY,
      severity: 'hypothesized',
    });
  });

  it('keeps a runtime-only route observed until a candidate asserts it', async () => {
    const result = await reconcile({ candidates: [], surface: surface('/forgot-password') });
    expect(result.rows).toContainEqual(
      expect.objectContaining({
        candidateId: 'runtime:/forgot-password',
        outcome: 'observed',
        staticEvidence: 0,
      }),
    );
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: ARXIC_RECON_RUNTIME_ONLY, severity: 'observed' }),
    );
  });

  it('does not emit a runtime-only row when a form action supports the candidate route', async () => {
    const map = surface('/account');
    const result = await reconcile({
      candidates: [
        {
          id: 'auth.login',
          title: 'Login',
          evidenceRefs: ['src:login'],
          workflow: workflow('/login'),
        },
      ],
      surface: {
        ...map,
        routes: map.routes.map((route) => ({
          ...route,
          forms: [
            {
              action: '/login',
              method: 'POST',
              destructive: true,
              controls: [],
            },
          ],
        })),
      },
    });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ candidateId: 'auth.login', outcome: 'observed' });
    expect(result.summary.runtimeEvidenceOverlap).toBe(1);
  });

  it('preserves a matching surface discovery blocker as a blocked candidate row', async () => {
    const map = surface('/login');
    const blocker: Diagnostic = {
      code: 'ARXIC-SURFACE-005',
      severity: 'blocked',
      subject: 'http://app.test/login',
      message: 'Runtime discovery could not safely complete for this route.',
    };
    const result = await reconcile({
      candidates: [
        {
          id: 'auth.login',
          title: 'Login',
          evidenceRefs: ['src:login'],
          workflow: workflow('/login'),
        },
      ],
      surface: { ...map, diagnostics: [blocker] },
    });
    expect(result.rows[0]).toMatchObject({
      candidateId: 'auth.login',
      outcome: 'blocked',
      blockerReason: 'Runtime discovery could not safely complete for this route.',
      diagnostics: [{ severity: 'blocked' }],
    });
  });

  it('contradicts a workflow when a required runtime control is absent', async () => {
    const result = await reconcile({
      candidates: [
        {
          id: 'auth.login',
          title: 'Login',
          evidenceRefs: ['src:login'],
          workflow: workflow('/login', { password: 'persona.password' }),
        },
      ],
      surface: surface('/login'),
    });
    expect(result.rows[0]).toMatchObject({
      candidateId: 'auth.login',
      outcome: 'contradicted',
      diagnostics: [{ code: ARXIC_RECON_CONFLICT, severity: 'contradicted' }],
    });
  });

  it('blocks duplicate candidate ids instead of throwing', async () => {
    const result = await reconcile({
      candidates: [
        { id: 'auth.login', title: 'Login one', evidenceRefs: ['src:one'] },
        { id: 'auth.login', title: 'Login two', evidenceRefs: ['src:two'] },
      ],
      surface: surface(),
    });
    expect(result.rows).toHaveLength(2);
    expect(result.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          candidateId: 'auth.login',
          outcome: 'blocked',
          diagnostics: [
            expect.objectContaining({ code: 'ARXIC-RECON-UNSUPPORTED', severity: 'blocked' }),
          ],
        }),
      ]),
    );
  });

  it('rejects a post-freeze denominator mutation as blocked', () => {
    const frozenManifest = Object.freeze({ coverage: Object.freeze({ denominator: 2 }) });
    expect(() => assertDenominatorFrozen(3, frozenManifest)).toThrow(DenominatorTamperedError);
    try {
      assertDenominatorFrozen(3, 2);
    } catch (error) {
      expect(error).toBeInstanceOf(DenominatorTamperedError);
      if (error instanceof DenominatorTamperedError) {
        expect(error.diagnostic).toMatchObject({
          code: ARXIC_RECON_DENOMINATOR_TAMPERED,
          severity: 'blocked',
        });
      }
    }
  });
});
