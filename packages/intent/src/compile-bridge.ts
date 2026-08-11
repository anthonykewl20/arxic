import type { Diagnostic, EvidenceRef, Workflow, WorkflowCompiler } from '@arxic/contracts';
import {
  ARXIC_INTENT_SOURCE_AS_ACCEPTANCE,
  ARXIC_INTENT_WORKFLOW_COVERAGE_GAP,
  intentDiagnostic,
} from './diagnostics';
import type { IntentSpec } from './types';

export function enforceIntentProvenancePolicy(
  workflow: Workflow,
  intentSpec: IntentSpec,
): { ok: true } | { ok: false; diagnostics: readonly Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const availableAssertions = [...intentSpec.assertions];

  workflow.transitions.forEach((transition, transitionIndex) => {
    if (transition.required === false) return;
    transition.assertions.forEach(({ intent }) => {
      const matchIndex = availableAssertions.findIndex((assertion) => assertion.intent === intent);
      if (matchIndex >= 0) {
        const [matched] = availableAssertions.splice(matchIndex, 1);
        if (
          matched?.kind === 'acceptance' &&
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
        return;
      }
      diagnostics.push(
        intentDiagnostic(
          ARXIC_INTENT_WORKFLOW_COVERAGE_GAP,
          'blocked',
          `transition:${transitionIndex}.assertion:${intent}`,
          `Required workflow assertion has no resolved IntentSpec assertion: ${intent}`,
        ),
      );
    });
  });

  return diagnostics.length === 0 ? { ok: true } : { ok: false, diagnostics };
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
