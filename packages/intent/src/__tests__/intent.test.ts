import assert from 'node:assert/strict';
import { describe, expect, it } from 'vitest';
import {
  validateDiagnostic,
  type Diagnostic,
  type StagedBundle,
  type Workflow,
} from '@arxic/contracts';
import * as intent from '..';
import {
  ARXIC_INTENT_INVALID,
  ARXIC_INTENT_ORACLE_CONFLICT,
  ARXIC_INTENT_ORACLE_MISSING,
  ARXIC_INTENT_ORACLE_STALE,
  ARXIC_INTENT_SOURCE_AS_ACCEPTANCE,
  ARXIC_INTENT_WORKFLOW_COVERAGE_GAP,
  INTENT_SCHEMA_VERSION,
  buildIntentSpec,
  canonicalJson,
  canonicalizeIntentSpec,
  compileWithIntentSpec,
  detectStaleness,
  enforceIntentProvenancePolicy,
  everyRequiredAssertionAcceptance,
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

function workflowWithAssertions(...intents: string[]): Workflow {
  return {
    $schema: 'https://arxic.dev/schemas/workflow/v1.json',
    id: 'login',
    version: 1,
    title: 'Login',
    domain: 'authentication',
    persona: 'registered-user',
    status: 'observed',
    confidence: 1,
    scope: { commit: 'commit-a', environment: 'test', browser: 'chromium' },
    preconditions: [],
    states: [{ id: 'login' }, { id: 'complete' }],
    transitions: intents.map((intent) => ({
      from: 'login',
      to: 'complete',
      action: { intent: 'Submit login credentials' },
      assertions: [{ intent }],
      evidenceRefs: ['run:login'],
    })),
    negativeCases: [],
    verification: {
      requiredRuns: 1,
      screenshotCheckpoints: [],
      forbidNetworkErrors: true,
    },
    evidenceRefs: ['run:login'],
  };
}

describe('intent service sad paths', () => {
  it('blocks a required workflow assertion missing from the resolved intent spec', () => {
    const intentSpec = buildIntentSpec({ ...validInput(), assertions: [] });

    const result = enforceIntentProvenancePolicy(
      workflowWithAssertions('Login succeeds'),
      intentSpec,
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected workflow coverage rejection');
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: ARXIC_INTENT_WORKFLOW_COVERAGE_GAP,
        severity: 'blocked',
        subject: 'transition:0.assertion:Login succeeds',
      }),
    );
  });

  it('blocks double-counting one resolved assertion across two required transitions', () => {
    const intentSpec = buildIntentSpec({
      ...validInput(),
      assertions: [acceptanceAssertion()],
    });

    const result = enforceIntentProvenancePolicy(
      workflowWithAssertions('Login succeeds', 'Login succeeds'),
      intentSpec,
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected workflow over-emission rejection');
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: ARXIC_INTENT_WORKFLOW_COVERAGE_GAP,
        severity: 'blocked',
        subject: 'transition:1.assertion:Login succeeds',
      }),
    );
  });

  it('rechecks and blocks matched acceptance without runtime evidence', () => {
    const intentSpec = buildIntentSpec({
      ...validInput(),
      assertions: [acceptanceAssertion()],
    });
    const acceptance = intentSpec.assertions[0];
    if (!acceptance) throw new Error('Expected acceptance assertion fixture');

    const result = enforceIntentProvenancePolicy(workflowWithAssertions('Login succeeds'), {
      ...intentSpec,
      assertions: [
        { ...acceptance, evidenceRefs: { source: acceptance.evidenceRefs.source, runtime: [] } },
      ],
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected acceptance evidence rejection');
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: ARXIC_INTENT_SOURCE_AS_ACCEPTANCE,
        severity: 'blocked',
      }),
    );
  });

  it('rechecks and blocks matched acceptance without source evidence', () => {
    const intentSpec = buildIntentSpec({
      ...validInput(),
      assertions: [acceptanceAssertion()],
    });
    const acceptance = intentSpec.assertions[0];
    if (!acceptance) throw new Error('Expected acceptance assertion fixture');

    const result = enforceIntentProvenancePolicy(workflowWithAssertions('Login succeeds'), {
      ...intentSpec,
      assertions: [
        { ...acceptance, evidenceRefs: { source: [], runtime: acceptance.evidenceRefs.runtime } },
      ],
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected acceptance evidence rejection');
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: ARXIC_INTENT_SOURCE_AS_ACCEPTANCE,
        severity: 'blocked',
      }),
    );
  });

  it('does not call the compiler when the intent provenance gate fails', async () => {
    let compileCalls = 0;
    const compiler = {
      compile: async () => {
        compileCalls += 1;
        throw new Error('Compiler must not be called');
      },
    };
    const intentSpec = buildIntentSpec({ ...validInput(), assertions: [] });

    const result = await compileWithIntentSpec({
      compiler,
      workflow: workflowWithAssertions('Login succeeds'),
      observations: [],
      intentSpec,
    });

    expect(result).toEqual({
      ok: false,
      diagnostics: [
        expect.objectContaining({ code: ARXIC_INTENT_WORKFLOW_COVERAGE_GAP, severity: 'blocked' }),
      ],
    });
    expect(compileCalls).toBe(0);
  });

  describe('everyRequiredAssertionAcceptance promotion-eligibility check', () => {
    const acceptanceFor = (assertionIntent: string) => ({
      id: `${assertionIntent}-acc`,
      intent: assertionIntent,
      expectedValue: 'url:/',
      oracles: [domainOracle],
      evidenceRefs,
    });
    const characterizationFor = (assertionIntent: string) => ({
      id: `${assertionIntent}-char`,
      intent: assertionIntent,
      expectedValue: 'text:observed',
      oracles: [{ kind: 'observed-only' as const }],
      evidenceRefs,
    });
    const specWith = (...assertions: IntentSpecInput['assertions'][number][]) =>
      buildIntentSpec({ ...validInput(), assertions });

    it('rejects a mixed spec where a required transition is only characterization-backed', () => {
      // The slice-D residual: a trivial acceptance plus a characterization over
      // a genuinely required transition must NOT be promotion-eligible.
      const workflow = workflowWithAssertions('Login succeeds', 'Profile loads');
      const intentSpec = specWith(
        acceptanceFor('Login succeeds'),
        characterizationFor('Profile loads'),
      );

      expect(everyRequiredAssertionAcceptance(workflow, intentSpec)).toBe(false);
    });

    it('accepts a spec where every required transition is acceptance-backed', () => {
      const workflow = workflowWithAssertions('Login succeeds', 'Profile loads');
      const intentSpec = specWith(acceptanceFor('Login succeeds'), acceptanceFor('Profile loads'));

      expect(everyRequiredAssertionAcceptance(workflow, intentSpec)).toBe(true);
    });

    it('rejects a characterization-only required assertion', () => {
      const workflow = workflowWithAssertions('Login succeeds');
      const intentSpec = specWith(characterizationFor('Login succeeds'));

      expect(everyRequiredAssertionAcceptance(workflow, intentSpec)).toBe(false);
    });

    it('rejects (defense-in-depth) when a required assertion is unmatched', () => {
      const workflow = workflowWithAssertions('Login succeeds', 'Profile loads');
      const intentSpec = specWith(acceptanceFor('Login succeeds')); // 'Profile loads' unmatched

      expect(everyRequiredAssertionAcceptance(workflow, intentSpec)).toBe(false);
    });
  });

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
    expect(codes).toHaveLength(7);
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
  it('compiles and returns the bundle after the intent provenance gate passes', async () => {
    const workflow = workflowWithAssertions('Login succeeds');
    const intentSpec = buildIntentSpec({
      ...validInput(),
      assertions: [acceptanceAssertion()],
    });
    const bundle = { plan: 'compiled login' } as StagedBundle;
    const observations = [] as const;
    let receivedObservations: unknown;

    const result = await compileWithIntentSpec({
      compiler: {
        compile: async (_workflow, compilerObservations) => {
          receivedObservations = compilerObservations;
          return bundle;
        },
      },
      workflow,
      observations,
      intentSpec,
    });

    expect(result).toEqual({ ok: true, bundle });
    expect(receivedObservations).toEqual([]);
    expect(receivedObservations).not.toBe(observations);
  });

  it('accepts a matched characterization assertion at the compiler gate', () => {
    const intentSpec = buildIntentSpec({
      ...validInput(),
      assertions: [{ ...acceptanceAssertion(), oracles: [{ kind: 'observed-only' }] }],
    });

    expect(
      enforceIntentProvenancePolicy(workflowWithAssertions('Login succeeds'), intentSpec),
    ).toEqual({ ok: true });
  });

  it('accepts full required assertion coverage with acceptance evidence', () => {
    const intentSpec = buildIntentSpec({
      ...validInput(),
      assertions: [acceptanceAssertion()],
    });

    expect(
      enforceIntentProvenancePolicy(workflowWithAssertions('Login succeeds'), intentSpec),
    ).toEqual({ ok: true });
  });

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
