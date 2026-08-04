import { describe, expect, it } from 'vitest';
import {
  ARXIC_MANIFEST_DENOMINATOR_INVALID,
  ARXIC_MANIFEST_GATE_MISSING,
  ARXIC_MANIFEST_INVALID,
  validateDiagnostic,
  validateManifest,
  type BundleManifest,
} from '..';

const manifest: BundleManifest = {
  schemaVersion: 1,
  bundleVersion: 1,
  workflow: {
    id: 'auth.login.success',
    status: 'verified',
  },
  repository: 'https://github.com/example/shop',
  commit: '0123456789abcdef0123456789abcdef01234567',
  appBuildDigest: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  environment: {
    class: 'local-test',
    featureFlags: ['password-login=true'],
    persona: 'registered-user',
    browser: 'chromium',
  },
  generator: {
    id: 'arxic',
    version: '0.0.0',
  },
  model: {
    id: 'configured-adapter',
    version: '2026-08-04',
  },
  dependencies: [
    { name: 'playwright', version: '1.54.1', kind: 'npm' },
    { name: 'chromium', version: '139.0.7258.5', kind: 'container' },
  ],
  verification: {
    requiredRuns: 2,
    runs: [
      {
        startedAt: '2026-08-04T10:00:00.000Z',
        finishedAt: '2026-08-04T10:00:05.000Z',
        passed: true,
      },
      {
        startedAt: '2026-08-04T10:01:00.000Z',
        finishedAt: '2026-08-04T10:01:05.000Z',
        passed: true,
      },
    ],
  },
  fileHashes: [
    {
      path: 'manifest.json',
      sha256: '123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0',
    },
    {
      path: 'workflow.json',
      sha256: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
    },
  ],
  gateResults: [
    { gate: 'schema', passed: true },
    { gate: 'policy', passed: true },
    { gate: 'execution', passed: true },
  ],
  blockers: [
    {
      code: 'ARXIC-FIXTURE-MISSING',
      severity: 'blocked',
      subject: 'auth.mfa.enroll',
      message: 'No safe test fixture can provision an MFA-capable user.',
      evidenceRefs: ['src:mfa-controller', 'config:idp-provider'],
      supportedFixes: ['Configure PersonaProvisioner'],
    },
  ],
  coverage: {
    denominator: 4,
    verified: 3,
    blocked: 1,
  },
  parentDomainPack: 'authentication',
  runId: 'run-auth-login-20260804',
};

const cloneManifest = (): BundleManifest => structuredClone(manifest);

const expectCode = (input: unknown, code: string) => {
  const result = validateManifest(input);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(code);
  }
};

describe('BundleManifest contract', () => {
  it.each(['appBuildDigest', 'commit'])(
    'rejects a missing top-level %s field using a stable diagnostic',
    (field) => {
      const input = cloneManifest() as unknown as Record<string, unknown>;
      delete input[field];
      expectCode(input, ARXIC_MANIFEST_INVALID);
    },
  );

  it('rejects an empty fileHashes array using a stable diagnostic', () => {
    const input = cloneManifest();
    input.fileHashes = [];
    expectCode(input, ARXIC_MANIFEST_INVALID);
  });

  it('rejects an empty gateResults array using the gate-missing diagnostic', () => {
    const input = cloneManifest();
    input.gateResults = [];
    expectCode(input, ARXIC_MANIFEST_GATE_MISSING);
  });

  it('rejects a gate result missing passed using the gate-missing diagnostic', () => {
    const input = cloneManifest() as unknown as Record<string, unknown>;
    const gateResults = input.gateResults as Array<Record<string, unknown>>;
    delete gateResults[0]!.passed;
    expectCode(input, ARXIC_MANIFEST_GATE_MISSING);
  });

  it.each([undefined, -1])(
    'rejects an invalid coverage denominator %s using a stable diagnostic',
    (denominator) => {
      const input = cloneManifest() as unknown as Record<string, unknown>;
      const coverage = input.coverage as Record<string, unknown>;
      if (denominator === undefined) {
        delete coverage.denominator;
      } else {
        coverage.denominator = denominator;
      }
      expectCode(input, ARXIC_MANIFEST_DENOMINATOR_INVALID);
    },
  );

  it.each([
    ['commit', '0123456789abcdef0123456789abcdef0123456'],
    ['appBuildDigest', '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcde'],
  ])('rejects an invalid-length %s using a stable diagnostic', (field, value) => {
    const input = cloneManifest() as unknown as Record<string, unknown>;
    input[field] = value;
    expectCode(input, ARXIC_MANIFEST_INVALID);
  });

  it('rejects a blocker with verified severity using a stable diagnostic', () => {
    const input = cloneManifest() as unknown as Record<string, unknown>;
    const blockers = input.blockers as Array<Record<string, unknown>>;
    blockers[0]!.severity = 'verified';
    expectCode(input, ARXIC_MANIFEST_INVALID);
  });

  it('rejects an extra unknown top-level property using a stable diagnostic', () => {
    const input = { ...cloneManifest(), unknown: true };
    expectCode(input, ARXIC_MANIFEST_INVALID);
  });

  it('rejects a deliberately wrong representative manifest missing workflow', () => {
    const input = cloneManifest() as unknown as Record<string, unknown>;
    delete input.workflow;
    expectCode(input, ARXIC_MANIFEST_INVALID);
  });

  it('accepts a manifest blocker as a frozen Diagnostic', () => {
    expect(validateDiagnostic(manifest.blockers![0])).toEqual({
      ok: true,
      value: manifest.blockers![0],
    });
  });

  it('accepts a present denominator while cross-version immutability remains deferred to #24', () => {
    const input = cloneManifest();
    input.coverage = { denominator: 0 };
    expect(validateManifest(input)).toEqual({ ok: true, value: input });
  });

  it('accepts the representative issue #5 manifest', () => {
    expect(validateManifest(manifest)).toEqual({ ok: true, value: manifest });
  });
});
