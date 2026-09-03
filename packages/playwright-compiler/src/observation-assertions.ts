// DG-09: observation-derived assertions (ADR-008 Decision 7), productionized
// from the DG-03 spike (extracted; the spike package is retained as evidence
// and is never imported from production code). Post-action URL and DOM
// anchors captured from runtime observation become assertion intents
// (`url:<path>`, `text:<heading>`) and bind into Workflow IR with the runtime
// EvidenceRef attached. These assertions are NOT acceptance oracles: oracle
// provenance classification stays in `@arxic/intent` (ADR-004 §2/§3; the
// dependency direction is intent → playwright-compiler, so this layer cannot
// and must not decide provenance).
import type { Diagnostic, Workflow } from '@arxic/contracts';
import { validateWorkflow } from '@arxic/contracts';
import {
  ARXIC_COMPILE_DERIVATION_EMPTY,
  ARXIC_COMPILE_OBSERVATION_DRIFT,
  compileDiagnostic,
} from './diagnostics';

export type DerivedAssertion = Readonly<{
  kind: 'url' | 'text';
  intent: string;
  expectedValue: string;
}>;

const DEFAULT_MAX_TEXT_ASSERTIONS = 2;

export function deriveAssertionsFromObservation(
  observation: Readonly<{ url: string; headings?: readonly string[]; allowedOrigin?: string }>,
  options: Readonly<{ maxTextAssertions?: number }> = {},
):
  | { ok: true; assertions: readonly DerivedAssertion[] }
  | { ok: false; diagnostics: readonly Diagnostic[] } {
  const maxText = options.maxTextAssertions ?? DEFAULT_MAX_TEXT_ASSERTIONS;
  let parsed: URL;
  try {
    parsed = new URL(observation.url);
  } catch {
    return { ok: false, diagnostics: [derivationEmpty(observation.url)] };
  }
  if (!/^https?:$/u.test(parsed.protocol) || parsed.pathname === '') {
    return { ok: false, diagnostics: [derivationEmpty(observation.url)] };
  }
  if (observation.allowedOrigin !== undefined && parsed.origin !== observation.allowedOrigin) {
    return {
      ok: false,
      diagnostics: [
        compileDiagnostic(
          ARXIC_COMPILE_OBSERVATION_DRIFT,
          'observation',
          `Observed URL ${parsed.origin} left the allowed origin ${observation.allowedOrigin}`,
        ),
      ],
    };
  }
  const assertions: DerivedAssertion[] = [
    { kind: 'url', intent: `url:${parsed.pathname}`, expectedValue: `url:${parsed.pathname}` },
  ];
  const seen = new Set<string>();
  for (const heading of observation.headings ?? []) {
    const trimmed = heading.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    if (seen.size >= maxText) break;
    seen.add(trimmed);
    // #366: heading anchors are role-qualified — the derivation knows these
    // texts are heading accessible-names, so the emitted locator scopes by
    // role and stays strict-mode race-safe even when a heading and a control
    // share the exact full text on the observed page.
    assertions.push({
      kind: 'text',
      intent: `text@heading:${trimmed}`,
      expectedValue: `text@heading:${trimmed}`,
    });
  }
  if (assertions.length === 0) {
    return { ok: false, diagnostics: [derivationEmpty(observation.url)] };
  }
  return { ok: true, assertions };
}

/**
 * Binds observation-derived assertions into a Workflow: every REQUIRED
 * transition's assertions are replaced by the derived set (removing canned
 * literals per ADR-008 Decision 7) and the runtime observation's evidence ref
 * is attached to those transitions. Optional transitions are left untouched.
 * The emitted Workflow must remain schema-valid for the unchanged compiler.
 */
export function bindObservationAssertions(input: {
  workflow: Workflow;
  derived: readonly DerivedAssertion[];
  runtimeEvidenceRef: string;
}): { ok: true; workflow: Workflow } | { ok: false; diagnostics: readonly Diagnostic[] } {
  if (input.derived.length === 0) {
    return {
      ok: false,
      diagnostics: [
        compileDiagnostic(
          ARXIC_COMPILE_DERIVATION_EMPTY,
          input.workflow.id ?? 'workflow',
          'No observation-derived assertions were available to bind; refusing to emit an assertion-less required transition',
        ),
      ],
    };
  }
  const bound: Workflow = {
    ...input.workflow,
    transitions: input.workflow.transitions.map((transition) => {
      if (transition.required === false) return transition;
      return {
        ...transition,
        assertions: input.derived.map(({ intent }) => ({ intent })),
        evidenceRefs: [...new Set([...transition.evidenceRefs, input.runtimeEvidenceRef])],
      };
    }),
    evidenceRefs: [...new Set([...input.workflow.evidenceRefs, input.runtimeEvidenceRef])],
  };
  const validated = validateWorkflow(bound);
  if (!validated.ok) {
    return {
      ok: false,
      diagnostics: [
        compileDiagnostic(
          ARXIC_COMPILE_DERIVATION_EMPTY,
          input.workflow.id ?? 'workflow',
          `Observation-bound workflow is invalid: ${validated.diagnostics.map((item) => item.message).join('; ')}`,
        ),
      ],
    };
  }
  return { ok: true, workflow: bound };
}

function derivationEmpty(url: string): Diagnostic {
  return compileDiagnostic(
    ARXIC_COMPILE_DERIVATION_EMPTY,
    'observation',
    `No assertion could be derived from the observed URL: ${url || '(empty)'}`,
  );
}
