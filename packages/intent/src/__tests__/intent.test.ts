import assert from 'node:assert/strict';
import { describe, expect, it } from 'vitest';
import { validateDiagnostic, type Diagnostic } from '@arxic/contracts';
import * as intent from '..';
import {
  ARXIC_INTENT_INVALID,
  ARXIC_INTENT_ORACLE_CONFLICT,
  ARXIC_INTENT_ORACLE_MISSING,
  ARXIC_INTENT_ORACLE_STALE,
  ARXIC_INTENT_SOURCE_AS_ACCEPTANCE,
  INTENT_SCHEMA_VERSION,
  buildIntentSpec,
  canonicalJson,
  canonicalizeIntentSpec,
  detectStaleness,
  intentDiagnostic,
  normalizeIntentSpec,
  resolveAssertionKind,
  validateOracle,
  type IntentSpecInput,
} from '..';

const evidenceRefs = { source: ['src:login-handler'], runtime: ['run:login'] } as const;
const lineage = {
  commit: 'commit-a',
  appBuildDigest: 'build-a',
  fixtureSeedDigest: 'seed-a',
  featureFlagsDigest: 'flags-a',
  policyDigest: 'policy-a',
} as const;
const domainOracle = {
  kind: 'domain-rule',
  domainPackId: '@arxic/auth-domain-pack',
  ruleId: 'authentication.login',
  ruleVersion: '0.0.0',
  digest: 'a'.repeat(64),
} as const;

function validInput(assertions: IntentSpecInput['assertions'] = []): IntentSpecInput {
  return {
    schemaVersion: INTENT_SCHEMA_VERSION,
    id: 'login-intent',
    domain: 'authentication',
    persona: 'registered-user',
    intent: 'Log in',
    lineage,
    proposals: [],
    assertions,
    evidenceRefs,
  };
}

function acceptanceAssertion(expectedValue = 'url:/') {
  return {
    id: 'login-success',
    intent: 'Login succeeds',
    expectedValue,
    oracles: [domainOracle],
    evidenceRefs,
  } as const;
}

