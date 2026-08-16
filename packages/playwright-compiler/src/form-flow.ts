// DG-09: generic form-flow executor (#253). A form-flow workflow is built
// purely from INVENTORY data — the route, the labelled fields with their
// persona input refs, the submit control's accessible name — plus the runtime
// OBSERVATION of the post-action state. No domain literals and no app-specific
// code: authentication, marketing, support, any form surface uses the same
// builder, and the emitted Workflow compiles through the UNCHANGED spec
// generator (goto → fill → submit → assert) and compile-policy gates.
import type { Diagnostic, Workflow } from '@arxic/contracts';
import { ARXIC_COMPILE_UNSUPPORTED_STEP, compileDiagnostic } from './diagnostics';
import {
  bindObservationAssertions,
  deriveAssertionsFromObservation,
} from './observation-assertions';

export type FormFlowField = Readonly<{
  /** Accessible label of the field, as inventoried from the live app. */
  label: string;
  /** Persona-relative input reference (never a literal value). */
  inputRef: string;
}>;

export type FormFlowObservation = Readonly<{
  /** Stabilized post-action URL captured from runtime observation. */
  url: string;
  /** Post-action heading anchors captured from the accessibility tree. */
  headings: readonly string[];
  /** Opaque runtime evidence ref for the observation (ADR-002). */
  runtimeEvidenceRef: string;
}>;

export type FormFlowInput = Readonly<{
  identity: Readonly<{ id: string; title: string; domain: string; persona: string }>;
  /** Entry route for the form (inventory row). */
  route: string;
  fields: readonly FormFlowField[];
  /** Accessible name of the submit control (inventory row). */
  submitControlName: string;
  observation: FormFlowObservation;
  scope: Readonly<{ commit: string; environment: string; browser: string }>;
  sourceEvidence: Readonly<{ ref: string; path: string; range: readonly [number, number] }>;
  personaFacts?: readonly Readonly<{ fixture: string }>[];
}>;

function stateIdFromPath(path: string): string {
  const segments = path
    .split('/')
    .filter((segment) => segment.length > 0)
    .map((segment) => segment.replace(/[^a-z0-9-]+/giu, '-').toLowerCase());
  if (segments.length === 0) return 'home';
  return `${segments.join('-')}-page`;
}

export function buildFormFlowWorkflow(
  input: FormFlowInput,
): { ok: true; workflow: Workflow } | { ok: false; diagnostics: readonly Diagnostic[] } {
  if (input.fields.length === 0) {
    return {
      ok: false,
      diagnostics: [
        compileDiagnostic(
          ARXIC_COMPILE_UNSUPPORTED_STEP,
          input.identity.id,
          'A form flow requires at least one inventoried field to fill',
        ),
      ],
    };
  }
  const derived = deriveAssertionsFromObservation({
    url: input.observation.url,
    headings: input.observation.headings,
  });
  if (!derived.ok) return derived;

  const fromState = stateIdFromPath(input.route);
  const toState = stateIdFromPath(new URL(input.observation.url).pathname);
  const workflow: Workflow = {
    $schema: 'https://arxic.dev/schemas/workflow/v1.json',
    id: input.identity.id,
    version: 1,
    title: input.identity.title,
    domain: input.identity.domain,
    persona: input.identity.persona,
    status: 'observed',
    confidence: 1,
    scope: { ...input.scope },
    preconditions: [...(input.personaFacts ?? [])],
    states: [...new Set([fromState, toState])].map((id) => ({ id })),
    transitions: [
      {
        from: fromState,
        to: toState,
        action: {
          // The `via "<name>"` suffix parameterizes the generated spec's
          // submit control from INVENTORY data (the generic form-flow
          // executor grammar) instead of the fixed auth submit-button list.
          intent: `Submit ${input.identity.title.toLowerCase()} form via "${input.submitControlName}"`,
          inputRefs: Object.fromEntries(
            input.fields.map(({ label, inputRef }) => [label, inputRef]),
          ),
        },
        assertions: [],
        evidenceRefs: [input.sourceEvidence.ref],
      },
    ],
    negativeCases: [],
    verification: {
      requiredRuns: 2,
      forbidNetworkErrors: true,
      screenshotCheckpoints: [toState],
      trace: 'retain',
    },
    evidenceRefs: [input.sourceEvidence.ref],
  };
  return bindObservationAssertions({
    workflow,
    derived: derived.assertions,
    runtimeEvidenceRef: input.observation.runtimeEvidenceRef,
  });
}
