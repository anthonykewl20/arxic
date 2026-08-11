import type { Diagnostic, EvidenceRef, Workflow, WorkflowCompiler } from '@arxic/contracts';
import {
  ARXIC_INTENT_SOURCE_AS_ACCEPTANCE,
  ARXIC_INTENT_WORKFLOW_COVERAGE_GAP,
  intentDiagnostic,
} from './diagnostics';
import type { IntentSpec } from './types';

type RequiredAssertionMatch = {
  readonly intent: string;
  readonly transitionIndex: number;
  readonly matched: IntentSpec['assertions'][number] | undefined;
};

// Shared multiset matcher: walks required-transition assertions in order and
// splice-matches each against the resolved IntentSpec pool (one resolved
// assertion satisfies at most one emitted assertion — bag semantics). Both
// the provenance gate and the acceptance-coverage check consume this; the
// matcher is the single source of truth for "which resolved assertion covers
// which emitted assertion" (charter §1 — mechanics live in the Service).
function matchRequiredAssertions(
  workflow: Workflow,
  intentSpec: IntentSpec,
): RequiredAssertionMatch[] {
  const available = [...intentSpec.assertions];
  const matches: RequiredAssertionMatch[] = [];
  workflow.transitions.forEach((transition, transitionIndex) => {
    if (transition.required === false) return;
    transition.assertions.forEach(({ intent }) => {
      const matchIndex = available.findIndex((assertion) => assertion.intent === intent);
      const matched = matchIndex >= 0 ? available.splice(matchIndex, 1)[0] : undefined;
      matches.push({ intent, transitionIndex, matched });
    });
  });
  return matches;
}

export function enforceIntentProvenancePolicy(
  workflow: Workflow,
  intentSpec: IntentSpec,
): { ok: true } | { ok: false; diagnostics: readonly Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  for (const { intent, transitionIndex, matched } of matchRequiredAssertions(
    workflow,
    intentSpec,
  )) {
    if (!matched) {
      diagnostics.push(
        intentDiagnostic(
          ARXIC_INTENT_WORKFLOW_COVERAGE_GAP,
          'blocked',
          `transition:${transitionIndex}.assertion:${intent}`,
          `Required workflow assertion has no resolved IntentSpec assertion: ${intent}`,
        ),
      );
      continue;
    }
    if (
      matched.kind === 'acceptance' &&
      (matched.evidenceRefs.source.length === 0 || matched.evidenceRefs.runtime.length === 0)
    ) {
      diagnostics.push(
        intentDiagnostic(
          ARXIC_INTENT_SOURCE_AS_ACCEPTANCE,
          'blocked',
          `assertion:${matched.id}`,
          'Acceptance assertions require both source and runtime evidence references',
        ),
      );
    }
  }
  return diagnostics.length === 0 ? { ok: true } : { ok: false, diagnostics };
}

// Promotion requires EVERY required-transition assertion to be backed by an
// acceptance-kind resolved assertion. A mixed spec (one trivial acceptance
// plus a characterization over a genuinely required transition) must NOT
// be promotion-eligible — the coarse `some` let it slip (slice-D residual).
// Unmatched assertions return false (defense-in-depth; the gate blocks first).
export function everyRequiredAssertionAcceptance(
  workflow: Workflow,
  intentSpec: IntentSpec,
): boolean {
  return matchRequiredAssertions(workflow, intentSpec).every(
    ({ matched }) => matched?.kind === 'acceptance',
  );
}

export async function compileWithIntentSpec(input: {
  compiler: Pick<WorkflowCompiler, 'compile'>;
  workflow: Workflow;
  observations: readonly EvidenceRef[];
  intentSpec: IntentSpec;
  origin?: string;
}): Promise<
  | { ok: true; bundle: Awaited<ReturnType<WorkflowCompiler['compile']>> }
  | { ok: false; diagnostics: readonly Diagnostic[] }
> {
  const policy = enforceIntentProvenancePolicy(input.workflow, input.intentSpec);
  if (!policy.ok) return policy;
  const bundle = await input.compiler.compile(input.workflow, [...input.observations]);
  return { ok: true, bundle };
}
