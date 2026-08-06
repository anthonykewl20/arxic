import type { Diagnostic } from '@arxic/contracts';
import { describe, expect, it } from 'vitest';
import {
  ARXIC_RECON_POST_FREEZE_DISCOVERY,
  ARXIC_RECON_UNSUPPORTED,
  compileCoverageReport,
  detectPostFreezeDiscovery,
  enrichSupportedFixes,
  type CoverageRow,
  type ReconciliationResult,
} from '..';

const row = (
  candidateId: string,
  outcome: CoverageRow['outcome'],
  accountability = 0.8,
  diagnostics: readonly Diagnostic[] = [],
): CoverageRow => ({
  candidateId,
  staticEvidence: 1,
  runtimeEvidence: 1,
  outcome,
  kind: 'candidate',
  staticStatus: 'asserted',
  runtimeReachability: outcome === 'blocked' ? 'blocked' : 'observed',
  verificationStatus: outcome,
  ...(outcome === 'blocked' && diagnostics[0] ? { blockerReason: diagnostics[0].message } : {}),
  accountability,
  diagnostics,
});

const result = (rows: readonly CoverageRow[]): ReconciliationResult => ({
  denominator: rows.length,
  rows,
  orderedCandidates: rows.map(({ candidateId }) => ({
    id: candidateId,
    title: candidateId,
    evidenceRefs: ['src:evidence'],
  })),
  diagnostics: rows.flatMap(({ diagnostics }) => diagnostics),
  summary: {
    candidateAccountability:
      rows.length === 0
        ? 0
        : Number(
            (rows.reduce((total, item) => total + item.accountability, 0) / rows.length).toFixed(4),
          ),
    verifiedTransitionCoverage: 0,
    sourceEvidenceOverlap: 1,
    runtimeEvidenceOverlap: 1,
    uncovered: rows.filter(({ outcome }) => outcome === 'hypothesized' || outcome === 'observed')
      .length,
    blocked: rows.filter(({ outcome }) => outcome === 'blocked').length,
    contradicted: rows.filter(({ outcome }) => outcome === 'contradicted').length,
  },
});

describe('coverage report sad paths', () => {
  it('adds actionable supported fixes to a blocked inbox diagnostic', () => {
    const diagnostic: Diagnostic = {
      code: ARXIC_RECON_UNSUPPORTED,
      severity: 'blocked',
      subject: 'authentication.reset-request',
      message: 'The reset email requires an inbox fixture.',
    };
    const report = compileCoverageReport(
      result([row('authentication.reset-request', 'blocked', 0.8, [diagnostic])]),
      [],
      { now: () => '2026-08-06T00:00:00.000Z' },
    );
    expect(report.rows[0]?.supportedFixes).toContain('Configure a Mailpit SMTP sink');
    expect(report.rows[0]?.diagnostics[0]?.supportedFixes).toContain(
      'Configure a Mailpit SMTP sink',
    );
  });

  it('reports a high accountability and low verified gap', () => {
    const report = compileCoverageReport(
      result([
        row('authentication.login', 'observed'),
        row('authentication.logout', 'observed'),
        row('authentication.reset', 'blocked'),
      ]),
      [],
    );
    expect(report.candidateAccountability).toBe(0.8);
    expect(report.verified).toBe(0);
    expect(report.accountabilityVerifiedGap).toBeGreaterThan(0);
  });

  it('reports candidates discovered after denominator freeze as blocked', () => {
    const diagnostics = detectPostFreezeDiscovery(
      result([row('authentication.login', 'observed'), row('authentication.logout', 'observed')]),
      result([
        row('authentication.login', 'observed'),
        row('authentication.logout', 'observed'),
        row('authentication.totp', 'observed'),
      ]),
    );
    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: ARXIC_RECON_POST_FREEZE_DISCOVERY,
        severity: 'blocked',
        subject: 'authentication.totp',
      }),
    ]);
  });

  it('does not add supported fixes to non-blocked diagnostics', () => {
    const diagnostics = enrichSupportedFixes([
      {
        code: ARXIC_RECON_UNSUPPORTED,
        severity: 'hypothesized',
        subject: 'authentication.reset-request',
        message: 'The reset email requires an inbox fixture.',
      },
    ]);
    expect(diagnostics[0]).not.toHaveProperty('supportedFixes');
  });

  it('lets deterministic verification override reconciliation', () => {
    const report = compileCoverageReport(result([row('authentication.login', 'observed')]), [
      { candidateId: 'authentication.login', outcome: 'verified', diagnostics: [] },
    ]);
    expect(report.rows[0]).toMatchObject({
      reconciliationOutcome: 'observed',
      verificationOutcome: 'verified',
    });
    expect(report.verified).toBe(1);
    expect(report.uncovered).toBe(0);
  });
});
