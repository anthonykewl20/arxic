import type { ActionClass, Diagnostic } from '@arxic/contracts';
import { ARXIC_AGENT_HEAL_REJECTED, agentDiagnostic } from './diagnostics';

export type HealProposal = {
  originalSpec: string;
  proposedSpec: string;
  origins?: string[];
  actionClass?: ActionClass;
  allowedOrigins: string[];
};

export type HealDecision = { accepted: true } | { accepted: false; diagnostic: Diagnostic };

const forbidden = [
  {
    expression:
      /(?:\btest\s*(?:\.\s*(?:skip|fixme|only)\b|\[\s*[^\]]*\b(?:skip|fixme|only)\b[^\]]*\])|\.\s*(?:skip|fixme|only)\s*\()/u,
    reason: 'forbidden test status directive',
  },
  { expression: /\bquarantin(?:e|ed|ing)\b/iu, reason: 'success-by-quarantine language' },
] as const;
const noOpAssertions = [
  /expect\s*\((?:[^()]|\([^()]*\))*\)\s*\.\s*(?:toBeTruthy|toBeDefined)\s*\(\s*\)/gu,
  /expect\s*\((?:[^()]|\([^()]*\))*\)\s*\.\s*toBe\s*\(\s*true\s*\)/gu,
  /expect\s*\(\s*1\s*\)\s*\.\s*toBe\s*\(\s*1\s*\)/gu,
] as const;

export function evaluateHealProposal(proposal: HealProposal): HealDecision {
  for (const rule of forbidden) {
    if (rule.expression.test(proposal.proposedSpec)) return rejected(rule.reason);
  }
  const originalAssertions = assertionCount(proposal.originalSpec);
  const proposedAssertions = assertionCount(proposal.proposedSpec);
  if (proposedAssertions < originalAssertions) return rejected('deleted expect() assertion');
  if (noOpAssertions.some((pattern) => [...proposal.proposedSpec.matchAll(pattern)].length > 0))
    return rejected('assertion weakened to an explicit pass-through matcher');
  const outside = (proposal.origins ?? []).filter(
    (origin) => !proposal.allowedOrigins.includes(origin),
  );
  if (outside.length > 0) return rejected(`origin outside allowlist: ${outside.join(', ')}`);
  if (proposal.actionClass === 'destructive' || proposal.actionClass === 'external-side-effect')
    return rejected(`action class ${proposal.actionClass} is not healable`);
  return { accepted: true };
}

function assertionCount(spec: string): number {
  return [...spec.matchAll(/\bexpect\s*\(/gu)].length;
}

function rejected(reason: string): HealDecision {
  return {
    accepted: false,
    diagnostic: agentDiagnostic(
      ARXIC_AGENT_HEAL_REJECTED,
      'heal-proposal',
      `Heal rejected: ${reason}`,
    ),
  };
}