describe('intent service sad paths', () => {
  it('rejects a malformed spec as blocked', () => {
    const result = normalizeIntentSpec({});

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected malformed spec rejection');
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: ARXIC_INTENT_INVALID, severity: 'blocked' }),
    );
  });

  it('rejects a wrong schema version as blocked', () => {
    const result = normalizeIntentSpec({ ...validInput(), schemaVersion: 'something-else' });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected schema-version rejection');
    expect(result.diagnostics.map(({ code }) => code)).toContain(ARXIC_INTENT_INVALID);
  });

  it('blocks an assertion with no oracle', () => {
    const result = normalizeIntentSpec(
      validInput([
        {
          ...acceptanceAssertion(),
          oracles: [],
        },
      ]),
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected missing-oracle rejection');
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: ARXIC_INTENT_ORACLE_MISSING, severity: 'blocked' }),
    );
  });

  it('blocks a domain oracle missing required fields', () => {
    const result = validateOracle({ kind: 'domain-rule' });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected malformed-oracle rejection');
    expect(result.diagnostics.map(({ code }) => code)).toContain(ARXIC_INTENT_INVALID);
  });

  it('blocks a malformed oracle digest', () => {
    const result = validateOracle({ ...domainOracle, digest: 'not-hex!' });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected malformed-digest rejection');
    expect(result.diagnostics.map(({ code }) => code)).toContain(ARXIC_INTENT_INVALID);
  });

  it('blocks a short lowercase oracle digest', () => {
    const result = validateOracle({ ...domainOracle, digest: 'a' });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected short-digest rejection');
    expect(result.diagnostics.map(({ code }) => code)).toContain(ARXIC_INTENT_INVALID);
  });

  it('blocks an uppercase oracle digest', () => {
    const result = validateOracle({ ...domainOracle, digest: 'A1'.repeat(32) });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected uppercase-digest rejection');
    expect(result.diagnostics.map(({ code }) => code)).toContain(ARXIC_INTENT_INVALID);
  });

  it('blocks human approval without an approver', () => {
    const result = validateOracle({
      kind: 'human-approved',
      scopeDigest: 'a'.repeat(64),
      approvalArtifactRef: 'approvals/login.json',
      approvalSha256: 'b'.repeat(64),
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected missing-approver rejection');
    expect(result.diagnostics.map(({ code }) => code)).toContain(ARXIC_INTENT_INVALID);
  });

  it('blocks acceptance without runtime evidence', () => {
    const result = normalizeIntentSpec(
      validInput([
        {
          ...acceptanceAssertion(),
          evidenceRefs: { source: ['src:login-handler'], runtime: [] },
        },
      ]),
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected source-only acceptance rejection');
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: ARXIC_INTENT_SOURCE_AS_ACCEPTANCE,
        severity: 'blocked',
      }),
    );
  });

  it('blocks acceptance without source or runtime evidence', () => {
    const result = normalizeIntentSpec(
      validInput([{ ...acceptanceAssertion(), evidenceRefs: { source: [], runtime: [] } }]),
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected evidence-free acceptance rejection');
    expect(result.diagnostics.map(({ code }) => code)).toContain(ARXIC_INTENT_SOURCE_AS_ACCEPTANCE);
  });

  it('contradicts conflicting acceptance assertions', () => {
    const result = normalizeIntentSpec(
      validInput([acceptanceAssertion('url:/'), acceptanceAssertion('text:Logged in')]),
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected acceptance conflict');
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: ARXIC_INTENT_ORACLE_CONFLICT,
        severity: 'contradicted',
      }),
    );
  });

  it('blocks a duplicate assertion id with the same expected value', () => {
    const result = normalizeIntentSpec(validInput([acceptanceAssertion(), acceptanceAssertion()]));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected duplicate assertion rejection');
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: ARXIC_INTENT_INVALID,
        severity: 'blocked',
        subject: 'assertion:login-success',
        message: 'duplicate assertion id',
      }),
    );
  });

  it('blocks stale lineage and names the drifted field', () => {
    const result = detectStaleness(lineage, { ...lineage, commit: 'commit-b' });

    expect(result.stale).toBe(true);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: ARXIC_INTENT_ORACLE_STALE,
        severity: 'blocked',
        message: expect.stringContaining('commit'),
      }),
    ]);
  });

  it('changes the canonical digest when intent content is tampered', () => {
    const normalized = normalizeIntentSpec(validInput([acceptanceAssertion()]));
    const tampered = normalizeIntentSpec({
      ...validInput([acceptanceAssertion()]),
      persona: 'administrator',
    });
    if (!normalized.ok || !tampered.ok) throw new Error('Expected valid test fixtures');

    expect(canonicalizeIntentSpec(tampered.spec).canonicalSha256).not.toBe(
      canonicalizeIntentSpec(normalized.spec).canonicalSha256,
    );
  });

  it.each([new Date(0), new Map(), new Set(), 1n, () => undefined, Symbol('intent')])(
    'rejects a non-plain canonical value',
    (value) => {
      expect(() => canonicalJson(value)).toThrow(
        expect.objectContaining({
          message: 'intent canonicalization received a non-plain value',
          cause: { type: typeof value },
        }),
      );
    },
  );

  it('removes hostile unknown keys from every normalized object boundary', () => {
    const hostileEvidenceRefs = {
      ...evidenceRefs,
      truthState: 'verified',
      status: 'verified',
    };
    const hostileAssertion = {
      ...acceptanceAssertion(),
      evidenceRefs: hostileEvidenceRefs,
      truthState: 'verified',
      status: 'verified',
    };
    const result = normalizeIntentSpec({
      ...validInput(),
      assertions: [hostileAssertion],
      lineage: { ...lineage, truthState: 'verified', status: 'verified' },
      proposals: [
        {
          id: 'login-transition',
          intent: 'Submit login credentials',
          action: 'submit',
          fromState: 'login',
          toState: 'complete',
          evidenceRefs: hostileEvidenceRefs,
          truthState: 'verified',
          status: 'verified',
        },
      ],
      evidenceRefs: hostileEvidenceRefs,
      truthState: 'verified',
      status: 'verified',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Expected hostile-key normalization');
    expect(JSON.stringify(result.spec)).not.toContain(':"verified"');
  });

  it('preserves build diagnostics as the thrown error cause', () => {
    assert.throws(
      () => buildIntentSpec({ ...validInput([{ ...acceptanceAssertion(), oracles: [] }]) }),
      (error) =>
        error instanceof Error &&
        Array.isArray((error as Error & { cause?: unknown }).cause) &&
        ((error as Error & { cause: Diagnostic[] }).cause as Diagnostic[]).some(
          ({ code }) => code === ARXIC_INTENT_ORACLE_MISSING,
        ),
    );
  });

  it('loop-closes every intent diagnostic code through the frozen validator', () => {
    const codes = (Object.values(intent) as unknown[]).filter(
      (value): value is string => typeof value === 'string' && value.startsWith('ARXIC-INTENT-'),
    );
    expect(codes).toHaveLength(6);
    expect(new Set(codes).size).toBe(codes.length);

    for (const code of codes) {
      const diagnostic = intentDiagnostic(
        code as Parameters<typeof intentDiagnostic>[0],
        'blocked',
        'intent',
        'message',
      );
      expect(diagnostic.code).toBe(code);
      expect(validateDiagnostic(diagnostic).ok).toBe(true);
    }
  });
});

