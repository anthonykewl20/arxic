// #258 regression tests (red-first): a real run failure must classify as
// `contradicted` with its cause surfaced, and the artifact-gate failure must be
// reported ALONGSIDE — never instead. The campaign case: both runs fail, the
// failed assertions mean checkpoint screenshots never happen, the
// screenshot-inventory gate fails structurally, and the old ordering replaced
// APP-DEFECT with ARXIC-VERIFY-ARTIFACT-MISSING.
import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '@arxic/contracts';
import type { VerificationPolicy } from '@arxic/contracts';
import {
  ARXIC_VERIFY_APP_DEFECT,
  ARXIC_VERIFY_ARTIFACT_MISSING,
  ARXIC_VERIFY_FLAKY_RUNS,
  ARXIC_VERIFY_RUN_FAILURE,
} from './diagnostics';
import { classifyVerification } from './classify';

const policy: VerificationPolicy = { requiredRuns: 2, forbidNetworkErrors: true };
const artifactFailures = [
  {
    reason: 'missing' as const,
    detail:
      'run 1 artifacts could not be retained: SCREENSHOT_PRIVACY_FAILED: ARXIC-SCREENSHOT-INVENTORY-INVALID: source image inventory differs from the exact bound output set',
  },
];

describe('classifyVerification failure-evidence ordering (#258)', () => {
  it('classifies every-run-failure as contradicted with the app-defect cause FIRST, artifact gate ALONGSIDE', () => {
    const result = classifyVerification({
      subject: 'authentication.login',
      runs: [{ passed: false }, { passed: false }],
      policy,
      artifactFailures,
      runFailures: [
        'run 1: Error: expect(page).toHaveURL failed',
        'run 2: Error: expect(page).toHaveURL failed',
      ],
    });

    expect(result.outcome).toBe('contradicted');
    expect(result.diagnostics[0]).toMatchObject({
      code: ARXIC_VERIFY_APP_DEFECT,
      severity: 'contradicted',
    });
    // The per-run failure evidence is retained after the primary cause.
    expect(result.diagnostics.map(({ code }) => code)).toContain(ARXIC_VERIFY_RUN_FAILURE);
    // The artifact-gate failure is reported alongside, not instead.
    expect(result.diagnostics.map(({ code }) => code)).toContain(ARXIC_VERIFY_ARTIFACT_MISSING);
    const artifactDiagnostic = result.diagnostics.find(
      ({ code }) => code === ARXIC_VERIFY_ARTIFACT_MISSING,
    );
    expect(artifactDiagnostic?.severity).toBe('blocked');
  });

  it('classifies a passing/failing split as contradicted (flaky) with the artifact gate alongside', () => {
    const result = classifyVerification({
      subject: 'authentication.login',
      runs: [{ passed: true }, { passed: false }],
      policy,
      artifactFailures,
      runFailures: ['run 2: Error: expect(page).toHaveURL failed'],
    });

    expect(result.outcome).toBe('contradicted');
    expect(result.diagnostics[0]).toMatchObject({ code: ARXIC_VERIFY_FLAKY_RUNS });
    expect(result.diagnostics.map(({ code }) => code)).toContain(ARXIC_VERIFY_ARTIFACT_MISSING);
  });

  it('keeps artifact failures blocking when every run PASSED (verified requires intact artifacts)', () => {
    const result = classifyVerification({
      subject: 'authentication.login',
      runs: [{ passed: true }, { passed: true }],
      policy,
      artifactFailures,
    });

    expect(result.outcome).toBe('blocked');
    expect(result.diagnostics[0]).toMatchObject({ code: ARXIC_VERIFY_ARTIFACT_MISSING });
  });

  it('keeps execution diagnostics blocking even when runs also failed', () => {
    const execution: Diagnostic[] = [
      {
        code: 'ARXIC-VERIFY-SUITE-UNAVAILABLE',
        severity: 'blocked',
        subject: 'authentication.login',
        message: 'Playwright run 2 could not execute',
      },
    ];
    const result = classifyVerification({
      subject: 'authentication.login',
      runs: [{ passed: false }],
      policy,
      executionDiagnostics: execution,
      artifactFailures,
    });

    expect(result.outcome).toBe('blocked');
    expect(result.diagnostics[0]).toMatchObject({ code: 'ARXIC-VERIFY-SUITE-UNAVAILABLE' });
  });
});
