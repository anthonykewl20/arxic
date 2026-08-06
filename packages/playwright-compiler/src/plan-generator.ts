import type { Workflow } from '@arxic/contracts';

export function generatePlan(workflow: Workflow): string {
  const transitions = workflow.transitions
    .map(
      (transition) =>
        `| ${escapeCell(transition.from)} → ${escapeCell(transition.to)} | ${escapeCell(transition.action.intent)} | ${transition.assertions.map((assertion) => escapeCell(assertion.intent)).join('<br>')} | ${transition.required === false ? 'optional' : 'required'} |`,
    )
    .join('\n');
  const preconditions = workflow.preconditions.length
    ? workflow.preconditions.map((item) => `- ${item.fixture}`).join('\n')
    : '- None';
  const checkpoints = workflow.verification.screenshotCheckpoints.length
    ? workflow.verification.screenshotCheckpoints.map((item) => `- ${item}`).join('\n')
    : '- None';
  return [
    `# ${workflow.title}`,
    '',
    `Workflow: \`${workflow.id}\``,
    '',
    '## Preconditions',
    '',
    preconditions,
    '',
    '## Transitions',
    '',
    '| Transition | Action | User-visible assertions | Requirement |',
    '| --- | --- | --- | --- |',
    transitions,
    '',
    '## Checkpoints',
    '',
    checkpoints,
    '',
    '## Verification policy',
    '',
    `- Required clean runs: ${workflow.verification.requiredRuns}`,
    `- Browser: ${workflow.scope.browser}`,
    `- Trace: ${workflow.verification.trace ?? 'discard'}`,
    `- Unexpected network errors forbidden: ${String(workflow.verification.forbidNetworkErrors)}`,
    '- Fixture reset: before and after each independent test',
    '- Persona mutations: serial within the persona lease',
    '',
  ].join('\n');
}

function escapeCell(value: string): string {
  return value.replaceAll('|', '\\|').replaceAll('\n', ' ');
}