describe('intent service happy paths', () => {
  it('builds a valid spec with derived assertion kinds', () => {
    const spec = buildIntentSpec({ ...validInput([acceptanceAssertion()]) });

    expect(spec.assertions.map(({ kind }) => kind)).toEqual(['acceptance']);
  });

  it('reports unchanged lineage as fresh', () => {
    expect(detectStaleness(lineage, lineage)).toEqual({ stale: false, diagnostics: [] });
  });

  it('classifies observed-only assertions as characterization', () => {
    expect(resolveAssertionKind([{ kind: 'observed-only' }])).toEqual({
      kind: 'characterization',
      diagnostics: [],
    });
  });

  it('lets an acceptance oracle govern alongside observed-only evidence', () => {
    expect(resolveAssertionKind([{ kind: 'observed-only' }, domainOracle])).toEqual({
      kind: 'acceptance',
      diagnostics: [],
    });
  });

  it('normalizes a well-formed acceptance assertion', () => {
    const result = normalizeIntentSpec(validInput([acceptanceAssertion()]));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Expected a normalized spec');
    expect(result.spec.assertions[0]?.kind).toBe('acceptance');
  });

  it('canonicalizes equivalent object-key permutations deterministically', () => {
    const first = normalizeIntentSpec(validInput([acceptanceAssertion()]));
    const permuted = normalizeIntentSpec({
      evidenceRefs,
      assertions: [
        {
          evidenceRefs,
          oracles: [
            {
              digest: 'a'.repeat(64),
              ruleVersion: '0.0.0',
              ruleId: 'authentication.login',
              domainPackId: '@arxic/auth-domain-pack',
              kind: 'domain-rule',
            },
          ],
          expectedValue: 'url:/',
          intent: 'Login succeeds',
          id: 'login-success',
        },
      ],
      proposals: [],
      lineage: {
        policyDigest: 'policy-a',
        featureFlagsDigest: 'flags-a',
        fixtureSeedDigest: 'seed-a',
        appBuildDigest: 'build-a',
        commit: 'commit-a',
      },
      intent: 'Log in',
      persona: 'registered-user',
      domain: 'authentication',
      id: 'login-intent',
      schemaVersion: INTENT_SCHEMA_VERSION,
    });
    if (!first.ok || !permuted.ok) throw new Error('Expected valid permutations');

    expect(canonicalizeIntentSpec(first.spec).canonicalSha256).toBe(
      canonicalizeIntentSpec(permuted.spec).canonicalSha256,
    );
  });

  it('ignores a caller-assigned assertion kind and derives characterization', () => {
    const assertionWithForgedKind = {
      ...acceptanceAssertion(),
      oracles: [{ kind: 'observed-only' }],
      kind: 'acceptance',
    } as const;
    const result = normalizeIntentSpec(validInput([assertionWithForgedKind]));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Expected a normalized characterization');
    expect(result.spec.assertions[0]?.kind).toBe('characterization');
  });
});
