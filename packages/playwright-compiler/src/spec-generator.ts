import type { Workflow, WorkflowTransition } from '@arxic/contracts';

export class UnsupportedWorkflowStepError extends Error {
  readonly transition: WorkflowTransition;

  constructor(transition: WorkflowTransition, message: string) {
    super(message);
    this.name = 'UnsupportedWorkflowStepError';
    this.transition = transition;
  }
}

export function generateSpec(workflow: Workflow, origin: string): string {
  const lines = [
    "import { test, expect } from '../fixtures/workflow.fixture';",
    '',
    `test(${JSON.stringify(workflow.id)}, async ({ page }) => {`,
  ];
  for (const [index, transition] of workflow.transitions
    .filter((item) => item.required !== false)
    .entries()) {
    lines.push(
      `  await test.step(${JSON.stringify(`${transition.from} → ${transition.to}`)}, async () => {`,
      `    await page.goto(${JSON.stringify(new URL(statePath(transition.from), origin).href)});`,
      ...renderAction(transition),
      ...renderAssertions(transition, origin),
      `    await page.screenshot({ path: ${JSON.stringify(`artifacts/screenshots/step-${index + 1}-${fileNamePart(transition.from)}-${fileNamePart(transition.to)}.png`)} });`,
      '  });',
    );
  }
  lines.push('});', '');
  return lines.join('\n');
}

function renderAction(transition: WorkflowTransition): string[] {
  const inputRefs = Object.entries(transition.action.inputRefs ?? {});
  const intent = transition.action.intent.trim();
  if (/^(submit|log in|login|sign in)/iu.test(intent) && inputRefs.length > 0) {
    return [
      ...inputRefs.map(
        ([name, reference]) =>
          `    await page.getByLabel(${JSON.stringify(label(name))}).fill(process.env[${JSON.stringify(environmentName(reference))}] ?? '');`,
      ),
      "    await page.getByRole('button', { name: /submit|log in|login|sign in|continue|send|change|reset|verify|confirm|enroll|register|sign up/i }).click();",
    ];
  }
  const open = intent.match(/^(?:open|go to|navigate to)\s+(.+)$/iu);
  if (open?.[1] && inputRefs.length === 0) {
    return [`    await page.getByRole('link', { name: ${JSON.stringify(open[1])} }).click();`];
  }
  const click = intent.match(/^(?:click|select|choose)\s+(.+)$/iu);
  if (click?.[1] && inputRefs.length === 0) {
    return [`    await page.getByRole('button', { name: ${JSON.stringify(click[1])} }).click();`];
  }
  throw new UnsupportedWorkflowStepError(
    transition,
    `Transition ${transition.from}→${transition.to} has no supported action pattern`,
  );
}

function renderAssertions(transition: WorkflowTransition, origin: string): string[] {
  return transition.assertions.map((assertion) => {
    if (assertion.intent.startsWith('url:')) {
      const expected = assertion.intent.slice(4).trim();
      if (!expected) throw unsupportedAssertion(transition);
      return `    await expect(page).toHaveURL(${JSON.stringify(new URL(expected, origin).href)});`;
    }
    if (assertion.intent.startsWith('text:')) {
      const expected = assertion.intent.slice(5).trim();
      if (!expected) throw unsupportedAssertion(transition);
      return `    await expect(page.getByText(${JSON.stringify(expected)})).toBeVisible();`;
    }
    throw unsupportedAssertion(transition);
  });
}

function unsupportedAssertion(transition: WorkflowTransition): UnsupportedWorkflowStepError {
  return new UnsupportedWorkflowStepError(
    transition,
    `Transition ${transition.from}→${transition.to} has an unsupported assertion`,
  );
}

function statePath(state: string): string {
  const normalized = state.replace(/-(?:page|form|state)$/u, '').replace(/^home$/u, '');
  return normalized ? `/${normalized}` : '/';
}

function label(name: string): string {
  const words = name.replace(
    /([a-z])([A-Z])/gu,
    (_match, lower: string, upper: string) => `${lower} ${upper.toLowerCase()}`,
  );
  return `${words.slice(0, 1).toUpperCase()}${words.slice(1)}`;
}

function fileNamePart(state: string): string {
  return state.replace(/[^A-Za-z0-9.-]+/gu, '-');
}

function environmentName(reference: string): string {
  return `ARXIC_INPUT_${reference.replace(/[^A-Za-z0-9]+/gu, '_').toUpperCase()}`;
}
