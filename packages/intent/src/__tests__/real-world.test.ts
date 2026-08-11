// This proof exercises real authCandidates pack logic against both apps' captured authSurface data; live-browser proof is deferred to slice F, and pack-rule identity supplies oracle authority (the orchestrator boundary that consumes this landed in slice B) while deep content resolution — verifying the pack-rule actually authorizes the exact expected value — remains deferred to a later slice.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  authCandidates,
  PACKAGE_NAME as AUTH_DOMAIN_PACK,
  type AuthCapabilityId,
} from '@arxic/auth-domain-pack';
import { FIXTURE_APPS, referenceAuthApp, vulnerableAuthApp } from '@arxic/real-world-testkit';
import {
  ARXIC_INTENT_ORACLE_CONFLICT,
  INTENT_SCHEMA_VERSION,
  canonicalJson,
  canonicalizeIntentSpec,
  enforceIntentProvenancePolicy,
  normalizeIntentSpec,
  resolveAssertionKind,
  type IntentSpecInput,
} from '..';

const evidenceRefs = { source: ['src:login-handler'], runtime: ['run:login'] } as const;
const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const { version: authDomainPackVersion } = JSON.parse(
  readFileSync(join(repoRoot, 'packages/auth-domain-pack/package.json'), 'utf8'),
) as { version: string };
const loginCapability: AuthCapabilityId = 'authentication.login';
const pinnedCanonicalSha256: Readonly<Record<string, string>> = {
  'reference-auth-app': '1860b161ed87c11d0e1f0c4c905534644cc8b7c5befdcd1dca77d7a1a5296198',
  'vulnerable-auth-app': '6cc7f019393ae0b66ab80384903bdc9fe379749b6c3443e16be0e1ddd8208901',
};

function loginOracle() {
  const identity = {
    domainPackId: AUTH_DOMAIN_PACK,
    ruleId: loginCapability,
    ruleVersion: authDomainPackVersion,
  };
  return {
    kind: 'domain-rule',
    ...identity,
    digest: createHash('sha256').update(canonicalJson(identity)).digest('hex'),
  } as const;
}

function inputFor(app: (typeof FIXTURE_APPS)[number]): IntentSpecInput {
  const login = app.authSurface.login;
  const candidate = authCandidates(app.authSurface).find(
    ({ workflow }) => workflow.id === loginCapability,
  );
  if (!candidate) throw new Error(`Expected ${app.name} login candidate`);
  return {
    schemaVersion: INTENT_SCHEMA_VERSION,
    id: `${app.name}-login`,
    domain: 'authentication',
    persona: 'registered-user',
    intent: 'Log in',
    lineage: {
      commit: '0123456789abcdef0123456789abcdef01234567',
      appBuildDigest: createHash('sha256').update(app.name).digest('hex'),
      fixtureSeedDigest: createHash('sha256').update(app.persona.email).digest('hex'),
      featureFlagsDigest: createHash('sha256').update('none').digest('hex'),
      policyDigest: createHash('sha256').update('local-test').digest('hex'),
    },
    proposals: candidate.workflow.transitions.map((transition, index) => ({
      id: `${loginCapability}:${index}`,
      intent: transition.action.intent,
      action: transition.action.intent,
      fromState: transition.from,
      toState: transition.to,
      evidenceRefs,
    })),
    assertions: [
      {
        id: 'login-success',
        intent: login.assertion,
        expectedValue: login.assertion,
        oracles: [loginOracle()],
        evidenceRefs,
      },
    ],
    evidenceRefs,
  };
}

describe('intent service real-world data proof', () => {
  for (const app of FIXTURE_APPS) {
    it(`normalizes, canonically pins, and gates ${app.name} observed login facts`, () => {
      const result = normalizeIntentSpec(inputFor(app));
      const candidate = authCandidates(app.authSurface).find(
        ({ workflow }) => workflow.id === loginCapability,
      );

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(`Expected ${app.name} intent normalization`);
      if (!candidate) throw new Error(`Expected ${app.name} login candidate`);
      expect(result.spec.assertions[0]?.kind).toBe('acceptance');
      expect(candidate.workflow.transitions[0]?.assertions[0]?.intent).toBe(
        app.authSurface.login.assertion,
      );
      expect(enforceIntentProvenancePolicy(candidate.workflow, result.spec)).toEqual({ ok: true });
      expect(canonicalizeIntentSpec(result.spec).canonicalSha256).toBe(
        pinnedCanonicalSha256[app.name],
      );
    });
  }

  it('keeps the real observed login assertion as characterization without a domain rule', () => {
    const login = referenceAuthApp.authSurface.login;
    const observedInput = inputFor(referenceAuthApp);
    const assertion = observedInput.assertions[0];
    if (!assertion) throw new Error('Expected reference login assertion');
    const result = normalizeIntentSpec({
      ...observedInput,
      assertions: [{ ...assertion, oracles: [{ kind: 'observed-only' }] }],
    });

    expect(login.assertion).toBe('url:/');
    expect(resolveAssertionKind([{ kind: 'observed-only' }]).kind).toBe('characterization');
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Expected observed-only characterization');
    expect(result.spec.assertions[0]?.expectedValue).toBe(login.assertion);
    expect(result.spec.assertions[0]?.kind).toBe('characterization');
  });

  it('contradicts the two real apps divergent acceptance outcomes', () => {
    const reference = inputFor(referenceAuthApp).assertions[0];
    const vulnerable = inputFor(vulnerableAuthApp).assertions[0];
    if (!reference || !vulnerable) throw new Error('Expected fixture login assertions');
    const result = normalizeIntentSpec({
      ...inputFor(referenceAuthApp),
      assertions: [reference, { ...vulnerable, id: reference.id }],
    });

    expect(reference.expectedValue).toBe('url:/');
    expect(vulnerable.expectedValue).toBe('text:Logged in');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected real app conflict');
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: ARXIC_INTENT_ORACLE_CONFLICT,
        severity: 'contradicted',
      }),
    );
  });
});
