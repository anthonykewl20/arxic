// DG-03 sad-path-first unit tests: binding observation-derived assertions into
// IntentSpec through the REAL @arxic/intent service (normalize/resolve). The
// ADR-004 provenance rules are enforced by the existing package, not re-implemented.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ARXIC_INTENT_ORACLE_CONFLICT, ARXIC_INTENT_SOURCE_AS_ACCEPTANCE } from '@arxic/intent';
import { normalizeIntentSpec } from '@arxic/intent';
import { observationDerivedIntentSpec, runtimeEvidenceIdFor } from '../intent-binding';

const lineage = {
  commit: '0123456789abcdef0123456789abcdef01234567',
  appBuildDigest: 'a'.repeat(64),
  fixtureSeedDigest: 'b'.repeat(64),
  featureFlagsDigest: 'c'.repeat(64),
  policyDigest: 'd'.repeat(64),
};

function spikeDomainRule() {
  const identity = {
    domainPackId: '@arxic/verification-spike',
    ruleId: 'authentication.login.redirect-target',
    ruleVersion: '0.1.1',
  };
  return {
    kind: 'domain-rule',
    ...identity,
    digest: createHash('sha256').update(JSON.stringify(identity)).digest('hex'),
  } as const;
}

const baseInput = {
  specIdentity: {
    id: 'dg03-login',
    domain: 'authentication',
    persona: 'registered-user',
    intent: 'Log in',
  },
  lineage,
  sourceEvidence: ['src:login-redirect'],
  proposals: [
    {
      id: 'dg03-login:0',
      intent: 'Submit login credentials',
      action: 'Submit login credentials',
      fromState: 'login-page',
      toState: 'dashboard',
      evidenceRefs: { source: ['src:login-redirect'], runtime: ['run:dg03-login'] },
    },
  ],
  derived: [
    { kind: 'url' as const, intent: 'url:/dashboard', expectedValue: 'url:/dashboard' },
    { kind: 'text' as const, intent: 'text:Dashboard', expectedValue: 'text:Dashboard' },
  ],
  runtimeEvidenceId: 'run:dg03-login',
};

describe('observationDerivedIntentSpec', () => {
  it('binds derived assertions as characterization under an observed-only oracle (ADR-004)', () => {
    const result = normalizeIntentSpec(
      observationDerivedIntentSpec({ ...baseInput, oracle: { kind: 'observed-only' } }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.spec.assertions).toHaveLength(2);
    for (const assertion of result.spec.assertions) {
      expect(assertion.kind).toBe('characterization');
      expect(assertion.oracles).toEqual([{ kind: 'observed-only' }]);
      expect(assertion.evidenceRefs.runtime).toEqual(['run:dg03-login']);
    }
  });

  it('promotes the same derived assertions to acceptance when an independent oracle is linked', () => {
    const result = normalizeIntentSpec(
      observationDerivedIntentSpec({ ...baseInput, oracle: spikeDomainRule() }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const assertion of result.spec.assertions) {
      expect(assertion.kind).toBe('acceptance');
    }
  });

  it('blocks acceptance binding with no runtime evidence (real @arxic/intent gate)', () => {
    const result = normalizeIntentSpec({
      ...observationDerivedIntentSpec({ ...baseInput, oracle: spikeDomainRule() }),
      assertions: observationDerivedIntentSpec({
        ...baseInput,
        oracle: spikeDomainRule(),
      }).assertions.map((assertion) => ({
        ...assertion,
        evidenceRefs: { source: assertion.evidenceRefs.source, runtime: [] },
      })),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.some(({ code }) => code === ARXIC_INTENT_SOURCE_AS_ACCEPTANCE)).toBe(
      true,
    );
    expect(result.diagnostics.every(({ severity }) => severity === 'blocked')).toBe(true);
  });

  it('contradicts divergent expected values for the same assertion id (real gate)', () => {
    const first = observationDerivedIntentSpec({
      ...baseInput,
      oracle: spikeDomainRule(),
      derived: [
        { kind: 'url' as const, intent: 'url:/dashboard', expectedValue: 'url:/dashboard' },
      ],
    });
    const second = observationDerivedIntentSpec({
      ...baseInput,
      oracle: { ...spikeDomainRule(), ruleId: 'authentication.login.redirect-target.other' },
      derived: [
        {
          kind: 'url' as const,
          intent: 'url:/somewhere-else',
          expectedValue: 'url:/somewhere-else',
        },
      ],
    });
    const conflictingId = first.assertions[0]!.id;
    const result = normalizeIntentSpec({
      ...first,
      assertions: [
        ...first.assertions,
        ...second.assertions.map((assertion) => ({ ...assertion, id: conflictingId })),
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(
      result.diagnostics.some(
        ({ code, severity }) =>
          code === ARXIC_INTENT_ORACLE_CONFLICT && severity === 'contradicted',
      ),
    ).toBe(true);
  });

  it('derives a stable opaque runtime evidence id from the runtime EvidenceRef', () => {
    const id = runtimeEvidenceIdFor({
      kind: 'runtime',
      runId: 'run-1',
      appBuildDigest: '',
      browser: 'chromium',
      browserVersion: '1.0.0.0',
      url: 'http://127.0.0.1:1/login',
      timestamp: '2026-08-16T00:00:00.000Z',
    });
    expect(id).toMatch(/^dg03-run:[0-9a-f]{16}$/);
    expect(
      runtimeEvidenceIdFor({
        kind: 'runtime',
        runId: 'run-1',
        appBuildDigest: '',
        browser: 'chromium',
        browserVersion: '1.0.0.0',
        url: 'http://127.0.0.1:1/login',
        timestamp: '2026-08-16T00:00:00.000Z',
      }),
    ).toBe(id);
  });
});
