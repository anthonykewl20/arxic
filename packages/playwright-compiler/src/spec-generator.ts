import type { Workflow, WorkflowTransition } from '@arxic/contracts';

const SUBMIT_BUTTON_NAME =
  '/submit|log in|login|sign in|continue|send|change|reset|verify|confirm|enroll|register|sign up/i';

export class UnsupportedWorkflowStepError extends Error {
  readonly transition: WorkflowTransition;

  constructor(transition: WorkflowTransition, message: string) {
    super(message);
    this.name = 'UnsupportedWorkflowStepError';
    this.transition = transition;
  }
}

export function generateSpec(
  workflow: Workflow,
  origin: string,
  runtimeUrl?: string,
  options: { captureScreenshots?: boolean } = {},
): { spec: string; nonSemanticLocatorRationale?: string } {
  const captureScreenshots = options.captureScreenshots ?? true;
  const lines = [
    "import { test, expect } from '../fixtures/workflow.fixture';",
    ...(captureScreenshots
      ? ["import { capturePolicyScreenshot } from '../fixtures/screenshot-privacy';"]
      : []),
    '',
    `test(${JSON.stringify(workflow.id)}, async ({ page }) => {`,
  ];
  let usedFormScope = false;
  for (const [index, transition] of workflow.transitions
    .filter((item) => item.required !== false)
    .entries()) {
    const action = renderAction(transition);
    if (action.formScoped) usedFormScope = true;
    lines.push(
      `  await test.step(${JSON.stringify(`${transition.from} → ${transition.to}`)}, async () => {`,
      `    await page.goto(${JSON.stringify(index === 0 && runtimeUrl ? new URL(runtimeUrl, origin).href : new URL(statePath(transition.from), origin).href)});`,
      ...action.lines,
      ...renderAssertions(transition, origin),
      ...(captureScreenshots
        ? [
            `    await capturePolicyScreenshot(page, ${JSON.stringify(`artifacts/screenshots/step-${index + 1}-${fileNamePart(transition.from)}-${fileNamePart(transition.to)}.png`)});`,
          ]
        : []),
      '  });',
    );
  }
  lines.push('});', '');
  return {
    spec: lines.join('\n'),
    ...(usedFormScope
      ? {
          nonSemanticLocatorRationale:
            "Submit-action inputs are scoped to their containing form via page.locator('form').filter so identically-labelled fields on a single multi-form page resolve unambiguously; semantic getByLabel/getByRole locators are retained within the form scope.",
        }
      : {}),
  };
}

export function generateControlStateSpec(
  workflow: Workflow,
  origin: string,
  transitionIndex: number,
  assertionIndex: number,
): { spec: string } {
  const transition = workflow.transitions[transitionIndex];
  if (!transition) throw new RangeError(`Transition index ${transitionIndex} is out of range`);
  if (!transition.assertions[assertionIndex])
    throw new RangeError(`Assertion index ${assertionIndex} is out of range`);

  return {
    spec: [
      "import { test, expect } from '../fixtures/workflow.fixture';",
      '',
      `test(${JSON.stringify(`${workflow.id} control state ${transitionIndex}:${assertionIndex}`)}, async ({ page }) => {`,
      `  await page.goto(${JSON.stringify(new URL(statePath(transition.from), origin).href)});`,
      ...renderAssertions(transition, origin, assertionIndex),
      '});',
      '',
    ].join('\n'),
  };
}

function renderAction(transition: WorkflowTransition): {
  lines: string[];
  formScoped: boolean;
} {
  const inputRefs = Object.entries(transition.action.inputRefs ?? {});
  const intent = transition.action.intent.trim();
  if (/^(submit|log in|login|sign in)/iu.test(intent) && inputRefs.length > 0) {
    const labels = inputRefs.map(([name]) => label(name));
    const formFilter = labels
      .map((value) => `.filter({ has: page.getByLabel(${JSON.stringify(value)}) })`)
      .join('');
    const submitButtonFilter = `.filter({ has: page.getByRole('button', { name: ${SUBMIT_BUTTON_NAME} }) })`;
    return {
      lines: [
        `    const form = page.locator('form')${formFilter}${submitButtonFilter};`,
        '    await expect(form).toHaveCount(1);',
        ...inputRefs.map(
          ([name, reference]) =>
            `    await form.getByLabel(${JSON.stringify(label(name))}).fill(process.env[${JSON.stringify(environmentName(reference))}] ?? '');`,
        ),
        `    await form.getByRole('button', { name: ${SUBMIT_BUTTON_NAME} }).click();`,
      ],
      formScoped: true,
    };
  }
  const open = intent.match(/^(?:open|go to|navigate to)\s+(.+)$/iu);
  if (open?.[1] && inputRefs.length === 0) {
    return {
      lines: [`    await page.getByRole('link', { name: ${JSON.stringify(open[1])} }).click();`],
      formScoped: false,
    };
  }
  const click = intent.match(/^(?:click|select|choose)\s+(.+)$/iu);
  if (click?.[1] && inputRefs.length === 0) {
    return {
      lines: [`    await page.getByRole('button', { name: ${JSON.stringify(click[1])} }).click();`],
      formScoped: false,
    };
  }
  throw new UnsupportedWorkflowStepError(
    transition,
    `Transition ${transition.from}→${transition.to} has no supported action pattern`,
  );
}

function renderAssertions(
  transition: WorkflowTransition,
  origin: string,
  assertionIndex?: number,
): string[] {
  const assertions =
    assertionIndex === undefined ? transition.assertions : [transition.assertions[assertionIndex]!];
  return assertions.map((assertion) => {
    if (assertion.intent.startsWith('url:')) {
      const expected = assertion.intent.slice(4).trim();
      if (!expected) throw unsupportedAssertion(transition);
      const expectedUrl = new URL(expected, origin).href;
      const expectedRoute = new RegExp(`^${escapeRegExp(expectedUrl)}(?:[?#].*)?$`);
      return `    await expect(page).toHaveURL(${expectedRoute.toString()});`;
    }
    if (assertion.intent.startsWith('text:')) {
      const expected = assertion.intent.slice(5).trim();
      if (!expected) throw unsupportedAssertion(transition);
      return `    await expect(page.getByText(${JSON.stringify(expected)})).toBeVisible();`;
    }
    throw unsupportedAssertion(transition);
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
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
