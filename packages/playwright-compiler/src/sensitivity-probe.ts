import type { Diagnostic, Workflow } from '@arxic/contracts';
import { ARXIC_PROBE_INSENSITIVE_ASSERTION, probeDiagnostic } from './diagnostics';
import { generateConfig, generateFixture } from './fixture-generator';
import { generateSpec } from './spec-generator';

export type ProbeRunSuite = (input: { testDirectory: string }) => Promise<{ passed: boolean }>;

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
  /** true = every probed assertion's mutation was killed (the assertion is sensitive). false = at least one mutation survived (insensitive). */
  killed: boolean;
  probed: number;
  diagnostics: readonly Diagnostic[];
};

export async function probeAssertionSensitivity(
  options: ProbeSensitivityOptions,
): Promise<ProbeSensitivityResult> {
  const diagnostics: Diagnostic[] = [];
  const fixture = generateFixture(options.workflow);
  const config = generateConfig(options.workflow);
  let probed = 0;

  for (const [transitionIndex, transition] of options.workflow.transitions.entries()) {
    if (transition.required === false) continue;
    for (const [assertionIndex, assertion] of transition.assertions.entries()) {
      const mutation = mutateIntent(assertion.intent);
      if (!mutation) continue;
      probed += 1;
      const workflow = structuredClone(options.workflow);
      workflow.transitions[transitionIndex]!.assertions[assertionIndex]!.intent = mutation;
      const { spec } = generateSpec(workflow, options.origin, options.runtimeUrl);
      const testDirectory = await options.writeProbeDirectory({ spec, fixture, config });
      const run = await options.runSuite({ testDirectory });
      if (run.passed) {
        diagnostics.push(
          probeDiagnostic(
            ARXIC_PROBE_INSENSITIVE_ASSERTION,
            options.workflow.id,
            `Assertion ${JSON.stringify(assertion.intent)} remained passing after mutation to ${JSON.stringify(mutation)}`,
          ),
        );
      }
    }
  }

  return { killed: diagnostics.length === 0, probed, diagnostics };
}

function mutateIntent(intent: string): string | undefined {
  if (intent.startsWith('url:')) return 'url:/__arxic-probe-never__';
  if (intent.startsWith('text:')) return 'text:__arxic-probe-never-match__';
  return undefined;
}
