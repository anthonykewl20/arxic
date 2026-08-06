import { validateDiagnostic, type Diagnostic, type TruthState } from '@arxic/contracts';
import { codepointCompare } from '@arxic/evidence-graph';
import {
  ARXIC_RECON_CONFLICT,
  ARXIC_RECON_POST_FREEZE_DISCOVERY,
  ARXIC_RECON_SOURCE_ONLY,
  ARXIC_RECON_UNSUPPORTED,
  reconDiagnostic,
} from './diagnostics';
import type { ReconciliationOutcome, ReconciliationResult } from './types';

export type VerificationOutcome = Readonly<{
  candidateId: string;
  outcome: TruthState;
  diagnostics: readonly Diagnostic[];
}>;

export type ReportRow = Readonly<{
  candidateId: string;
  reconciliationOutcome: ReconciliationOutcome;
  verificationOutcome?: TruthState;
  staticEvidence: number;
  runtimeEvidence: number;
  accountability: number;
  blockerReason?: string;
  supportedFixes: readonly string[];
  diagnostics: readonly Diagnostic[];
}>;

export type CoverageReport = Readonly<{
  schemaVersion: 1;
  generatedAt: string;
  denominator: number;
  verified: number;
  blocked: number;
  contradicted: number;
  uncovered: number;
  candidateAccountability: number;
  accountabilityVerifiedGap: number;
  rows: readonly ReportRow[];
}>;

const INBOX_FIXES = ['Configure a Mailpit SMTP sink', 'Provide a disposable inbox lease'] as const;
const TOTP_FIXES = [
  'Provision an OtpAdapter fixture',
  'Configure PersonaProvisioner with mfaSecret',
] as const;
const NO_EVIDENCE_FIXES = [
  'Run source indexer (stages 1-3)',
  'Run breadth discovery (stage 5)',
] as const;
const UNSUPPORTED_FIXES = [
  'Add ast-grep rule for the framework pattern',
  'Provide runtime evidence for the claim',
] as const;
const CONFLICT_FIXES = [
  'Investigate source/runtime disagreement',
  'Correct the candidate model or target app',
] as const;
const SOURCE_ONLY_FIXES = [
  'Run breadth discovery to observe at runtime',
  'Verify the route is reachable in the target deployment',
] as const;

export function enrichSupportedFixes(diagnostics: readonly Diagnostic[]): Diagnostic[] {
  return diagnostics.map((diagnostic) => {
    if (diagnostic.severity !== 'blocked') return diagnostic;
    const fixes = fixesFor(diagnostic);
    if (!fixes) return diagnostic;
    const enriched: Diagnostic = { ...diagnostic, supportedFixes: [...fixes] };
    const validation = validateDiagnostic(enriched);
    if (!validation.ok) throw new Error('reconciler made an invalid enriched Diagnostic');
    return validation.value;
  });
}

export function compileCoverageReport(
  reconciliation: ReconciliationResult,
  verificationOutcomes: readonly VerificationOutcome[],
  options: { now?: () => string } = {},
): CoverageReport {
  const verificationByCandidate = new Map<string, VerificationOutcome>();
  for (const verification of verificationOutcomes) {
    if (!verificationByCandidate.has(verification.candidateId)) {
      verificationByCandidate.set(verification.candidateId, verification);
    }
  }
  const compiled = reconciliation.rows.map((row) => {
    const verification = verificationByCandidate.get(row.candidateId);
    const diagnostics = enrichSupportedFixes([
      ...row.diagnostics,
      ...(verification?.diagnostics ?? []),
    ]);
    const finalOutcome = verification?.outcome ?? row.outcome;
    const blockerReason =
      verification?.diagnostics.find(({ severity }) => severity === 'blocked')?.message ??
      row.blockerReason ??
      diagnostics.find(({ severity }) => severity === 'blocked')?.message;
    const reportRow: ReportRow = {
      candidateId: row.candidateId,
      reconciliationOutcome: row.outcome,
      ...(verification ? { verificationOutcome: verification.outcome } : {}),
      staticEvidence: row.staticEvidence,
      runtimeEvidence: row.runtimeEvidence,
      accountability: row.accountability,
      ...(finalOutcome === 'blocked' && blockerReason ? { blockerReason } : {}),
      supportedFixes: [
        ...new Set(diagnostics.flatMap(({ supportedFixes }) => supportedFixes ?? [])),
      ],
      diagnostics,
    };
    return { finalOutcome, kind: row.kind, reportRow };
  });
  const denominatorRows = compiled.filter(({ kind }) => kind === 'candidate');
  const count = (outcome: TruthState): number =>
    denominatorRows.filter(({ finalOutcome }) => finalOutcome === outcome).length;
  const verified = count('verified');
  const candidateAccountability = reconciliation.summary.candidateAccountability;
  return {
    schemaVersion: 1,
    generatedAt: (options.now ?? (() => new Date().toISOString()))(),
    denominator: reconciliation.denominator,
    verified,
    blocked: count('blocked'),
    contradicted: count('contradicted'),
    uncovered: count('hypothesized') + count('observed'),
    candidateAccountability,
    accountabilityVerifiedGap:
      candidateAccountability -
      (reconciliation.denominator === 0 ? 0 : verified / reconciliation.denominator),
    rows: compiled.map(({ reportRow }) => reportRow),
  };
}

export function detectPostFreezeDiscovery(
  frozen: ReconciliationResult,
  current: ReconciliationResult,
): Diagnostic[] {
  const frozenIds = new Set(frozen.orderedCandidates.map(({ id }) => id));
  return [...new Set(current.orderedCandidates.map(({ id }) => id))]
    .filter((id) => !frozenIds.has(id))
    .sort(codepointCompare)
    .map((id) =>
      reconDiagnostic(
        ARXIC_RECON_POST_FREEZE_DISCOVERY,
        'blocked',
        id,
        `Candidate ${id} was discovered after denominator freeze; a new manifest is required.`,
      ),
    );
}

function fixesFor(diagnostic: Diagnostic): readonly string[] | undefined {
  if (/inbox|mailpit|smtp|reset email/iu.test(diagnostic.message)) return INBOX_FIXES;
  if (/totp|\botp\b|\bmfa\b|authentication code/iu.test(diagnostic.message)) return TOTP_FIXES;
  if (
    diagnostic.code === ARXIC_RECON_UNSUPPORTED &&
    /no static evidence/iu.test(diagnostic.message)
  ) {
    return NO_EVIDENCE_FIXES;
  }
  if (diagnostic.code === ARXIC_RECON_UNSUPPORTED) return UNSUPPORTED_FIXES;
  if (diagnostic.code === ARXIC_RECON_CONFLICT) return CONFLICT_FIXES;
  if (diagnostic.code === ARXIC_RECON_SOURCE_ONLY) return SOURCE_ONLY_FIXES;
  return undefined;
}
