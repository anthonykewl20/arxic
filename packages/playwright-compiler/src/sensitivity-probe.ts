import type { Diagnostic, Workflow } from '@arxic/contracts';
import {
  ARXIC_PROBE_HARNESS_UNUSABLE,
  ARXIC_PROBE_INSENSITIVE_ASSERTION,
  probeDiagnostic,
} from './diagnostics';
import { generateConfig, generateFixture } from './fixture-generator';
import { generateControlStateSpec, generateSpec } from './spec-generator';

export type ProbeRunSuite = (input: { testDirectory: string }) => Promise<{
  passed: boolean;
  output?: string;
}>;

export type ProbeSensitivityOptions = {
  workflow: Workflow;
  origin: string;
  runtimeUrl?: string;
  /** Writes the mutated test dir (spec + fixture + config) for one assertion; returns the dir path. Caller-provided so the Service stays FS-light + testable. */
  writeProbeDirectory: (input: {
    spec: string;
    fixture: string;
    config: string;
  }) => Promise<string>;
  runSuite: ProbeRunSuite;
};

export type ProbeSensitivityResult = {
  /** true = every probed operator was killed (the assertion is sensitive to value and action). false = at least one mutation survived (insensitive). */
  killed: boolean;
  probed: number;
  controlPassed: boolean;
  assertions: readonly ProbeAssertionResult[];
  diagnostics: readonly Diagnostic[];
};

export type ProbeAssertionResult = Readonly<{
  transitionIndex: number;
  assertionIndex: number;
  operators: readonly Readonly<{
    kind: 'value-substitution' | 'control-state-omission';
    killed: boolean;
    controlPassed: boolean;
  }>[];
  killed: boolean;
}>;

export async function probeAssertionSensitivity(
  options: ProbeSensitivityOptions,
): Promise<ProbeSensitivityResult> {
  const diagnostics: Diagnostic[] = [];
  const fixture = generateFixture(options.workflow);
  const config = generateConfig(options.workflow, { trace: 'off' });
  let probed = 0;
  const assertions: ProbeAssertionResult[] = [];

  const mutations = options.workflow.transitions.flatMap((transition, transitionIndex) =>
    transition.required === false
      ? []
      : transition.assertions.flatMap((assertion, assertionIndex) => {
          const mutation = mutateIntent(assertion.intent);
          return mutation ? [{ assertion, assertionIndex, mutation, transitionIndex }] : [];
        }),
  );
  if (mutations.length === 0)
    return withAssertions(
      { killed: false, probed: 0, controlPassed: false, diagnostics },
      assertions,
    );

  const control = generateSpec(options.workflow, options.origin, options.runtimeUrl, {
    captureScreenshots: false,
  }).spec;
  const controlDirectory = await options.writeProbeDirectory({ spec: control, fixture, config });
  const controlRun = await options.runSuite({ testDirectory: controlDirectory });
  if (!controlRun.passed) {
    return withAssertions(
      {
        killed: false,
        probed: 0,
        controlPassed: false,
        diagnostics: [
          probeDiagnostic(
            ARXIC_PROBE_HARNESS_UNUSABLE,
            options.workflow.id,
            `The unmutated sensitivity control did not pass${controlRun.output ? `: ${controlRun.output}` : ''}`,
          ),
        ],
      },
      assertions,
    );
  }

  for (const { assertion, assertionIndex, mutation, transitionIndex } of mutations) {
    probed += 1;
    const workflow = structuredClone(options.workflow);
    workflow.transitions[transitionIndex]!.assertions[assertionIndex]!.intent = mutation;
    const { spec } = generateSpec(workflow, options.origin, options.runtimeUrl, {
      captureScreenshots: false,
    });
    const testDirectory = await options.writeProbeDirectory({ spec, fixture, config });
    const run = await options.runSuite({ testDirectory });
    const valueSubstitutionKilled = !run.passed;
    if (run.passed) {
      diagnostics.push(
        probeDiagnostic(
          ARXIC_PROBE_INSENSITIVE_ASSERTION,
          options.workflow.id,
          `Assertion ${JSON.stringify(assertion.intent)} remained passing after value mutation to ${JSON.stringify(mutation)}`,
        ),
      );
    }

    probed += 1;
    const omissionSpec = generateControlStateSpec(
      options.workflow,
      options.origin,
      transitionIndex,
      assertionIndex,
    ).spec;
    const omissionDirectory = await options.writeProbeDirectory({
      spec: omissionSpec,
      fixture,
      config,
    });
    const omissionRun = await options.runSuite({ testDirectory: omissionDirectory });
    const controlStateOmissionKilled = !omissionRun.passed;
    if (omissionRun.passed) {
      diagnostics.push(
        probeDiagnostic(
          ARXIC_PROBE_INSENSITIVE_ASSERTION,
          options.workflow.id,
          `Assertion ${JSON.stringify(assertion.intent)} remained passing when the transition action was omitted (control-state tautology)`,
        ),
      );
    }
    assertions.push({
      transitionIndex,
      assertionIndex,
      operators: [
        {
          kind: 'value-substitution',
          killed: valueSubstitutionKilled,
          controlPassed: true,
        },
        {
          kind: 'control-state-omission',
          killed: controlStateOmissionKilled,
          controlPassed: true,
        },
      ],
      killed: valueSubstitutionKilled && controlStateOmissionKilled,
    });
  }

  return withAssertions(
    {
      killed: assertions.length > 0 && assertions.every((assertion) => assertion.killed),
      probed,
      controlPassed: true,
      diagnostics,
    },
    assertions,
  );
}

function withAssertions(
  result: Omit<ProbeSensitivityResult, 'assertions'>,
  assertions: readonly ProbeAssertionResult[],
): ProbeSensitivityResult {
  // Preserve deep-equality compatibility for callers of the pre-granularity service shape.
  // The orchestrator explicitly projects this typed property into the persisted stage artifact.
  return Object.defineProperty(result, 'assertions', {
    value: assertions,
    enumerable: false,
  }) as ProbeSensitivityResult;
}

function mutateIntent(intent: string): string | undefined {
  if (intent.startsWith('url:')) return 'url:/__arxic-probe-never__';
  if (intent.startsWith('text:')) return 'text:__arxic-probe-never-match__';
  return undefined;
}
